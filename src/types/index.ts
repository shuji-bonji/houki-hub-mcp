/**
 * Shared Types — egov-mcp 固有
 *
 * AbbreviationEntry は @shuji-bonji/houki-abbreviations から re-export している。
 * Single Source of Truth はそちら。
 */

import type { Domain, LawTypeCode, OutputFormat } from '../constants.js';

// houki-abbreviations から re-export（後方互換のため）
export type { AbbreviationEntry } from '@shuji-bonji/houki-abbreviations';

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
  /**
   * 階層の打ち切り深さ。例: 1=編まで, 2=章まで, 3=節まで。
   * 民法・会社法のような大規模法令でレスポンスサイズを抑える用途。
   * 省略時は全階層を返す。
   */
  depth?: number;
}

/** 全文検索引数（bulk cache モード時のみ有効） */
export interface SearchFulltextArgs {
  keyword: string;
  domain?: Domain;
  law_type?: LawTypeCode;
  limit?: number;
}
