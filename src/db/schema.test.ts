/**
 * Phase 2-1: schema migration v0→v1 のテスト
 *
 * in-memory DB で schema が期待通りに作られていることを検証する。
 * better-sqlite3 が macOS / Linux で native 依存を持つため、
 * テスト実行環境ごとの rebuild に注意（memory: sandbox_native_rebuild_hazard）。
 */

import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, openDb } from './index.js';
import { clearAllData, getSchemaVersion, initSchema, SCHEMA_VERSION } from './schema.js';

function listTables(db: DatabaseT.Database): Set<string> {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
    .all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function listColumns(db: DatabaseT.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

describe('initSchema (Phase 2-1)', () => {
  let db: DatabaseT.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    initSchema(db);
  });

  afterEach(() => {
    closeDb(db);
  });

  it('schema_version を SCHEMA_VERSION に設定する', () => {
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it('Phase 2-1 で必要な全テーブルを作る', () => {
    const tables = listTables(db);
    expect(tables.has('schema_meta')).toBe(true);
    expect(tables.has('laws')).toBe(true);
    expect(tables.has('articles')).toBe(true);
    expect(tables.has('revisions_meta')).toBe(true);
    expect(tables.has('sync_state')).toBe(true);
    expect(tables.has('laws_fts')).toBe(true);
    expect(tables.has('articles_fts')).toBe(true);
  });

  it('laws テーブルに必須カラムが揃っている', () => {
    const cols = listColumns(db, 'laws');
    // 主キー + 識別子
    expect(cols.has('law_revision_id')).toBe(true);
    expect(cols.has('law_id')).toBe(true);
    // メタ
    expect(cols.has('law_type')).toBe(true);
    expect(cols.has('law_num')).toBe(true);
    expect(cols.has('law_title')).toBe(true);
    expect(cols.has('abbrev')).toBe(true);
    expect(cols.has('category')).toBe(true);
    // 日付系
    expect(cols.has('promulgation_date')).toBe(true);
    expect(cols.has('amendment_promulgate_date')).toBe(true);
    expect(cols.has('amendment_enforcement_date')).toBe(true);
    expect(cols.has('amendment_scheduled_enforcement_date')).toBe(true);
    // ステータス系（2 軸）
    expect(cols.has('current_revision_status')).toBe(true);
    expect(cols.has('repeal_status')).toBe(true);
    expect(cols.has('repeal_date')).toBe(true);
    expect(cols.has('remain_in_force')).toBe(true);
    expect(cols.has('amendment_type')).toBe(true);
    // 同期メタ
    expect(cols.has('updated')).toBe(true);
    expect(cols.has('fetched_at')).toBe(true);
    expect(cols.has('content_hash')).toBe(true);
  });

  it('articles テーブルに必須カラムが揃っている (body / body_raw 両持ち)', () => {
    const cols = listColumns(db, 'articles');
    expect(cols.has('id')).toBe(true);
    expect(cols.has('law_revision_id')).toBe(true);
    expect(cols.has('article_num')).toBe(true);
    expect(cols.has('caption')).toBe(true);
    expect(cols.has('chapter_path')).toBe(true);
    expect(cols.has('ord')).toBe(true);
    expect(cols.has('body')).toBe(true);
    expect(cols.has('body_raw')).toBe(true);
  });

  it('current_revision_status の CHECK 制約が効く', () => {
    insertLaw(db, { current_revision_status: 'CurrentEnforced', repeal_status: 'None' });
    expect(() =>
      insertLaw(db, {
        law_revision_id: 'BAD_REV',
        current_revision_status: 'InvalidStatus',
        repeal_status: 'None',
      })
    ).toThrow();
  });

  it('repeal_status の CHECK 制約が効く', () => {
    expect(() =>
      insertLaw(db, {
        law_revision_id: 'BAD_REV2',
        current_revision_status: 'CurrentEnforced',
        repeal_status: 'BogusRepeal',
      })
    ).toThrow();
  });

  it('articles 挿入で articles_fts に自動同期される (trigger)', () => {
    insertLaw(db);
    db.prepare(
      `INSERT INTO articles (law_revision_id, article_num, caption, chapter_path, ord, body, body_raw)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'TEST_REV',
      '1',
      '（目的）',
      '第一章',
      1,
      'この法律は預金者を保護する',
      'この法律は預金者を保護する'
    );

    const hits = db
      .prepare(`SELECT rowid FROM articles_fts WHERE articles_fts MATCH '預金者'`)
      .all() as Array<{ rowid: number }>;
    expect(hits.length).toBeGreaterThan(0);
  });

  it('article 削除で articles_fts からも消える (trigger)', () => {
    insertLaw(db);
    const ins = db
      .prepare(
        `INSERT INTO articles (law_revision_id, article_num, caption, chapter_path, ord, body, body_raw)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run('TEST_REV', '1', '（目的）', '第一章', 1, 'XYZUNIQUEWORD', 'XYZUNIQUEWORD');
    const aid = ins.lastInsertRowid;

    expect(
      (
        db
          .prepare(
            `SELECT count(*) as c FROM articles_fts WHERE articles_fts MATCH 'XYZUNIQUEWORD'`
          )
          .get() as { c: number }
      ).c
    ).toBe(1);

    db.prepare('DELETE FROM articles WHERE id = ?').run(aid);
    expect(
      (
        db
          .prepare(
            `SELECT count(*) as c FROM articles_fts WHERE articles_fts MATCH 'XYZUNIQUEWORD'`
          )
          .get() as { c: number }
      ).c
    ).toBe(0);
  });

  it('law 削除で article も CASCADE 削除される', () => {
    insertLaw(db);
    db.prepare(
      `INSERT INTO articles (law_revision_id, article_num, caption, chapter_path, ord, body, body_raw)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('TEST_REV', '1', '', '', 1, 'foo', 'foo');

    db.prepare('DELETE FROM laws WHERE law_revision_id = ?').run('TEST_REV');
    expect(
      (
        db
          .prepare(`SELECT count(*) as c FROM articles WHERE law_revision_id = 'TEST_REV'`)
          .get() as {
          c: number;
        }
      ).c
    ).toBe(0);
  });

  it('sync_state は id=1 の single-row 制約を持つ', () => {
    db.prepare(
      `INSERT INTO sync_state (id, last_sync_date, last_full_dl_at, total_laws, bulk_source)
       VALUES (1, '2026-05-08', '2026-05-08T00:00:00+09:00', 0, 'all_xml')`
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO sync_state (id, last_sync_date, last_full_dl_at, total_laws, bulk_source)
         VALUES (2, '2026-05-08', '2026-05-08T00:00:00+09:00', 0, 'all_xml')`
        )
        .run()
    ).toThrow();
  });

  it('clearAllData で laws/articles は消えるが schema_meta は残る', () => {
    insertLaw(db);
    db.prepare(
      `INSERT INTO articles (law_revision_id, article_num, caption, chapter_path, ord, body, body_raw)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('TEST_REV', '1', '', '', 1, 'foo', 'foo');

    clearAllData(db);

    expect((db.prepare('SELECT count(*) as c FROM laws').get() as { c: number }).c).toBe(0);
    expect((db.prepare('SELECT count(*) as c FROM articles').get() as { c: number }).c).toBe(0);
    // schema_version は維持
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it('initSchema は冪等 (二度呼んでも壊れない)', () => {
    initSchema(db);
    initSchema(db);
    expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(listTables(db).has('laws')).toBe(true);
  });
});

describe('openDb (in-memory)', () => {
  it(':memory: で開いて initSchema が走る', () => {
    const db = openDb(':memory:');
    try {
      expect(getSchemaVersion(db)).toBe(SCHEMA_VERSION);
    } finally {
      closeDb(db);
    }
  });

  it('closeDb は二度呼んでも壊れない', () => {
    const db = openDb(':memory:');
    closeDb(db);
    closeDb(db); // no-op であること
  });
});

// ===== ヘルパ =====

function insertLaw(
  db: DatabaseT.Database,
  overrides: Partial<{
    law_revision_id: string;
    current_revision_status: string;
    repeal_status: string;
  }> = {}
): void {
  db.prepare(
    `INSERT INTO laws (
      law_revision_id, law_id, law_type, law_num, law_title,
      promulgation_date, current_revision_status, repeal_status, remain_in_force,
      updated, fetched_at, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    overrides.law_revision_id ?? 'TEST_REV',
    'TEST_LAW',
    'Act',
    '令和八年法律第一号',
    'テスト法',
    '2026-01-01',
    overrides.current_revision_status ?? 'CurrentEnforced',
    overrides.repeal_status ?? 'None',
    0,
    '2026-05-08T00:00:00+09:00',
    '2026-05-08T00:00:00+09:00',
    'a'.repeat(64)
  );
}
