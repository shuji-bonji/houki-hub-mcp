import { describe, it, expect } from 'vitest';
import { abbreviationEntries, resolveAbbreviation, getAbbreviationStats } from './index.js';
import { DOMAINS } from '../constants.js';
import type { AbbreviationEntry } from '../types/index.js';

// e-Gov law_id format:
//   - 3桁(元号+年) + 2文字(種別) + 10桁(番号)  例: 363AC0000000108
//   - 憲法のみ: "321CONSTITUTION"
const LAW_ID_PATTERN = /^(?:\d{3}[A-Z]{2}\d{10}|\d{3}CONSTITUTION)$/;

const VALID_LAW_TYPES = [
  'Act',
  'CabinetOrder',
  'ImperialOrdinance',
  'MinisterialOrdinance',
  'Rule',
] as const;

describe('abbreviation dictionary integrity', () => {
  it('has entries across all 6 domains', () => {
    const stats = getAbbreviationStats();
    expect(stats.total).toBeGreaterThan(100);
    for (const d of DOMAINS) {
      expect(stats[d], `domain ${d} has zero entries`).toBeGreaterThan(0);
    }
  });

  it('every entry has required fields (abbr, formal, domain)', () => {
    for (const e of abbreviationEntries) {
      expect(e.abbr, JSON.stringify(e)).toBeTruthy();
      expect(e.formal, JSON.stringify(e)).toBeTruthy();
      expect(DOMAINS, JSON.stringify(e)).toContain(e.domain);
    }
  });

  it('law_id (when set) matches e-Gov format', () => {
    for (const e of abbreviationEntries) {
      if (e.law_id != null) {
        expect(e.law_id, `${e.formal} has invalid law_id: ${e.law_id}`).toMatch(LAW_ID_PATTERN);
      }
    }
  });

  it('law_type (when set) is a valid e-Gov type', () => {
    for (const e of abbreviationEntries) {
      if (e.law_type) {
        expect(VALID_LAW_TYPES, JSON.stringify(e)).toContain(e.law_type);
      }
    }
  });

  it('abbr values are unique across files', () => {
    const seen = new Map<string, AbbreviationEntry>();
    const dupes: string[] = [];
    for (const e of abbreviationEntries) {
      const prev = seen.get(e.abbr);
      if (prev) {
        dupes.push(`"${e.abbr}": ${prev.formal} (${prev.domain}) vs ${e.formal} (${e.domain})`);
      } else {
        seen.set(e.abbr, e);
      }
    }
    expect(dupes, `duplicate abbreviations:\n${dupes.join('\n')}`).toHaveLength(0);
  });
});

describe('resolveAbbreviation()', () => {
  it('resolves known abbr', () => {
    const r = resolveAbbreviation('消法');
    expect(r).not.toBeNull();
    expect(r?.formal).toBe('消費税法');
    expect(r?.domain).toBe('tax');
    expect(r?.law_id).toBe('363AC0000000108');
  });

  it('resolves by formal name', () => {
    const r = resolveAbbreviation('消費税法');
    expect(r?.abbr).toBe('消法');
  });

  it('resolves by alias', () => {
    expect(resolveAbbreviation('消費税')?.formal).toBe('消費税法');
  });

  it('resolves popular 通称 via aliases', () => {
    expect(resolveAbbreviation('景品表示法')?.abbr).toBe('景表法');
    expect(resolveAbbreviation('PL法')?.formal).toBe('製造物責任法');
    expect(resolveAbbreviation('個人情報保護法')?.abbr).toBe('個情法');
    expect(resolveAbbreviation('独占禁止法')?.abbr).toBe('独禁法');
  });

  it('resolves newly added product-development law abbreviations', () => {
    expect(resolveAbbreviation('電子署名法')?.domain).toBe('commercial');
    expect(resolveAbbreviation('資金決済法')?.domain).toBe('commercial');
    expect(resolveAbbreviation('犯収法')?.domain).toBe('commercial');
    expect(resolveAbbreviation('プロ責法')?.domain).toBe('administrative');
    expect(resolveAbbreviation('電波法')?.domain).toBe('administrative');
    expect(resolveAbbreviation('フリーランス新法')?.domain).toBe('labor');
  });

  it('handles whitespace trimming', () => {
    expect(resolveAbbreviation('  消法  ')?.formal).toBe('消費税法');
  });

  it('returns null for unknown names', () => {
    expect(resolveAbbreviation('存在しない法律')).toBeNull();
    expect(resolveAbbreviation('')).toBeNull();
  });

  it('covers all 6 domains with representative abbreviations', () => {
    expect(resolveAbbreviation('消法')?.domain).toBe('tax');
    expect(resolveAbbreviation('労基法')?.domain).toBe('labor');
    expect(resolveAbbreviation('公認会計士法')?.domain).toBe('accounting');
    expect(resolveAbbreviation('会社')?.domain).toBe('commercial');
    expect(resolveAbbreviation('民')?.domain).toBe('civil');
    expect(resolveAbbreviation('個情法')?.domain).toBe('administrative');
  });
});
