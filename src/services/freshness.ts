/**
 * Freshness — レスポンスに埋め込む staleness 情報の判定ヘルパ。
 *
 * Phase 2-10 — houki-nta-mcp v0.9.3 と同パターンで `@shuji-bonji/houki-abbreviations`
 * v0.4.1+ から `StalenessLevel` / `STALENESS_THRESHOLDS` / `judgeStaleness` /
 * `computeDaysSince` を import する。家族で同じ感覚で staleness を判定できる。
 *
 * 判定の主軸: `sync_state.last_sync_date`
 *  - 全件 DL でも incremental でも、最後の同期完了日 を起点にする
 *  - 全件 DL 直後でも incremental が回っていれば last_sync_date は今日まで進む
 *  - 30 日以上 incremental が回っていなければ outdated 判定 → 警告付与
 *
 * staleness レベル (閾値は houki-abbreviations の `STALENESS_THRESHOLDS`):
 *  - fresh:    < `fresh_days` (1 週間以内)
 *  - stale:    < `stale_days` (1 ヶ月以内)
 *  - outdated: それ以上 → 警告メッセージを付ける
 *
 * 設計詳細: docs/PHASE2-DESIGN.md §6.3
 */

import {
  type StalenessLevel,
  STALENESS_THRESHOLDS,
  computeDaysSince,
  judgeStaleness,
} from '@shuji-bonji/houki-abbreviations';
import type DatabaseT from 'better-sqlite3';

// houki-abbreviations から re-export して既存利用者の互換性を保つ
export type { StalenessLevel };
export { STALENESS_THRESHOLDS, judgeStaleness };

/**
 * sync_state ベースの freshness 情報。MCP レスポンスに埋め込む。
 *
 * houki-nta-mcp の `FreshnessRange` と概念は同じだが、houki-egov-mcp は
 * sync_state single-row テーブルを参照するので構造が単純化されている。
 */
export interface FreshnessInfo {
  /** sync_state.last_sync_date (YYYY-MM-DD) — 最後の同期完了日 */
  last_sync_date: string;
  /** sync_state.last_full_dl_at (ISO 8601) — 最後の全件 DL 実行時刻 */
  last_full_dl_at: string;
  /** last_sync_date 基準の staleness レベル */
  staleness: StalenessLevel;
  /** last_sync_date からの経過日数 */
  days_since_sync: number;
  /** outdated 時のみ付く再 bulk DL 案内メッセージ */
  warning?: string;
}

/**
 * outdated 時の警告メッセージを生成（fresh / stale は undefined）。
 *
 * 警告メッセージ文言は MCP 固有 (CLI コマンド名) のため houki-egov-mcp に残す。
 */
export function buildWarning(
  staleness: StalenessLevel,
  daysSince: number,
  bulkDownloadHint = '`houki-egov-mcp --bulk-download-incremental` (または `--bulk-download-everything`)'
): string | undefined {
  if (staleness !== 'outdated') return undefined;
  return `bulk DB が ${daysSince} 日前のデータです。最新化するには ${bulkDownloadHint} を実行してください`;
}

/**
 * sync_state テーブルから FreshnessInfo を構築。
 *
 * @param db SQLite DB (initSchema 済み)
 * @param bulkDownloadHint 警告に埋め込む CLI コマンド表記の上書き
 * @param nowMs テスト用に Date.now() を差し替えるためのフック
 * @returns sync_state がない (初回 DL 前) なら null
 */
export function summarizeFreshness(
  db: DatabaseT.Database,
  bulkDownloadHint?: string,
  nowMs: number = Date.now()
): FreshnessInfo | null {
  const row = db
    .prepare('SELECT last_sync_date, last_full_dl_at FROM sync_state WHERE id = 1')
    .get() as { last_sync_date: string; last_full_dl_at: string } | undefined;

  if (!row) return null;

  const days_since_sync = computeDaysSince(row.last_sync_date, nowMs);
  const staleness = judgeStaleness(days_since_sync);
  const result: FreshnessInfo = {
    last_sync_date: row.last_sync_date,
    last_full_dl_at: row.last_full_dl_at,
    staleness,
    days_since_sync,
  };
  const warning = buildWarning(staleness, days_since_sync, bulkDownloadHint);
  if (warning) result.warning = warning;
  return result;
}
