import { describe, it, expect } from 'vitest';
import {
  handleResolveAbbreviation,
  handleSearchLaw,
  handleGetLaw,
  handleGetToc,
  handleSearchFulltext,
  handleExplainLawType,
  handleExplainBusinessLawRestriction,
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
});

// Phase 1 以降: search_law / get_law / get_toc / search_fulltext は実 API を叩くため、
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

describe('handleExplainBusinessLawRestriction', () => {
  it('returns explanation for known profession', async () => {
    const r = (await handleExplainBusinessLawRestriction({ name: '弁護士' })) as {
      found: boolean;
      info?: { law_name: string; clause: string };
    };
    expect(r.found).toBe(true);
    expect(r.info?.law_name).toBe('弁護士法');
    expect(r.info?.clause).toBe('第72条');
  });

  it('resolves by law name (税理士法 → 税理士)', async () => {
    const r = (await handleExplainBusinessLawRestriction({ name: '税理士法' })) as {
      found: boolean;
      info?: { profession: string };
    };
    expect(r.info?.profession).toBe('税理士');
  });

  it('resolves alias (社労士 → 社会保険労務士)', async () => {
    const r = (await handleExplainBusinessLawRestriction({ name: '社労士' })) as {
      found: boolean;
      info?: { profession: string };
    };
    expect(r.info?.profession).toContain('社会保険労務士');
  });

  it('returns hint for unknown name', async () => {
    const r = (await handleExplainBusinessLawRestriction({ name: '架空士業' })) as {
      found: boolean;
      hint?: string;
    };
    expect(r.found).toBe(false);
    expect(r.hint).toContain('試せる名前');
  });

  it('includes disclaimer in successful result', async () => {
    const r = (await handleExplainBusinessLawRestriction({ name: '弁護士' })) as {
      disclaimer?: string;
    };
    expect(r.disclaimer).toContain('有資格者に相談');
  });
});

describe('toolHandlers map', () => {
  it('registers all expected tools', () => {
    expect(Object.keys(toolHandlers).sort()).toEqual(
      [
        'explain_business_law_restriction',
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
});
