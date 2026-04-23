/**
 * Shared Types
 */

import type { Domain, LawTypeCode, OutputFormat } from '../constants.js';

/** 略称辞書エントリ */
export interface AbbreviationEntry {
  /** 略称・通称。例: "消法", "民" */
  abbr: string;
  /** 正式名称。例: "消費税法", "民法" */
  formal: string;
  /** e-Gov law_id。verified済みのもののみ格納。未確認は null */
  law_id: string | null;
  /** 法令番号。例: "昭和六十三年法律第百八号" */
  law_num?: string;
  /** 法令種別 */
  law_type?: LawTypeCode;
  /** 分野タグ */
  domain: Domain;
  /** 同義の別表記 */
  aliases?: string[];
  /** 備考（例: "通称: 電子帳簿保存法"） */
  note?: string;
}

/** 法令検索引数 */
export interface SearchLawArgs {
  keyword: string;
  law_type?: LawTypeCode;
  domain?: Domain;
  limit?: number;
}

/** 条文取得引数 */
export interface GetLawArgs {
  /** 法令名または略称。例: "消法", "消費税法" */
  law_name: string;
  /** 条番号。format=toc の場合は省略可 */
  article?: string;
  /** 項番号 */
  paragraph?: number;
  /** 号番号 */
  item?: number;
  /** 出力形式 */
  format?: OutputFormat;
  /** 時点指定（YYYY-MM-DD）。e-Gov API v2 の改正前条文取得に対応 */
  at?: string;
}

/** 目次取得引数 */
export interface GetTocArgs {
  law_name: string;
  at?: string;
}

/** 全文検索引数（bulk cache モード時のみ有効） */
export interface SearchFulltextArgs {
  keyword: string;
  domain?: Domain;
  law_type?: LawTypeCode;
  limit?: number;
}
