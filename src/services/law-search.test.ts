/**
 * law-search.ts のテスト — Phase 2-7
 *
 * `:memory:` DB に `seedTestDb` (test-helpers/law-db-fixture) で 3 法令を投入し、
 * FTS ヒット / 略称 OR 展開 / status フィルタ / law_meta 捕捉 / sanitize を検証する。
 */

import type DatabaseT from 'better-sqlite3';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb } from '../db/index.js';
import { initSchema } from '../db/schema.js';
import { seedTestDb } from '../test-helpers/law-db-fixture.js';
import {
  buildFtsQueryWithAbbreviation,
  hasAnyArticle,
  hasAnyLaw,
  sanitizeFtsQuery,
  searchLawsInDb,
} from './law-search.js';

describe('sanitizeFtsQuery', () => {
  it('空白区切りを "tok" AND "tok" に整形する', () => {
    expect(sanitizeFtsQuery('適格請求書 発行事業者')).toBe('"適格請求書" AND "発行事業者"');
  });
  it('全角数字・全角スペース・大文字を正規化する', () => {
    expect(sanitizeFtsQuery('ＰＬ法　１２３')).toBe('"pl法" AND "123"');
  });
  it('FTS5 メタ文字を除去する', () => {
    expect(sanitizeFtsQuery('消費税"*:()税額控除')).toBe('"消費税" AND "税額控除"');
  });
  it('3 文字未満のトークンは落とす (trigram に乗らないため)', () => {
    expect(sanitizeFtsQuery('税')).toBe('');
    expect(sanitizeFtsQuery('民法')).toBe('');
    expect(sanitizeFtsQuery('民法 不法行為')).toBe('"不法行為"');
    expect(sanitizeFtsQuery('')).toBe('');
  });
  it('「第30条」は MATCH 式から取り除く (boost 専用)', () => {
    expect(sanitizeFtsQuery('適格請求書 第30条')).toBe('"適格請求書"');
    expect(sanitizeFtsQuery('第30条の2')).toBe('');
  });
});

describe('buildFtsQueryWithAbbreviation', () => {
  it('houki-egov 管轄の略称を formal に OR 展開する', () => {
    const r = buildFtsQueryWithAbbreviation('労基法');
    expect(r.query).toBe('("労基法") OR ("労働基準法")');
    expect(r.expandedFrom).toBe('労基法');
    expect(r.expandedTo).toBe('労働基準法');
  });
  it('正式名称そのものは展開しない', () => {
    const r = buildFtsQueryWithAbbreviation('消費税法');
    expect(r.query).toBe('"消費税法"');
    expect(r.expandedFrom).toBeUndefined();
  });
  it('辞書にない語は展開しない', () => {
    expect(buildFtsQueryWithAbbreviation('課税仕入れ').query).toBe('"課税仕入れ"');
  });
  it('通称 alias (適格請求書) も 消費税法 に OR 展開される', () => {
    const r = buildFtsQueryWithAbbreviation('適格請求書');
    expect(r.query).toBe('("適格請求書") OR ("消費税法")');
    expect(r.expandedTo).toBe('消費税法');
  });
  it('2 文字の略称 (消法) は formal だけで検索する', () => {
    const r = buildFtsQueryWithAbbreviation('消法');
    expect(r.query).toBe('"消費税法"');
    expect(r.expandedFrom).toBe('消法');
  });
  it('enableExpansion=false で展開を止められる', () => {
    expect(buildFtsQueryWithAbbreviation('労基法', { enableExpansion: false }).query).toBe(
      '"労基法"'
    );
  });
});

describe('searchLawsInDb', () => {
  let db: DatabaseT.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    initSchema(db);
    await seedTestDb(db);
  });

  afterEach(() => {
    closeDb(db);
  });

  it('hasAnyArticle / hasAnyLaw が投入後に true', () => {
    expect(hasAnyLaw(db)).toBe(true);
    expect(hasAnyArticle(db)).toBe(true);
  });

  it('条本文のキーワードで article ヒットを返す (snippet / 条番号付き)', () => {
    const r = searchLawsInDb(db, '適格請求書');
    expect(r.hits.length).toBe(2);
    for (const h of r.hits) {
      expect(h.match_type).toBe('article');
      expect(h.law_title).toBe('消費税法');
      expect(h.snippet).toContain('<b>適格請求書</b>');
    }
    expect(r.hits.map((h) => h.article_num).sort()).toEqual(['30', '30の2']);
  });

  it('同一法令の PreviousEnforced revision は重複ヒットしない', () => {
    const r = searchLawsInDb(db, '適格請求書', { limit: 30 });
    const revisions = new Set(r.hits.map((h) => h.law_revision_id));
    expect(revisions.size).toBe(1);
    expect([...revisions][0]).toBe('363AC0000000108_20231001_000000000000000');
  });

  it('略称 (消法) は OR 展開されて本文の「消費税」を含む条もヒットする', () => {
    const r = searchLawsInDb(db, '消法');
    expect(r.expanded).toEqual({ from: '消法', to: '消費税法' });
    expect(r.fts_query).toBe('"消費税法"');
    // law_meta (法令名) 経路 or article (「消費税」を含む本文) のどちらかで消費税法が拾える
    expect(r.hits.some((h) => h.law_title === '消費税法')).toBe(true);
  });

  it('全角数字のクエリでも半角で投入された本文にヒットする (Normalize-everywhere)', () => {
    const r = searchLawsInDb(db, '４５時間');
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].law_title).toBe('労働基準法');
    expect(r.hits[0].article_num).toBe('36');
  });

  it('Article を持たない法令は law_meta 経路で法令名から捕捉される', () => {
    const r = searchLawsInDb(db, '改暦ノ布告');
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].match_type).toBe('law_meta');
    expect(r.hits[0].law_id).toBe('105DF0000000337');
    expect(r.hits[0].article_num).toBeNull();
    expect(r.hits[0].score_reasons.join(' ')).toContain('law_meta');
  });

  it('law_meta 経路は abbrev (XML Abbrev) でもヒットする', () => {
    const r = searchLawsInDb(db, '改暦の布告');
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].match_type).toBe('law_meta');
    expect(r.hits[0].score_reasons).toContain('abbrev_match');
  });

  it('lawType で絞り込める', () => {
    expect(searchLawsInDb(db, '改暦ノ布告', { lawType: 'Act' }).hits.length).toBe(0);
    expect(searchLawsInDb(db, '改暦ノ布告', { lawType: 'CabinetOrder' }).hits.length).toBe(1);
  });

  it('2 文字の法令名 (改暦 / 消費税法の「消費」等) は法令名 LIKE で補完される', () => {
    const r = searchLawsInDb(db, '改暦');
    expect(r.hits.length).toBe(1);
    expect(r.hits[0].match_type).toBe('law_meta');
    expect(r.hits[0].law_id).toBe('105DF0000000337');
  });

  it('LIKE 補完でも PreviousEnforced は除外され、完全一致が最上位になる', () => {
    const r = searchLawsInDb(db, '消費税法');
    const shohi = r.hits.filter((h) => h.law_title === '消費税法');
    expect(new Set(shohi.map((h) => h.law_revision_id)).size).toBe(1);
    expect(r.hits[0].law_title).toBe('消費税法');
  });

  it('「第30条」を含むクエリは該当条が最上位になる', () => {
    const r = searchLawsInDb(db, '適格請求書 第30条');
    expect(r.hits[0].article_num).toBe('30');
    expect(r.hits[0].score_reasons).toContain('article_num_match');
  });

  it('limit で件数を絞る', () => {
    expect(searchLawsInDb(db, '適格請求書', { limit: 1 }).hits.length).toBe(1);
  });

  it('1 文字 / メタ文字のみのクエリは 0 件 (例外を投げない)', () => {
    expect(searchLawsInDb(db, '税').hits).toEqual([]);
    expect(searchLawsInDb(db, '"*:()').hits).toEqual([]);
    expect(searchLawsInDb(db, '').hits).toEqual([]);
  });

  it('2 文字トークンは FTS ヒットの本文に含まれるかで AND 絞り込みする', () => {
    // 「保存」は第30条の本文にだけある
    const r = searchLawsInDb(db, '適格請求書 保存');
    expect(r.hits.map((h) => h.article_num)).toEqual(['30']);
    // 本文にない 2 文字語を足すと 0 件
    expect(searchLawsInDb(db, '適格請求書 判例').hits).toEqual([]);
  });

  it('ヒットには e-Gov URL と score (0〜1) が付く', () => {
    const r = searchLawsInDb(db, '適格請求書');
    for (const h of r.hits) {
      expect(h.url).toBe('https://laws.e-gov.go.jp/law/363AC0000000108');
      expect(h.score).toBeGreaterThan(0);
      expect(h.score).toBeLessThanOrEqual(1);
    }
  });
});

describe('searchLawsInDb (空 DB)', () => {
  it('hasAnyArticle が false で検索は 0 件', () => {
    const db = new Database(':memory:');
    initSchema(db);
    expect(hasAnyArticle(db)).toBe(false);
    expect(searchLawsInDb(db, '適格請求書').hits).toEqual([]);
    closeDb(db);
  });
});
