/**
 * Phase 2-3: 法令 XML パーサのテスト
 *
 * fixture: 実物の e-Gov 法令標準 XML から抜粋した小型サンプル。
 * 主要構造 (Article / Paragraph / Item / Subitem / Chapter / Section /
 * SupplProvision / AppdxTable / AppdxNote) を網羅。
 */

import { describe, expect, it } from 'vitest';
import { parseLawXml, extractInlineText, XmlParseError } from './xml-parser.js';

/** ========== Fixtures ========== */

// 改暦ノ布告レベルの最小 XML
const MINIMAL_LAW = `<?xml version="1.0" encoding="UTF-8"?>
<Law Era="Meiji" Year="05" Num="337" LawType="CabinetOrder" Lang="ja" PromulgateMonth="11" PromulgateDay="09">
  <LawNum>明治五年太政官布告第三百三十七号</LawNum>
  <LawBody>
    <LawTitle Kana="かいれきのふこく" Abbrev="改暦の布告" AbbrevKana="か">明治五年太政官布告第三百三十七号（改暦ノ布告）</LawTitle>
    <MainProvision>
      <Paragraph Num="1">
        <ParagraphNum/>
        <ParagraphSentence>
          <Sentence>今般改暦ノ儀別紙　詔書ノ通被　仰出候条此旨相達候事</Sentence>
        </ParagraphSentence>
      </Paragraph>
    </MainProvision>
  </LawBody>
</Law>`;

// Chapter > Article 構造
const CHAPTERED_LAW = `<?xml version="1.0" encoding="UTF-8"?>
<Law Era="Showa" Year="46" Num="034" LawType="Act" Lang="ja" PromulgateMonth="04" PromulgateDay="01">
  <LawNum>昭和四十六年法律第三十四号</LawNum>
  <LawBody>
    <LawTitle Kana="よきんほけんほう" Abbrev="預保法">預金保険法</LawTitle>
    <TOC>
      <TOCLabel>目次</TOCLabel>
      <TOCChapter Num="1"><ChapterTitle>第一章　総則</ChapterTitle></TOCChapter>
    </TOC>
    <MainProvision>
      <Chapter Num="1">
        <ChapterTitle>第一章　総則</ChapterTitle>
        <Article Num="1">
          <ArticleCaption>（目的）</ArticleCaption>
          <ArticleTitle>第一条</ArticleTitle>
          <Paragraph Num="1">
            <ParagraphNum/>
            <ParagraphSentence>
              <Sentence>この法律は、預金者等の保護を目的とする。</Sentence>
            </ParagraphSentence>
          </Paragraph>
        </Article>
        <Article Num="1_2">
          <ArticleCaption>（金融機関の自主性の尊重）</ArticleCaption>
          <ArticleTitle>第一条の二</ArticleTitle>
          <Paragraph Num="1">
            <ParagraphNum/>
            <ParagraphSentence>
              <Sentence>この法律の運用に当たつては、金融機関の自主性を尊重しなければならない。</Sentence>
            </ParagraphSentence>
          </Paragraph>
        </Article>
      </Chapter>
      <Chapter Num="2">
        <ChapterTitle>第二章　預金保険機構</ChapterTitle>
        <Section Num="1">
          <SectionTitle>第一節　総則</SectionTitle>
          <Article Num="3">
            <ArticleCaption>（機構の目的）</ArticleCaption>
            <ArticleTitle>第三条</ArticleTitle>
            <Paragraph Num="1">
              <ParagraphNum/>
              <ParagraphSentence>
                <Sentence>機構は、預金保険を行うことを目的とする。</Sentence>
              </ParagraphSentence>
            </Paragraph>
          </Article>
        </Section>
      </Chapter>
    </MainProvision>
  </LawBody>
</Law>`;

// Item / Subitem を含む Article
const ITEMIZED_LAW = `<?xml version="1.0" encoding="UTF-8"?>
<Law LawType="Act" Lang="ja">
  <LawNum>令和八年法律第一号</LawNum>
  <LawBody>
    <LawTitle>サンプル法</LawTitle>
    <MainProvision>
      <Article Num="2">
        <ArticleCaption>（定義）</ArticleCaption>
        <ArticleTitle>第二条</ArticleTitle>
        <Paragraph Num="1">
          <ParagraphNum/>
          <ParagraphSentence>
            <Sentence>この法律において、次の各号に掲げる用語の意義は、当該各号に定めるところによる。</Sentence>
          </ParagraphSentence>
          <Item Num="1">
            <ItemTitle>一</ItemTitle>
            <ItemSentence>
              <Sentence>金融機関　次に掲げるもの</Sentence>
            </ItemSentence>
            <Subitem1 Num="1">
              <Subitem1Title>イ</Subitem1Title>
              <Subitem1Sentence>
                <Sentence>銀行</Sentence>
              </Subitem1Sentence>
            </Subitem1>
            <Subitem1 Num="2">
              <Subitem1Title>ロ</Subitem1Title>
              <Subitem1Sentence>
                <Sentence>信用金庫</Sentence>
              </Subitem1Sentence>
            </Subitem1>
          </Item>
          <Item Num="2">
            <ItemTitle>二</ItemTitle>
            <ItemSentence>
              <Sentence>預金等　預金及び定期積金</Sentence>
            </ItemSentence>
          </Item>
        </Paragraph>
      </Article>
    </MainProvision>
  </LawBody>
</Law>`;

// SupplProvision (附則) と AppdxTable (別表)
const WITH_SUPPL_AND_APPDX = `<?xml version="1.0" encoding="UTF-8"?>
<Law LawType="Act" Lang="ja">
  <LawNum>令和八年法律第二号</LawNum>
  <LawBody>
    <LawTitle>附則別表サンプル法</LawTitle>
    <MainProvision>
      <Article Num="1">
        <ArticleCaption>（目的）</ArticleCaption>
        <ArticleTitle>第一条</ArticleTitle>
        <Paragraph Num="1">
          <ParagraphSentence>
            <Sentence>本則の条文。</Sentence>
          </ParagraphSentence>
        </Paragraph>
      </Article>
    </MainProvision>
    <SupplProvision Num="1">
      <SupplProvisionLabel>附　則</SupplProvisionLabel>
      <Article Num="1">
        <ArticleCaption>（施行期日）</ArticleCaption>
        <ArticleTitle>第一条</ArticleTitle>
        <Paragraph Num="1">
          <ParagraphSentence>
            <Sentence>この法律は、公布の日から施行する。</Sentence>
          </ParagraphSentence>
        </Paragraph>
      </Article>
    </SupplProvision>
    <AppdxTable>
      <AppdxTableTitle>別表第一（第三条関係）</AppdxTableTitle>
      <TableStruct>
        <TableRow>
          <TableColumn><Sentence>項目</Sentence></TableColumn>
          <TableColumn><Sentence>内容</Sentence></TableColumn>
        </TableRow>
        <TableRow>
          <TableColumn><Sentence>銀行</Sentence></TableColumn>
          <TableColumn><Sentence>主要金融機関</Sentence></TableColumn>
        </TableRow>
      </TableStruct>
    </AppdxTable>
  </LawBody>
</Law>`;

/** ========== Tests ========== */

describe('extractInlineText', () => {
  it('文字列をそのまま返す', () => {
    expect(extractInlineText('foo')).toBe('foo');
  });

  it('null / undefined は空文字', () => {
    expect(extractInlineText(null)).toBe('');
    expect(extractInlineText(undefined)).toBe('');
  });

  it('属性 (@_) は無視する', () => {
    expect(extractInlineText({ '@_Kana': 'よみ', '#text': '本文' })).toBe('本文');
  });

  it('入れ子オブジェクトを再帰的に連結', () => {
    expect(extractInlineText({ A: 'X', B: { C: 'Y' } })).toBe('XY');
  });

  it('配列要素を順序通り連結', () => {
    expect(extractInlineText(['a', 'b', { '#text': 'c' }])).toBe('abc');
  });

  it('数値も文字列化', () => {
    expect(extractInlineText({ '#text': 123 })).toBe('123');
  });
});

describe('parseLawXml — 最小法令 (改暦ノ布告)', () => {
  it('属性とメタデータをパースする', () => {
    const law = parseLawXml(MINIMAL_LAW);
    expect(law.law_type).toBe('CabinetOrder');
    expect(law.law_num).toBe('明治五年太政官布告第三百三十七号');
    expect(law.law_title).toBe('明治五年太政官布告第三百三十七号（改暦ノ布告）');
    expect(law.law_title_kana).toBe('かいれきのふこく');
    expect(law.abbrev).toBe('改暦の布告');
    expect(law.era).toBe('Meiji');
    expect(law.year).toBe('05');
    expect(law.promulgate_month).toBe('11');
    expect(law.promulgate_day).toBe('09');
  });

  it('Article がない場合でも articles=[] でパースできる (本文 Paragraph 直下)', () => {
    // 改暦ノ布告は MainProvision 直下に Paragraph しかない
    const law = parseLawXml(MINIMAL_LAW);
    // walkArticles は Article のみ拾うので、Paragraph 単独は articles に入らない
    expect(law.articles).toEqual([]);
  });
});

describe('parseLawXml — Chapter / Section 階層', () => {
  it('Chapter > Article を chapter_path 付きで articles 化', () => {
    const law = parseLawXml(CHAPTERED_LAW);
    expect(law.law_title).toBe('預金保険法');
    expect(law.abbrev).toBe('預保法');

    expect(law.articles).toHaveLength(3);

    expect(law.articles[0].article_num).toBe('1');
    expect(law.articles[0].caption).toBe('（目的）');
    expect(law.articles[0].chapter_path).toBe('第一章　総則');
    expect(law.articles[0].body_raw).toContain('預金者等の保護');

    expect(law.articles[1].article_num).toBe('1_2');
    expect(law.articles[1].caption).toBe('（金融機関の自主性の尊重）');
    expect(law.articles[1].chapter_path).toBe('第一章　総則');

    expect(law.articles[2].article_num).toBe('3');
    expect(law.articles[2].chapter_path).toBe('第二章　預金保険機構 第一節　総則');
  });

  it('TOC は body に混入しない', () => {
    const law = parseLawXml(CHAPTERED_LAW);
    // どの article body にも `目次` という TOCLabel が入らないこと
    for (const a of law.articles) {
      expect(a.body_raw).not.toContain('目次');
    }
  });
});

describe('parseLawXml — Item / Subitem を含む Article', () => {
  it('Item / Subitem の本文も body_raw に含まれる', () => {
    const law = parseLawXml(ITEMIZED_LAW);
    expect(law.articles).toHaveLength(1);
    const a = law.articles[0];
    expect(a.article_num).toBe('2');
    expect(a.caption).toBe('（定義）');
    expect(a.body_raw).toContain('金融機関');
    expect(a.body_raw).toContain('銀行');
    expect(a.body_raw).toContain('信用金庫');
    expect(a.body_raw).toContain('預金等');
    expect(a.body_raw).toContain('定期積金');
  });

  it('caption は body_raw に含まれない', () => {
    const law = parseLawXml(ITEMIZED_LAW);
    expect(law.articles[0].body_raw).not.toContain('（定義）');
  });

  it('ArticleTitle (第二条) は body_raw に含まれない', () => {
    const law = parseLawXml(ITEMIZED_LAW);
    expect(law.articles[0].body_raw).not.toContain('第二条');
  });
});

describe('parseLawXml — 附則 (SupplProvision)', () => {
  it('附則の Article は Suppl{idx}_ プレフィックス付きで articles 化', () => {
    const law = parseLawXml(WITH_SUPPL_AND_APPDX);
    const supplArticle = law.articles.find((a) => a.article_num.startsWith('Suppl'));
    expect(supplArticle).toBeDefined();
    expect(supplArticle?.article_num).toBe('Suppl1_1');
    expect(supplArticle?.caption).toBe('（施行期日）');
    expect(supplArticle?.body_raw).toContain('公布の日から施行する');
    expect(supplArticle?.chapter_path).toBe('附　則');
  });
});

describe('parseLawXml — 別表 (AppdxTable)', () => {
  it('別表は article_num=Appendix{連番} で articles 化', () => {
    const law = parseLawXml(WITH_SUPPL_AND_APPDX);
    const appdx = law.articles.find((a) => a.article_num.startsWith('Appendix'));
    expect(appdx).toBeDefined();
    expect(appdx?.article_num).toBe('Appendix1');
    expect(appdx?.caption).toBe('別表第一（第三条関係）');
    expect(appdx?.body_raw).toContain('銀行');
    expect(appdx?.body_raw).toContain('主要金融機関');
  });

  it('別表タイトルは body_raw に含まれない', () => {
    const law = parseLawXml(WITH_SUPPL_AND_APPDX);
    const appdx = law.articles.find((a) => a.article_num.startsWith('Appendix'));
    expect(appdx?.body_raw).not.toContain('別表第一');
  });
});

describe('parseLawXml — エラー系', () => {
  it('ルート要素が <Law> でないと XmlParseError', () => {
    expect(() => parseLawXml('<NotLaw></NotLaw>')).toThrow(XmlParseError);
  });

  it('LawBody が無いと XmlParseError', () => {
    const xml = '<Law><LawNum>令和八年法律第一号</LawNum></Law>';
    expect(() => parseLawXml(xml)).toThrow(XmlParseError);
  });

  it('LawNum が空 / 無いと XmlParseError', () => {
    const xml = '<Law LawType="Act"><LawBody><LawTitle>無番号法</LawTitle></LawBody></Law>';
    expect(() => parseLawXml(xml)).toThrow(XmlParseError);
  });

  it('壊れた XML は XmlParseError', () => {
    expect(() => parseLawXml('<Law><LawBody>')).toThrow(XmlParseError);
  });
});

describe('parseLawXml — メタデータ詳細', () => {
  it('属性が無い時は null が入る', () => {
    const law = parseLawXml(ITEMIZED_LAW);
    expect(law.era).toBeNull();
    expect(law.year).toBeNull();
    expect(law.promulgate_month).toBeNull();
    expect(law.abbrev).toBeNull();
    expect(law.enact_statement).toBeNull();
  });

  it('LawTitle に Abbrev が無いケース', () => {
    const law = parseLawXml(ITEMIZED_LAW);
    expect(law.law_title).toBe('サンプル法');
    expect(law.abbrev).toBeNull();
  });
});
