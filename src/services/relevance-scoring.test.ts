/**
 * relevance-scoring.ts のテスト — Phase 2-7
 */

import { describe, expect, it } from 'vitest';
import {
  BOOST,
  computeLawRelevance,
  extractArticleNumFromQuery,
  rankToBaseScore,
  sortByScoreDesc,
} from './relevance-scoring.js';

describe('rankToBaseScore', () => {
  it('rank 0 / 非有限は 0', () => {
    expect(rankToBaseScore(0)).toBe(0);
    expect(rankToBaseScore(Number.NaN)).toBe(0);
    expect(rankToBaseScore(Number.POSITIVE_INFINITY)).toBe(0);
  });
  it('|rank| が大きいほど 1 に近づく', () => {
    expect(rankToBaseScore(-10)).toBeCloseTo(0.5);
    expect(rankToBaseScore(-30)).toBeGreaterThan(rankToBaseScore(-10));
    expect(rankToBaseScore(-1000)).toBeLessThan(1);
  });
});

describe('extractArticleNumFromQuery', () => {
  it('「第30条」→ 30、「第30条の2」→ 30_2', () => {
    expect(extractArticleNumFromQuery('適格請求書 第30条')).toBe('30');
    expect(extractArticleNumFromQuery('第30条の2')).toBe('30_2');
    expect(extractArticleNumFromQuery('第30の2条')).toBe('30_2');
  });
  it('全角数字も受け付ける', () => {
    expect(extractArticleNumFromQuery('第３０条')).toBe('30');
  });
  it('漢数字は未対応で null', () => {
    expect(extractArticleNumFromQuery('第三十条')).toBeNull();
  });
  it('条番号がなければ null', () => {
    expect(extractArticleNumFromQuery('適格請求書')).toBeNull();
    expect(extractArticleNumFromQuery('')).toBeNull();
  });
});

describe('computeLawRelevance', () => {
  const base = { rank: -10, query: '消費税法', lawTitle: '消費税法' };

  it('base のみ (boost なし)', () => {
    const r = computeLawRelevance({ rank: -10, query: '課税仕入れ', lawTitle: '消費税法' });
    expect(r.score).toBeCloseTo(0.5);
    expect(r.score_reasons).toHaveLength(1);
  });

  it('title_exact_match +0.3 (幅・空白・大小文字の違いは吸収)', () => {
    const r = computeLawRelevance(base);
    expect(r.score).toBeCloseTo(0.5 + BOOST.titleExact);
    expect(r.score_reasons).toContain('title_exact_match');
    const r2 = computeLawRelevance({ rank: -10, query: 'ｐｌ法', lawTitle: 'PL法' });
    expect(r2.score_reasons).toContain('title_exact_match');
  });

  it('abbrev_match +0.2 (null / 空は無視)', () => {
    const r = computeLawRelevance({
      rank: -10,
      query: '消法',
      lawTitle: '消費税法',
      abbrevs: [null, '', '消法'],
    });
    expect(r.score).toBeCloseTo(0.5 + BOOST.abbrev);
    expect(r.score_reasons).toContain('abbrev_match');
  });

  it('article_num_match +0.3 (一致しない条番号には付かない)', () => {
    const hit = computeLawRelevance({
      rank: -10,
      query: '適格請求書 第30条',
      lawTitle: '消費税法',
      articleNum: '30',
    });
    expect(hit.score_reasons).toContain('article_num_match');
    const miss = computeLawRelevance({
      rank: -10,
      query: '適格請求書 第30条',
      lawTitle: '消費税法',
      articleNum: '30_2',
    });
    expect(miss.score_reasons).not.toContain('article_num_match');
  });

  it('article_caption_match +0.1 (条番号だけのクエリは対象外)', () => {
    const hit = computeLawRelevance({
      rank: -10,
      query: '仕入れ',
      lawTitle: '消費税法',
      caption: '（仕入れに係る消費税額の控除）',
    });
    expect(hit.score_reasons).toContain('article_caption_match');
    const onlyNum = computeLawRelevance({
      rank: -10,
      query: '第30条',
      lawTitle: '消費税法',
      caption: '（第30条）',
    });
    expect(onlyNum.score_reasons).not.toContain('article_caption_match');
  });

  it('supplementary_provision で -0.15 (下限 0)', () => {
    const r = computeLawRelevance({
      rank: -10,
      query: '課税仕入れ',
      lawTitle: '消費税法',
      isSupplementary: true,
    });
    expect(r.score).toBeCloseTo(0.5 - 0.15);
    expect(r.score_reasons).toContain('supplementary_provision');
    const floor = computeLawRelevance({
      rank: -0.5,
      query: 'x',
      lawTitle: 'y',
      isSupplementary: true,
    });
    expect(floor.score).toBe(0);
  });

  it('上限は 1.0', () => {
    const r = computeLawRelevance({
      rank: -100,
      query: '消費税法 第30条',
      lawTitle: '消費税法',
      abbrevs: ['消費税法 第30条'],
      articleNum: '30',
      caption: '消費税法 第30条',
    });
    expect(r.score).toBeLessThanOrEqual(1.0);
  });
});

describe('sortByScoreDesc', () => {
  it('score 降順、同点は rank 昇順 (FTS5 順) で安定', () => {
    const sorted = sortByScoreDesc([
      { id: 'a', score: 0.5, rank: -5 },
      { id: 'b', score: 0.9, rank: -1 },
      { id: 'c', score: 0.5, rank: -9 },
      { id: 'd', rank: -20 },
    ]);
    expect(sorted.map((h) => h.id)).toEqual(['b', 'c', 'a', 'd']);
  });
});
