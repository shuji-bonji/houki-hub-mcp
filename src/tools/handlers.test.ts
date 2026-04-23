import { describe, it, expect } from 'vitest';
import {
  handleResolveAbbreviation,
  handleSearchLaw,
  handleGetLaw,
  handleGetToc,
  handleSearchFulltext,
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

describe('stub handlers (Phase 0)', () => {
  it('search_law returns not_implemented marker', async () => {
    const r = (await handleSearchLaw({ keyword: 'test' })) as { status: string };
    expect(r.status).toBe('not_implemented');
  });

  it('get_law performs abbr resolution even while stubbed', async () => {
    const r = (await handleGetLaw({ law_name: '消法' })) as {
      status: string;
      resolved_abbreviation: { formal: string } | null;
    };
    expect(r.status).toBe('not_implemented');
    expect(r.resolved_abbreviation?.formal).toBe('消費税法');
  });

  it('get_toc performs abbr resolution even while stubbed', async () => {
    const r = (await handleGetToc({ law_name: '労基法' })) as {
      status: string;
      resolved_abbreviation: { formal: string } | null;
    };
    expect(r.status).toBe('not_implemented');
    expect(r.resolved_abbreviation?.formal).toBe('労働基準法');
  });

  it('search_fulltext returns not_implemented marker', async () => {
    const r = (await handleSearchFulltext({ keyword: 'test' })) as { status: string };
    expect(r.status).toBe('not_implemented');
  });
});

describe('toolHandlers map', () => {
  it('registers all expected tools', () => {
    expect(Object.keys(toolHandlers).sort()).toEqual(
      ['get_law', 'get_toc', 'resolve_abbreviation', 'search_fulltext', 'search_law'].sort()
    );
  });
});
