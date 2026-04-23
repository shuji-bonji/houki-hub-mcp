/**
 * 略称辞書（6分野カバー、約150語）
 *
 * 各分野の JSON ファイルを読み込み、略称 → 正式名称のマップを構築する。
 * law_id は筆者が確認済みのもののみ入れている（未確認は null）。
 */

import type { AbbreviationEntry } from '../types/index.js';
import { DOMAINS } from '../constants.js';

import tax from './tax.json' with { type: 'json' };
import labor from './labor.json' with { type: 'json' };
import accounting from './accounting.json' with { type: 'json' };
import commercial from './commercial.json' with { type: 'json' };
import civil from './civil.json' with { type: 'json' };
import administrative from './administrative.json' with { type: 'json' };

/** 全分野を結合した辞書 */
export const abbreviationEntries: AbbreviationEntry[] = [
  ...(tax as AbbreviationEntry[]),
  ...(labor as AbbreviationEntry[]),
  ...(accounting as AbbreviationEntry[]),
  ...(commercial as AbbreviationEntry[]),
  ...(civil as AbbreviationEntry[]),
  ...(administrative as AbbreviationEntry[]),
];

/** 略称→エントリのインデックス（略称 + aliases + 正式名称でヒット） */
const index: Map<string, AbbreviationEntry> = (() => {
  const m = new Map<string, AbbreviationEntry>();
  for (const entry of abbreviationEntries) {
    m.set(entry.abbr, entry);
    m.set(entry.formal, entry);
    for (const alias of entry.aliases ?? []) {
      m.set(alias, entry);
    }
  }
  return m;
})();

/**
 * 略称・通称・正式名称のいずれかから辞書エントリを引く。
 * 見つからない場合は null。
 */
export function resolveAbbreviation(name: string): AbbreviationEntry | null {
  const trimmed = name.trim();
  return index.get(trimmed) ?? null;
}

/** 辞書統計（起動時ログ用） */
export function getAbbreviationStats(): Record<string, number> {
  const stats: Record<string, number> = { total: abbreviationEntries.length };
  for (const d of DOMAINS) {
    stats[d] = abbreviationEntries.filter((e) => e.domain === d).length;
  }
  return stats;
}
