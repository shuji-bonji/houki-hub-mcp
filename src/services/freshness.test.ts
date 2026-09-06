/**
 * Phase 2-10: freshness 計算のテスト
 *
 * houki-abbreviations v0.4.1 の純関数を採用しているので、
 * このファイルでは DB アクセス層と警告メッセージ生成 (MCP 固有) を検証する。
 */

import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { initSchema } from '../db/schema.js';
import {
  buildWarning,
  judgeStaleness,
  STALENESS_THRESHOLDS,
  summarizeFreshness,
} from './freshness.js';

/** sync_state を seed する (single-row 制約 id=1) */
function seedSyncState(
  db: DatabaseT.Database,
  last_sync_date: string,
  last_full_dl_at = '2026-04-01T00:00:00+09:00'
): void {
  db.prepare(
    `INSERT INTO sync_state (id, last_sync_date, last_full_dl_at, total_laws, bulk_source)
     VALUES (1, ?, ?, 0, 'all_xml')
     ON CONFLICT(id) DO UPDATE SET
       last_sync_date = excluded.last_sync_date,
       last_full_dl_at = excluded.last_full_dl_at`
  ).run(last_sync_date, last_full_dl_at);
}

describe('buildWarning', () => {
  it('staleness=fresh では undefined', () => {
    expect(buildWarning('fresh', 0)).toBeUndefined();
    expect(buildWarning('fresh', 6)).toBeUndefined();
  });

  it('staleness=stale でも undefined (warning は outdated のみ)', () => {
    expect(buildWarning('stale', 10)).toBeUndefined();
  });

  it('staleness=outdated で警告メッセージを返す', () => {
    const msg = buildWarning('outdated', 45);
    expect(msg).toBeDefined();
    expect(msg).toContain('45 日前');
    expect(msg).toContain('bulk-download');
  });

  it('bulkDownloadHint で警告内のコマンド表記を上書きできる', () => {
    const msg = buildWarning('outdated', 60, '`my-custom-cmd`');
    expect(msg).toContain('`my-custom-cmd`');
  });
});

describe('summarizeFreshness (sync_state ベース)', () => {
  let db: DatabaseT.Database;
  // 固定の "今" を使ってテストを deterministic にする
  const NOW = Date.parse('2026-05-09T12:00:00+09:00');

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });

  afterEach(() => {
    closeDb(db);
  });

  it('sync_state がまだないと null を返す', () => {
    expect(summarizeFreshness(db, undefined, NOW)).toBeNull();
  });

  it('1 日前の同期は fresh', () => {
    seedSyncState(db, '2026-05-08'); // NOW から 1 日前
    const info = summarizeFreshness(db, undefined, NOW);
    expect(info).not.toBeNull();
    expect(info?.staleness).toBe('fresh');
    expect(info?.days_since_sync).toBe(1);
    expect(info?.warning).toBeUndefined();
  });

  it('閾値の境界 — `fresh_days` 直前は fresh', () => {
    // STALENESS_THRESHOLDS.fresh_days - 1 日前
    const days = STALENESS_THRESHOLDS.fresh_days - 1;
    const date = new Date(NOW - days * 86400_000).toISOString().slice(0, 10);
    seedSyncState(db, date);
    const info = summarizeFreshness(db, undefined, NOW);
    expect(info?.staleness).toBe('fresh');
  });

  it('閾値の境界 — `fresh_days` ちょうどは stale', () => {
    const days = STALENESS_THRESHOLDS.fresh_days;
    const date = new Date(NOW - days * 86400_000).toISOString().slice(0, 10);
    seedSyncState(db, date);
    const info = summarizeFreshness(db, undefined, NOW);
    expect(info?.staleness).toBe('stale');
  });

  it('1 ヶ月超の同期は outdated + 警告付き', () => {
    seedSyncState(db, '2026-04-01'); // NOW から 38 日前
    const info = summarizeFreshness(db, undefined, NOW);
    expect(info?.staleness).toBe('outdated');
    expect(info?.days_since_sync).toBeGreaterThanOrEqual(STALENESS_THRESHOLDS.stale_days);
    expect(info?.warning).toBeDefined();
    expect(info?.warning).toContain('日前');
  });

  it('last_sync_date と last_full_dl_at がレスポンスに含まれる', () => {
    seedSyncState(db, '2026-05-07', '2026-05-01T03:00:00+09:00');
    const info = summarizeFreshness(db, undefined, NOW);
    expect(info?.last_sync_date).toBe('2026-05-07');
    expect(info?.last_full_dl_at).toBe('2026-05-01T03:00:00+09:00');
  });

  it('bulkDownloadHint を warning に伝搬する', () => {
    seedSyncState(db, '2026-04-01');
    const info = summarizeFreshness(db, '`MY_CMD`', NOW);
    expect(info?.warning).toContain('`MY_CMD`');
  });

  it('judgeStaleness は houki-abbreviations の閾値で動作している', () => {
    // 純関数の sanity check (re-export 経由)
    expect(judgeStaleness(0)).toBe('fresh');
    expect(judgeStaleness(STALENESS_THRESHOLDS.fresh_days - 1)).toBe('fresh');
    expect(judgeStaleness(STALENESS_THRESHOLDS.fresh_days)).toBe('stale');
    expect(judgeStaleness(STALENESS_THRESHOLDS.stale_days)).toBe('outdated');
  });
});
