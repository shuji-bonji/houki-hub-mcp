/**
 * search_fulltext 系テスト共通の bulk DB fixture — Phase 2-7
 *
 * `:memory:` DB に `ingestZip` (createMemoryZip) で 4 revision (3 法令) を投入する。
 * - 消費税法 (現行 + PreviousEnforced の旧 revision)
 * - 労働基準法 (全角数字を含む本文 — normalize 検証用)
 * - 明治五年太政官布告 (Article を持たない — law_meta 経路の検証用)
 *
 * tsconfig の exclude 対象 (dist には含めない)。
 */

import type DatabaseT from 'better-sqlite3';
import { ingestZip } from '../services/bulk/ingester.js';
import { createMemoryZip } from '../services/bulk/zip-reader.js';

const BOM = '﻿';
const CRLF = '\r\n';
const HEADER =
  '法令種別,法令番号,法令名,法令名読み,旧法令名,公布日,改正法令名,改正法令番号,改正法令公布日,施行日,施行日備考,法令ID,本文URL,未施行';

/** 消費税法 (現行) */
export const CSV_SHOHI =
  '法律,昭和六十三年法律第百八号,消費税法,しょうひぜいほう,,昭和六十三年十二月三十日,,,,令和五年十月一日,,363AC0000000108,https://laws.e-gov.go.jp/law/363AC0000000108/20231001_000000000000000,';
export const XML_SHOHI = `<?xml version="1.0" encoding="UTF-8"?>
<Law Era="Showa" Year="63" Num="108" LawType="Act" Lang="ja" PromulgateMonth="12" PromulgateDay="30">
  <LawNum>昭和六十三年法律第百八号</LawNum>
  <LawBody>
    <LawTitle Kana="しょうひぜいほう" Abbrev="消費税法">消費税法</LawTitle>
    <MainProvision>
      <Chapter Num="1">
        <ChapterTitle>第一章　総則</ChapterTitle>
        <Article Num="1">
          <ArticleCaption>（趣旨等）</ArticleCaption>
          <ArticleTitle>第一条</ArticleTitle>
          <Paragraph Num="1"><ParagraphSentence><Sentence>この法律は、消費税について、課税の対象、納税義務者その他の事項を定める。</Sentence></ParagraphSentence></Paragraph>
        </Article>
      </Chapter>
      <Chapter Num="4">
        <ChapterTitle>第四章　税額控除等</ChapterTitle>
        <Article Num="30">
          <ArticleCaption>（仕入れに係る消費税額の控除）</ArticleCaption>
          <ArticleTitle>第三十条</ArticleTitle>
          <Paragraph Num="1"><ParagraphSentence><Sentence>事業者が国内において行う課税仕入れについては、適格請求書発行事業者から交付を受けた適格請求書の保存を要件として税額を控除する。</Sentence></ParagraphSentence></Paragraph>
        </Article>
        <Article Num="30_2">
          <ArticleCaption>（適格請求書の交付）</ArticleCaption>
          <ArticleTitle>第三十条の二</ArticleTitle>
          <Paragraph Num="1"><ParagraphSentence><Sentence>適格請求書発行事業者は、課税資産の譲渡等を行つた場合、適格請求書を交付しなければならない。</Sentence></ParagraphSentence></Paragraph>
        </Article>
      </Chapter>
    </MainProvision>
  </LawBody>
</Law>`;

/** 消費税法 (旧 revision — ingest 後に PreviousEnforced に変更する) */
export const CSV_SHOHI_OLD =
  '法律,昭和六十三年法律第百八号,消費税法,しょうひぜいほう,,昭和六十三年十二月三十日,,,,令和元年十月一日,,363AC0000000108,https://laws.e-gov.go.jp/law/363AC0000000108/20191001_000000000000000,';

/** 労働基準法 — 全角数字を含む本文 (normalize 検証用) */
export const CSV_ROUKI =
  '法律,昭和二十二年法律第四十九号,労働基準法,ろうどうきじゅんほう,,昭和二十二年四月七日,,,,令和六年四月一日,,322AC0000000049,https://laws.e-gov.go.jp/law/322AC0000000049/20240401_000000000000000,';
export const XML_ROUKI = `<?xml version="1.0" encoding="UTF-8"?>
<Law Era="Showa" Year="22" Num="049" LawType="Act" Lang="ja" PromulgateMonth="04" PromulgateDay="07">
  <LawNum>昭和二十二年法律第四十九号</LawNum>
  <LawBody>
    <LawTitle Kana="ろうどうきじゅんほう" Abbrev="労基法">労働基準法</LawTitle>
    <MainProvision>
      <Article Num="36">
        <ArticleCaption>（時間外及び休日の労働）</ArticleCaption>
        <ArticleTitle>第三十六条</ArticleTitle>
        <Paragraph Num="1"><ParagraphSentence><Sentence>使用者は、労働組合との書面による協定をし、これを行政官庁に届け出た場合においては、１か月について４５時間まで労働時間を延長することができる。</Sentence></ParagraphSentence></Paragraph>
      </Article>
    </MainProvision>
  </LawBody>
</Law>`;

/** 太政官布告 — Article を持たない法令 (law_meta 経路の検証用) */
export const CSV_FUKOKU =
  '政令,明治五年太政官布告第三百三十七号,明治五年太政官布告第三百三十七号（改暦ノ布告）,かいれきのふこく,,明治五年十一月九日,,,明治五年十一月九日,明治五年十一月九日,,105DF0000000337,https://laws.e-gov.go.jp/law/105DF0000000337/18721109_000000000000000,';
export const XML_FUKOKU = `<?xml version="1.0" encoding="UTF-8"?>
<Law Era="Meiji" Year="05" Num="337" LawType="CabinetOrder" Lang="ja" PromulgateMonth="11" PromulgateDay="09">
  <LawNum>明治五年太政官布告第三百三十七号</LawNum>
  <LawBody>
    <LawTitle Kana="かいれきのふこく" Abbrev="改暦の布告">明治五年太政官布告第三百三十七号（改暦ノ布告）</LawTitle>
    <MainProvision>
      <Paragraph Num="1"><ParagraphSentence><Sentence>今般改暦ノ儀別紙詔書ノ通被仰出候条此旨相達候事</Sentence></ParagraphSentence></Paragraph>
    </MainProvision>
  </LawBody>
</Law>`;

function buildCsv(rows: string[]): string {
  return BOM + HEADER + CRLF + rows.join(CRLF) + CRLF;
}

/** テスト DB を組み立てる (他テストからも流用できるよう export) */
export async function seedTestDb(db: DatabaseT.Database): Promise<void> {
  const zip = createMemoryZip([
    {
      path: 'all_law_list.csv',
      content: buildCsv([CSV_SHOHI, CSV_SHOHI_OLD, CSV_ROUKI, CSV_FUKOKU]),
    },
    { path: '363AC0000000108_20231001_000000000000000.xml', content: XML_SHOHI },
    { path: '363AC0000000108_20191001_000000000000000.xml', content: XML_SHOHI },
    { path: '322AC0000000049_20240401_000000000000000.xml', content: XML_ROUKI },
    { path: '105DF0000000337_18721109_000000000000000.xml', content: XML_FUKOKU },
  ]);
  await ingestZip({ db, zip, nowIso: '2026-09-01T00:00:00+09:00' });
  // 旧 revision を PreviousEnforced に (ingester は CSV から CurrentEnforced/UnEnforced しか付けない)
  db.prepare(
    `UPDATE laws SET current_revision_status = 'PreviousEnforced' WHERE law_revision_id = ?`
  ).run('363AC0000000108_20191001_000000000000000');
}
