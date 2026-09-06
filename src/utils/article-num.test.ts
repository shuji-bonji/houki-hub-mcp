import { describe, expect, it } from 'vitest';
import { fromEgovArticleNum, toEgovArticleNum } from './article-num.js';

describe('toEgovArticleNum', () => {
  it('handles bare arabic numbers', () => {
    expect(toEgovArticleNum('30')).toBe('30');
  });

  it('handles の suffix', () => {
    expect(toEgovArticleNum('30の2')).toBe('30_2');
    expect(toEgovArticleNum('57の4')).toBe('57_4');
  });

  it('strips 第 / 条', () => {
    expect(toEgovArticleNum('第30条')).toBe('30');
    expect(toEgovArticleNum('第30条の2')).toBe('30_2');
  });

  it('throws on kanji input (v0.1.0 limitation)', () => {
    expect(() => toEgovArticleNum('三十')).toThrow();
    expect(() => toEgovArticleNum('第三十条')).toThrow();
  });

  it('handles whitespace', () => {
    expect(toEgovArticleNum('  30  ')).toBe('30');
  });
});

describe('fromEgovArticleNum', () => {
  it('replaces underscore with の', () => {
    expect(fromEgovArticleNum('30')).toBe('30');
    expect(fromEgovArticleNum('30_2')).toBe('30の2');
    expect(fromEgovArticleNum('57_4')).toBe('57の4');
  });
});
