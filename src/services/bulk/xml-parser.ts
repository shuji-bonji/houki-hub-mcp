/**
 * 法令 XML パーサ — Phase 2-3
 *
 * e-Gov 法令標準 XML を `ParsedLaw` に変換する。bulk DL zip 内の各 XML を
 * ingester で読んで articles テーブルに格納する。
 *
 * XML 構造 (PHASE2-SPIKE-FOLLOWUP.md §3-2):
 *
 *   Law (root, attrs: Era, Year, Num, LawType, PromulgateMonth, PromulgateDay)
 *   ├── LawNum                                  「昭和四十六年法律第三十四号」
 *   └── LawBody
 *       ├── LawTitle (attrs: Kana, Abbrev, AbbrevKana)
 *       ├── EnactStatement                      制定文 (旧法に多い)
 *       ├── TOC                                  目次 (検索ノイズなので除外)
 *       ├── MainProvision
 *       │   ├── Chapter (Num) > ChapterTitle > Section / Article
 *       │   ├── Section (Num) > SectionTitle > Subsection / Article
 *       │   ├── Subsection / Division
 *       │   └── Article (Num) > ArticleCaption + ArticleTitle + Paragraph[]
 *       │       └── Paragraph (Num) > ParagraphNum + ParagraphSentence > Sentence + Item[]
 *       │           └── Item (Num) > ItemTitle + ItemSentence > Sentence + Subitem[]
 *       ├── SupplProvision (Num)                附則。配下にも Article がある
 *       └── AppdxTable / AppdxNote / AppdxFig / AppdxStyle  別表・別記
 *
 * 設計判断 (PHASE2-DESIGN.md §5.3-5.5):
 *  - TOC は body に含めない (重複ノイズになる)
 *  - 本則 (MainProvision) と附則 (SupplProvision) の Article は同じ articles テーブルに格納
 *    - 附則 article_num は `Suppl{idx}_{原 Num}` 形式 (例: `Suppl1_1`)
 *  - 別表 (AppdxTable / AppdxNote / AppdxFig / AppdxStyle) は article_num=`Appendix{idx}` で格納
 *  - chapter_path は walk 中に蓄積した Title を半角空白で連結 (例: `第一章　総則 第一節　目的`)
 *  - body_raw は ArticleCaption / ArticleTitle を除く全テキストを連結 (改行は Paragraph 境界)
 */

import { XMLParser } from 'fast-xml-parser';

/** パース後の法令メタ */
export interface ParsedLaw {
  /** Law 属性 LawType (`Act` | `CabinetOrder` | `Rule` | etc) */
  law_type: string;
  /** LawNum テキスト (例: `昭和四十六年法律第三十四号`) */
  law_num: string;
  /** LawTitle テキスト */
  law_title: string;
  /** LawTitle Kana 属性 (空文字なら null) */
  law_title_kana: string | null;
  /** LawTitle Abbrev 属性 (空文字なら null) */
  abbrev: string | null;
  /** Law Era 属性 (`Showa` | `Heisei` | `Reiwa` | `Meiji` | etc) */
  era: string | null;
  /** Law Year 属性 (例: `46` for 昭和46年) */
  year: string | null;
  /** Law PromulgateMonth + PromulgateDay (zero-padded) */
  promulgate_month: string | null;
  promulgate_day: string | null;
  /** EnactStatement テキスト (制定文。旧法に多い、なければ null) */
  enact_statement: string | null;
  /** 本則 + 附則 + 別表をまとめた articles 配列 (DB に 1 行ずつ INSERT する) */
  articles: ParsedArticle[];
}

/** parsedLaw.articles の各要素 */
export interface ParsedArticle {
  /**
   * Article 識別子。
   * - 本則: Article@Num の値そのまま (例: `1`, `12_2` (12 条の 2))
   * - 附則: `Suppl{idx}_{Num}` (例: `Suppl1_1`)
   * - 別表: `Appendix{idx}` (`AppdxTable` / `AppdxNote` / `AppdxFig` / `AppdxStyle` をまとめて)
   */
  article_num: string;
  /** ArticleCaption テキスト or 別表タイトル (空文字 → null) */
  caption: string | null;
  /** Chapter > Section > Subsection > Division を連結したパス (空可) */
  chapter_path: string;
  /** Article 内の全テキスト (Caption / Title 除く) を連結したもの */
  body_raw: string;
}

/** XML パースのエラー */
export class XmlParseError extends Error {
  constructor(message: string) {
    super(`XML parse error: ${message}`);
    this.name = 'XmlParseError';
  }
}

/** 配列で扱う必要のある要素一覧 (XMLParser の isArray 用) */
const ARRAY_ELEMENTS = new Set([
  'Chapter',
  'Section',
  'Subsection',
  'Division',
  'Article',
  'Paragraph',
  'Item',
  'Sentence',
  'Subitem1',
  'Subitem2',
  'Subitem3',
  'Subitem4',
  'Subitem5',
  'Subitem6',
  'Subitem7',
  'Subitem8',
  'Subitem9',
  'Subitem10',
  'Column',
  'TableRow',
  'TableColumn',
  'SupplProvision',
  'AppdxTable',
  'AppdxNote',
  'AppdxFig',
  'AppdxStyle',
]);

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  isArray: (name) => ARRAY_ELEMENTS.has(name),
  parseTagValue: false, // 数字タグも文字列のまま (例: <ArticleTitle>第一条</ArticleTitle>)
  parseAttributeValue: false,
});

/**
 * 法令標準 XML をパースして ParsedLaw を返す。
 *
 * @throws XmlParseError ルート要素が <Law> でない、LawBody がない、等の場合
 */
export function parseLawXml(xml: string): ParsedLaw {
  let tree: Record<string, unknown>;
  try {
    tree = xmlParser.parse(xml) as Record<string, unknown>;
  } catch (err) {
    throw new XmlParseError(`fast-xml-parser に失敗: ${(err as Error).message}`);
  }

  const law = tree.Law as Record<string, unknown> | undefined;
  if (!law) throw new XmlParseError('ルート要素 <Law> が見つかりません');

  const lawBody = law.LawBody as Record<string, unknown> | undefined;
  if (!lawBody) throw new XmlParseError('<LawBody> が見つかりません');

  const titleNode = lawBody.LawTitle as Record<string, unknown> | string | undefined;
  const law_title = extractInlineText(titleNode).trim();
  const law_title_kana = strOrNull(getAttr(titleNode, 'Kana'));
  const abbrev = strOrNull(getAttr(titleNode, 'Abbrev'));

  const law_num = extractInlineText(law.LawNum).trim();
  if (!law_num) throw new XmlParseError('<LawNum> が空、または見つかりません');

  const articles: ParsedArticle[] = [];

  // 本則
  if (lawBody.MainProvision) {
    walkArticles(lawBody.MainProvision, [], articles, '');
  }

  // 附則 (複数ある場合あり)
  const supplProvisions = asArray(lawBody.SupplProvision);
  for (let i = 0; i < supplProvisions.length; i++) {
    const suppl = supplProvisions[i] as Record<string, unknown>;
    const supplLabel = extractInlineText(suppl.SupplProvisionLabel).trim() || `附則${i + 1}`;
    walkArticles(suppl, [supplLabel], articles, `Suppl${i + 1}_`);

    // SupplProvision 直下の Paragraph も「附則本文」として article 1 件にまとめる
    if (Array.isArray(suppl.Paragraph) && suppl.Paragraph.length > 0) {
      const supplBody = (suppl.Paragraph as unknown[])
        .map((p) => extractInlineText(p))
        .filter(Boolean)
        .join('\n');
      if (supplBody) {
        // Article が 1 つも下にぶら下がっていない場合のみ追加 (重複回避)
        const hasArticleInThisSuppl = articles.some(
          (a) => a.article_num.startsWith(`Suppl${i + 1}_`) && !a.article_num.endsWith('_intro')
        );
        if (!hasArticleInThisSuppl) {
          articles.push({
            article_num: `Suppl${i + 1}_intro`,
            caption: supplLabel,
            chapter_path: supplLabel,
            body_raw: supplBody,
          });
        }
      }
    }
  }

  // 別表
  appendAppendices(lawBody, articles);

  return {
    law_type: getAttr(law, 'LawType') ?? '',
    law_num,
    law_title,
    law_title_kana,
    abbrev,
    era: strOrNull(getAttr(law, 'Era')),
    year: strOrNull(getAttr(law, 'Year')),
    promulgate_month: strOrNull(getAttr(law, 'PromulgateMonth')),
    promulgate_day: strOrNull(getAttr(law, 'PromulgateDay')),
    enact_statement: strOrNull(extractInlineText(lawBody.EnactStatement)),
    articles,
  };
}

/**
 * Chapter / Section / Subsection / Division を再帰的に降りて Article を articles に詰める。
 * MainProvision 直下に Article が直接ぶら下がっているケースも扱う (旧法に多い)。
 */
function walkArticles(
  node: unknown,
  pathStack: string[],
  out: ParsedArticle[],
  numPrefix: string
): void {
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  // 階層タグ → タイトルタグの対応
  const HIERARCHY: Array<readonly [string, string]> = [
    ['Chapter', 'ChapterTitle'],
    ['Section', 'SectionTitle'],
    ['Subsection', 'SubsectionTitle'],
    ['Division', 'DivisionTitle'],
  ];

  for (const [tag, titleTag] of HIERARCHY) {
    const children = obj[tag];
    if (Array.isArray(children)) {
      for (const child of children) {
        const cobj = child as Record<string, unknown>;
        const title = extractInlineText(cobj[titleTag]).trim();
        const newStack = title ? [...pathStack, title] : pathStack;
        walkArticles(cobj, newStack, out, numPrefix);
      }
    }
  }

  // この階層の直下に Article がある場合
  const articles = obj.Article;
  if (Array.isArray(articles)) {
    for (const a of articles) {
      const aobj = a as Record<string, unknown>;
      const num = (getAttr(aobj, 'Num') ?? '').trim();
      if (!num) continue;
      const caption = extractInlineText(aobj.ArticleCaption).trim();
      const body = extractArticleBody(aobj);
      out.push({
        article_num: `${numPrefix}${num}`,
        caption: caption || null,
        chapter_path: pathStack.join(' '),
        body_raw: body,
      });
    }
  }
}

/**
 * Article から body_raw を抽出。ArticleCaption / ArticleTitle は除外。
 * Paragraph 境界で改行を入れる。
 */
function extractArticleBody(article: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, val] of Object.entries(article)) {
    if (key.startsWith('@_')) continue;
    if (key === 'ArticleCaption' || key === 'ArticleTitle') continue;
    // Paragraph は配列、各 paragraph を 1 行として
    if (key === 'Paragraph' && Array.isArray(val)) {
      for (const p of val) {
        const t = extractInlineText(p).trim();
        if (t) lines.push(t);
      }
      continue;
    }
    const text = extractInlineText(val).trim();
    if (text) lines.push(text);
  }
  return lines.join('\n');
}

/**
 * AppdxTable / AppdxNote / AppdxFig / AppdxStyle をまとめて articles に追加する。
 * article_num は `Appendix{連番}` (種別跨ぎで通し番号)。
 */
function appendAppendices(lawBody: Record<string, unknown>, out: ParsedArticle[]): void {
  let idx = 0;
  const APPDX_TYPES: Array<readonly [string, string]> = [
    ['AppdxTable', 'AppdxTableTitle'],
    ['AppdxNote', 'AppdxNoteTitle'],
    ['AppdxFig', 'AppdxFigTitle'],
    ['AppdxStyle', 'AppdxStyleTitle'],
  ];
  for (const [tag, titleTag] of APPDX_TYPES) {
    const list = asArray(lawBody[tag]);
    for (const node of list) {
      idx++;
      const obj = node as Record<string, unknown>;
      const title = extractInlineText(obj[titleTag]).trim();
      // タイトルだけ除いた body
      const body = extractInlineTextExcept(obj, [titleTag]).trim();
      out.push({
        article_num: `Appendix${idx}`,
        caption: title || null,
        chapter_path: title || '別表',
        body_raw: body,
      });
    }
  }
}

/**
 * 任意のノードからすべてのテキスト内容を再帰的に取り出して連結する。
 * 属性 (`@_*`) は無視する。
 */
export function extractInlineText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'boolean') return '';
  if (Array.isArray(node)) {
    return node.map(extractInlineText).join('');
  }
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    let text = '';
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('@_')) continue;
      text += extractInlineText(val);
    }
    return text;
  }
  return '';
}

/** extractInlineText から特定のキーを除外して取り出す */
function extractInlineTextExcept(node: Record<string, unknown>, exclude: string[]): string {
  let text = '';
  const ex = new Set(exclude);
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('@_')) continue;
    if (ex.has(key)) continue;
    text += extractInlineText(val);
  }
  return text;
}

/** 属性取得ヘルパ。`@_X` 形式 */
function getAttr(node: unknown, attrName: string): string | undefined {
  if (node == null || typeof node !== 'object') return undefined;
  const v = (node as Record<string, unknown>)[`@_${attrName}`];
  return typeof v === 'string' ? v : undefined;
}

/** undefined / 空文字 を null に正規化 */
function strOrNull(v: string | undefined | null): string | null {
  if (v == null) return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** 単一値も配列にラップする */
function asArray<T>(v: T | T[] | undefined): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
