import { describe, expect, it } from 'vitest';
import {
  findLawHierarchy,
  LAW_HIERARCHY,
  type LawHierarchyEntry,
  listLawHierarchyNames,
} from './law-hierarchy.js';

describe('LAW_HIERARCHY data integrity', () => {
  it('contains key 9 categories', () => {
    expect(Object.keys(LAW_HIERARCHY)).toEqual(
      expect.arrayContaining([
        '憲法',
        '法律',
        '政令',
        '省令',
        '規則',
        '条例',
        '告示',
        '訓令',
        '通達',
      ])
    );
  });

  it('every entry has required fields', () => {
    for (const [name, entry] of Object.entries(LAW_HIERARCHY)) {
      expect(entry.name, name).toBeTruthy();
      expect(entry.enacting_body, name).toBeTruthy();
      expect(typeof entry.hierarchy_rank, name).toBe('number');
      expect(['national', 'local', 'agency-internal', 'judicial'], name).toContain(entry.level);
      expect(typeof entry.binds_citizens, name).toBe('boolean');
      expect(typeof entry.can_set_penalties, name).toBe('boolean');
      expect(entry.description, name).toBeTruthy();
      expect(Array.isArray(entry.examples), name).toBe(true);
      expect(entry.examples.length, name).toBeGreaterThan(0);
      expect(Array.isArray(entry.sources), name).toBe(true);
    }
  });

  it('hierarchy_rank reflects expected order (Constitution < Act < Cabinet Order < Ministerial Ordinance)', () => {
    expect(LAW_HIERARCHY['憲法'].hierarchy_rank).toBeLessThan(LAW_HIERARCHY['法律'].hierarchy_rank);
    expect(LAW_HIERARCHY['法律'].hierarchy_rank).toBeLessThan(LAW_HIERARCHY['政令'].hierarchy_rank);
    expect(LAW_HIERARCHY['政令'].hierarchy_rank).toBeLessThan(LAW_HIERARCHY['省令'].hierarchy_rank);
  });

  it('agency-internal entries do not bind citizens directly', () => {
    expect(LAW_HIERARCHY['通達'].binds_citizens).toBe(false);
    expect(LAW_HIERARCHY['訓令'].binds_citizens).toBe(false);
  });

  it('only laws/政令/省令/条例 can set penalties', () => {
    expect(LAW_HIERARCHY['法律'].can_set_penalties).toBe(true);
    expect(LAW_HIERARCHY['政令'].can_set_penalties).toBe(true);
    expect(LAW_HIERARCHY['省令'].can_set_penalties).toBe(true);
    expect(LAW_HIERARCHY['条例'].can_set_penalties).toBe(true);
    expect(LAW_HIERARCHY['通達'].can_set_penalties).toBe(false);
    expect(LAW_HIERARCHY['告示'].can_set_penalties).toBe(false);
  });
});

describe('findLawHierarchy()', () => {
  it('resolves by exact name', () => {
    const r = findLawHierarchy('政令') as LawHierarchyEntry;
    expect(r.name).toBe('政令');
    expect(r.enacting_body).toBe('内閣');
  });

  it('resolves by alias (施行令 → 政令)', () => {
    expect(findLawHierarchy('施行令')?.name).toBe('政令');
    expect(findLawHierarchy('施行規則')?.name).toBe('省令');
    expect(findLawHierarchy('日本国憲法')?.name).toBe('憲法');
  });

  it('resolves by law_type_code (Act → 法律)', () => {
    expect(findLawHierarchy('Act')?.name).toBe('法律');
    expect(findLawHierarchy('CabinetOrder')?.name).toBe('政令');
    expect(findLawHierarchy('MinisterialOrdinance')?.name).toBe('省令');
  });

  it('handles whitespace trimming', () => {
    expect(findLawHierarchy('  通達  ')?.name).toBe('通達');
  });

  it('returns null for unknown name', () => {
    expect(findLawHierarchy('知らない種別')).toBeNull();
  });
});

describe('listLawHierarchyNames()', () => {
  it('returns at least 9 names', () => {
    expect(listLawHierarchyNames().length).toBeGreaterThanOrEqual(9);
  });
});
