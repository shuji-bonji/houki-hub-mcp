/**
 * DB ファイルパス管理 + Database open/close ヘルパ
 *
 * デフォルトのキャッシュ DB パス: `${XDG_CACHE_HOME:-~/.cache}/houki-egov-mcp/laws.db`
 *
 * 環境変数 (config.ts BULK_CONFIG / RUNTIME_FLAGS):
 *  - `XDG_CACHE_HOME` (XDG Base Directory) があればそこを使う
 *  - `HOUKI_EGOV_DB_PATH` で完全に上書き可能（テスト・運用カスタム用）
 */

import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import type DatabaseT from 'better-sqlite3';

import { BULK_CONFIG } from '../config.js';
import { initSchema } from './schema.js';

/**
 * デフォルトキャッシュ DB のパスを返す（OS / 環境変数を考慮）。
 *
 * 優先順位:
 *  1. `HOUKI_EGOV_DB_PATH` (BULK_CONFIG.dbPath)
 *  2. `XDG_CACHE_HOME/houki-egov-mcp/laws.db`
 *  3. `~/.cache/houki-egov-mcp/laws.db`
 */
export function defaultDbPath(): string {
  if (BULK_CONFIG.dbPath) return BULK_CONFIG.dbPath;
  const xdg = process.env.XDG_CACHE_HOME;
  const cacheRoot = xdg && xdg.length > 0 ? xdg : resolve(homedir(), '.cache');
  return resolve(cacheRoot, 'houki-egov-mcp', 'laws.db');
}

/**
 * DB を open し、schema を初期化して返す。
 *
 * @param dbPath ファイルパス。`:memory:` を渡すと in-memory DB（テスト用）。未指定なら `defaultDbPath()`
 */
export function openDb(dbPath?: string): DatabaseT.Database {
  const path = dbPath ?? defaultDbPath();
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new Database(path);
  initSchema(db);
  return db;
}

/** 安全に close する（既に閉じていても無害） */
export function closeDb(db: DatabaseT.Database): void {
  if (db.open) {
    db.close();
  }
}

export { initSchema, clearAllData, getSchemaVersion, SCHEMA_VERSION } from './schema.js';
