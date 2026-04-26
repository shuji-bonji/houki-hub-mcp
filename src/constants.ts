/**
 * Shared Constants — egov-mcp 固有
 *
 * 略称辞書系の定数（LAW_TYPE_CODES / DOMAINS）は @shuji-bonji/houki-abbreviations
 * から re-export している。Single Source of Truth はそちら。
 */

// houki-abbreviations から共有定数を re-export
export { LAW_TYPE_CODES, DOMAINS } from '@shuji-bonji/houki-abbreviations';
export type { LawTypeCode, Domain } from '@shuji-bonji/houki-abbreviations';

/** 元号コード（e-Gov law_id の先頭1文字） */
export const ERA_CODES = {
  1: 'Meiji',
  2: 'Taisho',
  3: 'Showa',
  4: 'Heisei',
  5: 'Reiwa',
} as const;

/** 検索結果・取得件数の上限 */
export const LIMITS = {
  searchDefault: 10,
  searchMax: 50,
  fulltextDefault: 10,
  fulltextMax: 30,
} as const;

/** 出力フォーマットの列挙 */
export const OUTPUT_FORMATS = ['markdown', 'json', 'toc'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];
