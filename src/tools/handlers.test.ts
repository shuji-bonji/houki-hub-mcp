import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { initSchema } from '../db/schema.js';
import { seedTestDb } from '../test-helpers/law-db-fixture.js';
import {
  handleExplainLawType,
  handleGetLaw,
  handleGetToc,
  handleResolveAbbreviation,
  handleSearchFulltext,
  handleSearchLaw,
  toolHandlers,
} from './handlers.js';

describe('handleResolveAbbreviation', () => {
  it('returns resolved entry for known abbreviation', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '消法' })) as {
      abbr: string;
      resolved: { formal: string; domain: string } | null;
    };
    expect(r.resolved).not.toBeNull();
    expect(r.resolved?.formal).toBe('消費税法');
    expect(r.resolved?.domain).toBe('tax');
  });

  it('returns null with note for unknown input', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '存在しない法律' })) as {
      resolved: unknown;
      note?: string;
    };
    expect(r.resolved).toBeNull();
    expect(r.note).toContain('辞書に該当なし');
  });

  it('unknown input also returns next_actions hint to call search_law', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '存在しない法律' })) as {
      next_actions?: Array<{ action: string }>;
    };
    expect(r.next_actions?.[0]?.action).toBe('search_law');
  });

  it('returned entry includes new fields (category, source_mcp_hint) from houki-abbreviations', async () => {
    const r = (await handleResolveAbbreviation({ abbr: '消法' })) as {
      resolved: { category: string; source_mcp_hint: string } | null;
    };
    expect(r.resolved?.category).toBe('law');
    expect(r.resolved?.source_mcp_hint).toBe('houki-egov');
  });
});

// search_law / get_law / get_toc / search_fulltext は実 API を叩くため、
// 単体テストでは fetch をモックする必要がある。
// ここでは未知の法令名に対するエラーパスのみ検証する（fetch しない経路）。
describe('Phase 1 handlers — error paths (no network)', () => {
  it('get_law returns error for empty law_name', async () => {
    const r = (await handleGetLaw({ law_name: '' })) as { error?: string };
    expect(r.error).toBeTruthy();
  });

  it('search_law returns error for empty keyword', async () => {
    const r = (await handleSearchLaw({ keyword: '' })) as { error?: string };
    expect(r.error).toBeTruthy();
  });

  it('search_law returns LLM-readable error shape (code + hint) for empty keyword', async () => {
    const r = (await handleSearchLaw({ keyword: '' })) as {
      error: string;
      code: string;
      hint?: string;
    };
    expect(r.code).toBe('INVALID_ARGUMENT');
    expect(r.hint).toBeTruthy();
  });

  it('handlers are exported as functions', () => {
    expect(typeof handleSearchLaw).toBe('function');
    expect(typeof handleGetLaw).toBe('function');
    expect(typeof handleGetToc).toBe('function');
    expect(typeof handleSearchFulltext).toBe('function');
  });

  it('toolHandlers map includes get_law_revisions', () => {
    expect(Object.keys(toolHandlers)).toContain('get_law_revisions');
  });
});

describe('handleExplainLawType', () => {
  it('returns explanation for known law type', async () => {
    const r = (await handleExplainLawType({ name: '政令' })) as {
      found: boolean;
      info?: { name: string; enacting_body: string; binds_citizens: boolean };
    };
    expect(r.found).toBe(true);
    expect(r.info?.name).toBe('政令');
    expect(r.info?.enacting_body).toBe('内閣');
    expect(r.info?.binds_citizens).toBe(true);
  });

  it('resolves alias (施行令 → 政令)', async () => {
    const r = (await handleExplainLawType({ name: '施行令' })) as {
      found: boolean;
      info?: { name: string };
    };
    expect(r.found).toBe(true);
    expect(r.info?.name).toBe('政令');
  });

  it('explains 通達 as non-binding on citizens', async () => {
    const r = (await handleExplainLawType({ name: '通達' })) as {
      found: boolean;
      info?: { binds_citizens: boolean; can_set_penalties: boolean };
    };
    expect(r.info?.binds_citizens).toBe(false);
    expect(r.info?.can_set_penalties).toBe(false);
  });

  it('returns hint for unknown name', async () => {
    const r = (await handleExplainLawType({ name: '架空法令' })) as {
      found: boolean;
      hint?: string;
    };
    expect(r.found).toBe(false);
    expect(r.hint).toContain('試せる名前');
  });
});

describe('toolHandlers map', () => {
  it('registers all expected tools (v0.2.0 — explain_business_law_restriction を削除)', () => {
    expect(Object.keys(toolHandlers).sort()).toEqual(
      [
        'explain_law_type',
        'get_law',
        'get_law_revisions',
        'get_toc',
        'resolve_abbreviation',
        'search_fulltext',
        'search_law',
      ].sort()
    );
  });

  it('does NOT include explain_business_law_restriction (removed in v0.2.0)', () => {
    expect(Object.keys(toolHandlers)).not.toContain('explain_business_law_restriction');
  });
});

// ---------------------------------------------------------------------------
// search_fulltext (Phase 2-7) — bulk DB 経路と API フォールバック経路
// ---------------------------------------------------------------------------
describe('handleSearchFulltext (Phase 2-7)', () => {
  // `:memory:` は openDb 側で毎回新規 DB になるため、投入済み DB をファイルとして用意する
  const tmpDir = `${process.env.TMPDIR ?? '/tmp'}/houki-egov-test-${process.pid}`;
  const dbPath = `${tmpDir}/laws.db`;
  const emptyDbPath = `${tmpDir}/empty.db`;

  beforeEach(async () => {
    const { mkdirSync, rmSync } = await import('node:fs');
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    const db = new Database(dbPath);
    initSchema(db);
    await seedTestDb(db);
    closeDb(db);
  });

  afterEach(async () => {
    const { rmSync } = await import('node:fs');
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('bulk DB にデータがあれば source=bulk で FTS ヒットと freshness を返す', async () => {
    const r = await handleSearchFulltext({ keyword: '適格請求書' }, { dbPath });
    expect(r.source).toBe('bulk');
    if (r.source !== 'bulk') return;
    expect(r.count).toBe(2);
    expect(r.hits[0].law_title).toBe('消費税法');
    expect(r.hits[0].snippet).toContain('<b>');
    expect(r.freshness?.last_sync_date).toBe('2026-09-01');
    expect(['fresh', 'stale', 'outdated']).toContain(r.freshness?.staleness);
    expect(r.filters.domain.applied).toBe(false);
    expect(r.expanded_keywords).toEqual({ from: '適格請求書', to: '消費税法' });
  });

  it('law_type / limit 引数が効く', async () => {
    const r = await handleSearchFulltext(
      { keyword: '適格請求書', law_type: 'CabinetOrder', limit: 1 },
      { dbPath }
    );
    if (r.source !== 'bulk') throw new Error('expected bulk');
    expect(r.count).toBe(0);
    expect(r.filters.law_type).toBe('CabinetOrder');
    const r2 = await handleSearchFulltext({ keyword: '適格請求書', limit: 1 }, { dbPath });
    if (r2.source !== 'bulk') throw new Error('expected bulk');
    expect(r2.count).toBe(1);
  });

  it('domain は受け付けるが applied=false + note', async () => {
    const r = await handleSearchFulltext({ keyword: '適格請求書', domain: 'tax' }, { dbPath });
    if (r.source !== 'bulk') throw new Error('expected bulk');
    expect(r.filters.domain.requested).toBe('tax');
    expect(r.filters.domain.note).toContain('Phase 2-13');
  });

  it('bulk DL 未実行 (articles 0 件) なら search_law フォールバック + 誘導 note', async () => {
    // 空 keyword で search_law を呼ばせ、ネットワークに出ずに INVALID_ARGUMENT を返させる
    const r = await handleSearchFulltext({ keyword: '' }, { dbPath: emptyDbPath });
    expect(r.source).toBe('api-fallback');
    if (r.source !== 'api-fallback') return;
    expect(r.note).toContain('bulk DL 未実行');
    expect(r.note).toContain('--bulk-download-everything');
    expect(r.next_actions[0].action).toBe('bulk_download_everything');
    expect((r.fallback as { code?: string }).code).toBe('INVALID_ARGUMENT');
  });
});
