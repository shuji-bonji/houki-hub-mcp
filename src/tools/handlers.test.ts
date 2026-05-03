import { describe, it, expect } from 'vitest';
import {
  handleResolveAbbreviation,
  handleSearchLaw,
  handleGetLaw,
  handleGetToc,
  handleSearchFulltext,
  handleExplainLawType,
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
