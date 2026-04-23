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
 */
export const EGOV_API = {
  baseUrl: 'https://laws.e-gov.go.jp/api/2',
  /** Search laws by keyword/title/number */
  lawsEndpoint: '/laws',
  /** Fetch law body (XML/JSON) */
  lawDataEndpoint: (lawId: string) => `/law_data/${lawId}`,
  /** Fetch law revisions */
  lawRevisionsEndpoint: (lawId: string) => `/law_revisions/${lawId}`,
} as const;

/**
 * e-Gov XML bulk download
 * Used as local-FTS source when JP_HOUKI_BULK_CACHE=1
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
  bulkCache: process.env.JP_HOUKI_BULK_CACHE === '1',
  /** Comma-separated list of extension packages to load */
  extensions: (process.env.JP_HOUKI_EXTENSIONS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  /** Enable debug logs */
  debug: process.env.DEBUG === '1' || process.env.DEBUG === 'true',
} as const;
