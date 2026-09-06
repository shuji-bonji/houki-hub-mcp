/**
 * Application Configuration
 * Centralized configuration management
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { name: string; version: string };

/**
 * Package information (dynamically loaded from package.json)
 */
export const PACKAGE_INFO = {
  name: packageJson.name,
  version: packageJson.version,
} as const;

/**
 * e-Gov Law API v2 endpoints
 * Spec: https://laws.e-gov.go.jp/api/2/swagger-ui
 *
 * NOTE: Query parameters use snake_case (law_title, law_type, ...) — verified 2026-04-23
 */
export const EGOV_API = {
  baseUrl: 'https://laws.e-gov.go.jp/api/2',
  /** Search laws by keyword/title/number */
  laws: 'https://laws.e-gov.go.jp/api/2/laws',
  /** Fetch law body (JSON tree) */
  lawData: (lawId: string) => `https://laws.e-gov.go.jp/api/2/law_data/${lawId}`,
  /** Fetch law revisions list */
  lawRevisions: (lawId: string) => `https://laws.e-gov.go.jp/api/2/law_revisions/${lawId}`,
  /** Public-facing URL（出典として返却） */
  publicLawUrl: (lawId: string) => `https://laws.e-gov.go.jp/law/${lawId}`,
} as const;

/**
 * e-Gov XML bulk download エンドポイント
 *
 * - file_section=1 : 全件 zip (all_xml.zip, 約 285 MB)
 * - file_section=2 : カテゴリ別 zip (category_cd=1〜42)
 * - file_section=3 : 日次差分 zip (update_date=YYYYMMDD, 過去 3 ヶ月)
 *
 * 仕様詳細: docs/PHASE2-SPIKE.md §1〜§3
 */
export const EGOV_BULK = {
  indexUrl: 'https://laws.e-gov.go.jp/bulkdownload/',
  /** 全件 zip (file_section=1) */
  fullDownloadUrl: 'https://laws.e-gov.go.jp/bulkdownload?file_section=1&only_xml_flag=true',
  /** カテゴリ別 zip (file_section=2) URL builder */
  categoryDownloadUrl: (categoryCd: number): string =>
    `https://laws.e-gov.go.jp/bulkdownload?file_section=2&category_cd=${categoryCd}&only_xml_flag=true`,
  /** 日次差分 zip (file_section=3) URL builder。YYYYMMDD 形式の日付を受ける */
  incrementalDownloadUrl: (yyyymmdd: string): string =>
    `https://laws.e-gov.go.jp/bulkdownload?file_section=3&update_date=${yyyymmdd}&only_xml_flag=true`,
} as const;

/**
 * HTTP request configuration
 */
export const HTTP_CONFIG = {
  userAgent: `${PACKAGE_INFO.name}/${PACKAGE_INFO.version}`,
  timeout: 30000,
  maxRetries: 3,
  /**
   * e-Gov API への同時リクエスト数の上限。
   * レート制限 (429) 対策。環境変数 HOUKI_EGOV_CONCURRENCY で上書き可能。
   * 既定値 4 は実測ベース（保守的）。
   */
  concurrency: Number.parseInt(process.env.HOUKI_EGOV_CONCURRENCY ?? '', 10) || 4,
} as const;

/**
 * Cache configuration
 */
export const CACHE_CONFIG = {
  xml: { maxSize: 20, name: 'XMLCache' },
  parsed: { maxSize: 50, name: 'ParseCache' },
  searchResults: { maxSize: 30, name: 'SearchCache' },
} as const;

/**
 * Runtime flags from environment
 */
export const RUNTIME_FLAGS = {
  /** Enable local bulk-download cache (SQLite FTS5) */
  bulkCache: process.env.HOUKI_HUB_BULK_CACHE === '1',
  /** Comma-separated list of extension packages to load */
  extensions: (process.env.HOUKI_HUB_EXTENSIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Enable debug logs */
  debug: process.env.DEBUG === '1' || process.env.DEBUG === 'true',
} as const;

/**
 * Phase 2 bulk-cache configuration (PHASE2-DESIGN.md §4.1)
 *
 * - HOUKI_EGOV_DB_PATH: full override of cache DB path (priority over XDG)
 * - XDG_CACHE_HOME: default base directory for cache
 * - HOUKI_EGOV_BULK_RETRY: max retries for full-zip download (default 3)
 * - HOUKI_EGOV_INCREMENTAL_LIMIT_DAYS: max days to look back for incremental
 *   diff zips before falling back to full download (default 90 — 公式仕様の上限)
 */
export const BULK_CONFIG = {
  /** override of cache DB path */
  dbPath: process.env.HOUKI_EGOV_DB_PATH,
  /** max retries on full-zip download failure */
  bulkRetry: Number.parseInt(process.env.HOUKI_EGOV_BULK_RETRY ?? '', 10) || 3,
  /** look-back days for incremental diff before full-DL fallback */
  incrementalLimitDays:
    Number.parseInt(process.env.HOUKI_EGOV_INCREMENTAL_LIMIT_DAYS ?? '', 10) || 90,
} as const;
