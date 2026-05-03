/**
 * Application Configuration
 * Centralized configuration management
 */

import { createRequire } from 'module';
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
 * e-Gov XML bulk download
 * Used as local-FTS source when HOUKI_HUB_BULK_CACHE=1
 */
export const EGOV_BULK = {
  indexUrl: 'https://laws.e-gov.go.jp/bulkdownload/',
  /** Per-category bulk archive URL (populated at fetch time) */
  categoryBase: 'https://laws.e-gov.go.jp/download/',
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
