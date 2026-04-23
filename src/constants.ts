/**
 * Shared Constants
 */

/** e-Gov law_id の種別プレフィックス（例: Act=AC, CabinetOrder=CO, MinisterialOrdinance=MO） */
export const LAW_TYPE_CODES = {
  Act: 'AC',
  CabinetOrder: 'CO',
  ImperialOrdinance: 'IO',
  MinisterialOrdinance: 'MO',
  Rule: 'RU',
} as const;

export type LawTypeCode = keyof typeof LAW_TYPE_CODES;

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

/** ドメインタグ（略称辞書の分類） */
export const DOMAINS = [
  'tax',
  'labor',
  'accounting',
  'commercial',
  'civil',
  'administrative',
] as const;
export type Domain = (typeof DOMAINS)[number];
