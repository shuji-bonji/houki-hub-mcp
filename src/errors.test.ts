import { describe, expect, it } from 'vitest';
import { isLawServiceError, makeError, NEXT_ACTIONS } from './errors.js';

describe('makeError', () => {
  it('builds the minimum required shape', () => {
    const err = makeError('LAW_NOT_FOUND', '法令が見つかりません');
    expect(err.error).toBe('法令が見つかりません');
    expect(err.code).toBe('LAW_NOT_FOUND');
    expect(err.hint).toBeUndefined();
    expect(err.next_actions).toBeUndefined();
    expect(err.retryable).toBeUndefined();
  });

  it('attaches optional fields when provided', () => {
    const err = makeError('EGOV_RATE_LIMITED', '429 returned', {
      hint: 'wait',
      next_actions: [NEXT_ACTIONS.retryLater()],
      retryable: true,
      detail: { status: 429, url: 'https://example.com' },
    });
    expect(err.hint).toBe('wait');
    expect(err.next_actions).toHaveLength(1);
    expect(err.next_actions?.[0].action).toBe('retry_later');
    expect(err.retryable).toBe(true);
    expect(err.detail?.status).toBe(429);
  });

  it('drops empty next_actions array', () => {
    const err = makeError('LAW_NOT_FOUND', 'x', { next_actions: [] });
    expect(err.next_actions).toBeUndefined();
  });
});

describe('isLawServiceError', () => {
  it('accepts well-formed errors', () => {
    expect(isLawServiceError(makeError('LAW_NOT_FOUND', 'x'))).toBe(true);
  });

  it('rejects success-shaped objects', () => {
    expect(isLawServiceError({ markdown: '...', meta: {} })).toBe(false);
  });

  it('rejects null and primitives', () => {
    expect(isLawServiceError(null)).toBe(false);
    expect(isLawServiceError(undefined)).toBe(false);
    expect(isLawServiceError('error string')).toBe(false);
    expect(isLawServiceError({ error: 'x' })).toBe(false); // code 欠如
  });
});

describe('NEXT_ACTIONS presets', () => {
  it('resolveAbbreviation suggests resolve_abbreviation tool with example arg', () => {
    const a = NEXT_ACTIONS.resolveAbbreviation('消法');
    expect(a.action).toBe('resolve_abbreviation');
    expect(a.example).toEqual({ abbr: '消法' });
  });

  it('searchLaw suggests search_law tool with keyword example', () => {
    const a = NEXT_ACTIONS.searchLaw('消費税');
    expect(a.action).toBe('search_law');
    expect(a.example).toEqual({ keyword: '消費税' });
  });

  it('getToc suggests get_toc tool with law_name example', () => {
    const a = NEXT_ACTIONS.getToc('民法');
    expect(a.action).toBe('get_toc');
    expect(a.example).toEqual({ law_name: '民法' });
  });

  it('retryLater carries no example', () => {
    const a = NEXT_ACTIONS.retryLater();
    expect(a.action).toBe('retry_later');
    expect(a.example).toBeUndefined();
  });

  it('visitEgovSite generates law-specific URL when lawId given', () => {
    const a = NEXT_ACTIONS.visitEgovSite('325AC0000000204');
    expect(a.example?.url).toBe('https://laws.e-gov.go.jp/law/325AC0000000204');
  });

  it('delegateTo carries the target MCP hint as example', () => {
    const a = NEXT_ACTIONS.delegateTo('houki-nta');
    expect(a.action).toBe('delegate_to_mcp');
    expect(a.example).toEqual({ mcp: 'houki-nta' });
  });
});

describe('family-wide code 語彙 (v0.3.0+)', () => {
  it('SOURCE_RATE_LIMITED is accepted by makeError', () => {
    const err = makeError('SOURCE_RATE_LIMITED', '429 returned', {
      retryable: true,
      detail: { status: 429 },
    });
    expect(err.code).toBe('SOURCE_RATE_LIMITED');
    expect(err.retryable).toBe(true);
  });

  it('SOURCE_TIMEOUT is accepted', () => {
    expect(makeError('SOURCE_TIMEOUT', 'timeout').code).toBe('SOURCE_TIMEOUT');
  });

  it('SOURCE_API_ERROR is accepted', () => {
    expect(makeError('SOURCE_API_ERROR', 'api error').code).toBe('SOURCE_API_ERROR');
  });

  it('SOURCE_UNAVAILABLE is accepted', () => {
    expect(makeError('SOURCE_UNAVAILABLE', 'cannot reach host').code).toBe('SOURCE_UNAVAILABLE');
  });

  it('OUT_OF_SCOPE is accepted with delegateTo next_action', () => {
    const err = makeError('OUT_OF_SCOPE', '「消費税法基本通達」は houki-nta の管轄です', {
      next_actions: [NEXT_ACTIONS.delegateTo('houki-nta')],
    });
    expect(err.code).toBe('OUT_OF_SCOPE');
    expect(err.next_actions?.[0].action).toBe('delegate_to_mcp');
  });
});

describe('legacy EGOV_* code 後方互換 (v0.2.x からの移行期間)', () => {
  it('EGOV_RATE_LIMITED still type-checks (deprecated)', () => {
    expect(makeError('EGOV_RATE_LIMITED', 'legacy').code).toBe('EGOV_RATE_LIMITED');
  });

  it('EGOV_TIMEOUT still type-checks (deprecated)', () => {
    expect(makeError('EGOV_TIMEOUT', 'legacy').code).toBe('EGOV_TIMEOUT');
  });

  it('EGOV_API_ERROR still type-checks (deprecated)', () => {
    expect(makeError('EGOV_API_ERROR', 'legacy').code).toBe('EGOV_API_ERROR');
  });
});
