/**
 * SQLite スキーマと初期化（Phase 2 — bulk DL + FTS5）
 *
 * 設計詳細: docs/PHASE2-DESIGN.md §3.2
 *
 * テーブル概要:
 *  - laws            : 1 行 = 1 revision。`law_revision_id` 主キー
 *                      (`{lawId}_{enforcementDate}_{amendmentLawId}` 形式)
 *  - articles        : 1 行 = 1 条 or 別表 1 つ。法令配下に複数。`body` は normalize 済み
 *  - revisions_meta  : 全履歴 (CurrentEnforced + UnEnforced + PreviousEnforced) のメタ
 *  - sync_state      : single-row テーブル。bulk DL の同期状態を保持
 *  - laws_fts        : 法令名 / 略称 / 番号 / カテゴリ FTS5 (standalone)
 *  - articles_fts    : 条本文 FTS5 (external content, articles 連動)
 *
 * 設計判断 (DESIGN §3.3):
 *  - law_revision_id を PK にして 1 法令 N revision に対応
 *  - mission は revisions_meta に raw JSON で持つ（API 上常に 'New' のため列にしない）
 *  - body / body_raw 二重持ち（検索は body、表示は body_raw）— Normalize-everywhere
 *  - articles_fts は external content + triggers で auto-sync
 *  - laws_fts は standalone（PK が TEXT のため content_rowid を持てない）
 *  - tokenizer は houki-nta-mcp と同じ `trigram` (SQLite ≥ 3.34 builtin)。
 *    日本語混在テキストの N-gram 検索を可能にする。`unicode61` は CJK を 1 トークンとして
 *    扱うため部分一致検索ができない
 *
 * SCHEMA_VERSION を上げたら initSchema() がマイグレーション戦略を切替える。
 */

import type DatabaseT from 'better-sqlite3';

/**
 * スキーマバージョン。スキーマ変更時に上げる。
 *
 * - v1: 初版（Phase 2-1）— laws / articles / revisions_meta / sync_state / FTS5 2 種
 * - v2: Phase 2-7 (v0.5.0) — テーブル定義は同じだが、`articles.body` と `laws_fts` の各列を
 *       `normalizeJpText` 済みで投入するよう ingester を変更した。v1 で作った DB は
 *       content_hash が一致して再 ingest が no-op になってしまうため、バージョン不一致で
 *       DROP & CREATE し、`--bulk-download-everything` の再実行で全件を normalize 済みにする
 */
export const SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ===== schema_meta (key-value で schema_version 等を保持) =====
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ===== laws (1 行 = 1 revision) =====
CREATE TABLE IF NOT EXISTS laws (
  law_revision_id TEXT PRIMARY KEY,
  law_id TEXT NOT NULL,
  law_type TEXT NOT NULL,
  law_num TEXT NOT NULL,
  law_title TEXT NOT NULL,
  law_title_kana TEXT,
  abbrev TEXT,
  category TEXT,

  promulgation_date TEXT NOT NULL,
  amendment_promulgate_date TEXT,
  amendment_enforcement_date TEXT,
  amendment_scheduled_enforcement_date TEXT,

  current_revision_status TEXT NOT NULL
    CHECK (current_revision_status IN
      ('CurrentEnforced', 'UnEnforced', 'PreviousEnforced', 'Repeal')),
  repeal_status TEXT NOT NULL
    CHECK (repeal_status IN ('None', 'Repeal', 'LossOfEffectiveness', 'Expire')),
  repeal_date TEXT,
  remain_in_force INTEGER NOT NULL DEFAULT 0,
  amendment_type TEXT,

  updated TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  content_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_laws_law_id ON laws(law_id);
CREATE INDEX IF NOT EXISTS idx_laws_status ON laws(current_revision_status, repeal_status);
CREATE INDEX IF NOT EXISTS idx_laws_enforce ON laws(amendment_enforcement_date);
CREATE INDEX IF NOT EXISTS idx_laws_updated ON laws(updated);

-- ===== articles (1 行 = 1 条 or 別表 1 つ) =====
-- 'caption' / 'body' は articles_fts と column 名を揃える (external content)
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY,
  law_revision_id TEXT NOT NULL REFERENCES laws(law_revision_id) ON DELETE CASCADE,
  article_num TEXT NOT NULL,
  caption TEXT,
  chapter_path TEXT,
  ord INTEGER NOT NULL,
  body TEXT NOT NULL,
  body_raw TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_articles_law ON articles(law_revision_id, ord);
CREATE INDEX IF NOT EXISTS idx_articles_num ON articles(article_num);

-- ===== revisions_meta (全履歴のメタ) =====
CREATE TABLE IF NOT EXISTS revisions_meta (
  law_revision_id TEXT PRIMARY KEY,
  law_id TEXT NOT NULL,
  mission TEXT,
  updated TEXT NOT NULL,
  raw_revision_info_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revmeta_law ON revisions_meta(law_id);

-- ===== sync_state (single-row テーブル) =====
CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync_date TEXT NOT NULL,
  last_full_dl_at TEXT NOT NULL,
  total_laws INTEGER NOT NULL DEFAULT 0,
  bulk_source TEXT NOT NULL DEFAULT 'all_xml',
  schema_version INTEGER NOT NULL DEFAULT 2
);

-- ===== FTS5 =====

-- laws_fts: 法令名 / 略称 / 番号 / カテゴリ検索 (standalone — manual sync)
CREATE VIRTUAL TABLE IF NOT EXISTS laws_fts USING fts5(
  law_revision_id UNINDEXED,
  law_title,
  law_title_kana,
  abbrev,
  law_num,
  category,
  tokenize = 'trigram'
);

-- articles_fts: 条本文 FTS (external content — triggers で自動同期)
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  body,
  caption,
  content='articles',
  content_rowid='id',
  tokenize = 'trigram'
);

-- articles_fts auto-sync triggers (houki-nta-mcp document_fts と同じパターン)
CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, body, caption)
  VALUES (new.id, new.body, new.caption);
END;
CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, body, caption)
  VALUES ('delete', old.id, old.body, old.caption);
END;
CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, body, caption)
  VALUES ('delete', old.id, old.body, old.caption);
  INSERT INTO articles_fts(rowid, body, caption)
  VALUES (new.id, new.body, new.caption);
END;
`;

/**
 * DB を初期化（スキーマ作成 + バージョン記録）。
 *
 * 既にスキーマがある場合は CREATE IF NOT EXISTS で skip。
 * バージョン不一致時は dropAndRecreate でフルリセット
 * （v1 は初版なので追加マイグレーションパスはまだない）。
 */
export function initSchema(db: DatabaseT.Database): void {
  db.exec(SCHEMA_SQL);
  const cur = getSchemaVersion(db);
  if (cur === null) {
    db.prepare('INSERT INTO schema_meta(key, value) VALUES (?, ?)').run(
      'schema_version',
      String(SCHEMA_VERSION)
    );
    return;
  }
  if (cur === SCHEMA_VERSION) return;

  // 想定外の遷移は DROP & CREATE (v2 以降で個別 migration を追加する)
  dropAndRecreate(db);
}

/** schema_meta の schema_version を更新する */
function setSchemaVersion(db: DatabaseT.Database, v: number): void {
  db.prepare(
    `INSERT INTO schema_meta(key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(String(v));
}

/** schema_meta から schema_version を読む。未設定なら null */
export function getSchemaVersion(db: DatabaseT.Database): number | null {
  try {
    const row = db.prepare('SELECT value FROM schema_meta WHERE key = ?').get('schema_version') as
      | { value?: string }
      | undefined;
    if (!row?.value) return null;
    const n = parseInt(row.value, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** スキーマ全体を DROP して再作成（単純マイグレーション） */
function dropAndRecreate(db: DatabaseT.Database): void {
  db.exec(`
    DROP TRIGGER IF EXISTS articles_au;
    DROP TRIGGER IF EXISTS articles_ad;
    DROP TRIGGER IF EXISTS articles_ai;
    DROP TABLE IF EXISTS articles_fts;
    DROP TABLE IF EXISTS laws_fts;
    DROP TABLE IF EXISTS articles;
    DROP TABLE IF EXISTS revisions_meta;
    DROP TABLE IF EXISTS sync_state;
    DROP TABLE IF EXISTS laws;
    DROP TABLE IF EXISTS schema_meta;
  `);
  db.exec(SCHEMA_SQL);
  setSchemaVersion(db, SCHEMA_VERSION);
}

/**
 * DB の中身を全削除（テスト用 / 強制再 DL 用）。
 * スキーマは保持し、行データだけ消す。
 */
export function clearAllData(db: DatabaseT.Database): void {
  db.exec(`
    DELETE FROM articles;
    DELETE FROM revisions_meta;
    DELETE FROM laws;
    DELETE FROM sync_state;
    INSERT INTO laws_fts(laws_fts) VALUES ('rebuild');
    INSERT INTO articles_fts(articles_fts) VALUES ('rebuild');
  `);
}
