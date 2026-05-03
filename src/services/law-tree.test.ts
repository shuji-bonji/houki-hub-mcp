import { describe, it, expect } from 'vitest';
import {
  extractText,
  findArticle,
  findParagraph,
  findItem,
  findChildByTag,
  findChildrenByTag,
  getArticleCaption,
  getArticleTitle,
  extractToc,
  getLawTitle,
  limitTocDepth,
  countTocNodes,
} from './law-tree.js';
import type { LawNode } from './egov-client.js';

// 消費税法 第30条第1項 を簡略化したフィクスチャ
const fixture: LawNode = {
  tag: 'Law',
  attr: { Era: 'Showa', Year: '63', Num: '108' },
  children: [
    {
      tag: 'LawNum',
      children: ['昭和六十三年法律第百八号'],
    },
    {
      tag: 'LawBody',
      children: [
        { tag: 'LawTitle', children: ['消費税法'] },
        {
          tag: 'MainProvision',
          children: [
            {
              tag: 'Chapter',
              attr: { Num: '3' },
              children: [
                { tag: 'ChapterTitle', children: ['第三章　税額控除等'] },
                {
                  tag: 'Article',
                  attr: { Num: '30' },
                  children: [
                    { tag: 'ArticleCaption', children: ['（仕入れに係る消費税額の控除）'] },
                    { tag: 'ArticleTitle', children: ['第三十条'] },
                    {
                      tag: 'Paragraph',
                      attr: { Num: '1' },
                      children: [
                        { tag: 'ParagraphNum', children: [] },
                        {
                          tag: 'ParagraphSentence',
                          children: [
                            { tag: 'Sentence', children: ['事業者…課税仕入れに係る消費税額…'] },
                          ],
                        },
                        {
                          tag: 'Item',
                          attr: { Num: '1' },
                          children: [
                            { tag: 'ItemTitle', children: ['一'] },
                            {
                              tag: 'ItemSentence',
                              children: [
                                {
                                  tag: 'Sentence',
                                  children: ['国内において課税仕入れを行つた場合'],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
                {
                  tag: 'Article',
                  attr: { Num: '30_2' },
                  children: [
                    { tag: 'ArticleCaption', children: ['（の2の見出し）'] },
                    { tag: 'ArticleTitle', children: ['第三十条の二'] },
                    {
                      tag: 'Paragraph',
                      attr: { Num: '1' },
                      children: [
                        {
                          tag: 'ParagraphSentence',
                          children: ['本文'],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('extractText', () => {
  it('extracts string children', () => {
    expect(extractText({ tag: 'X', children: ['hello'] })).toBe('hello');
  });

  it('concatenates nested string children', () => {
    expect(
      extractText({
        tag: 'X',
        children: [
          { tag: 'A', children: ['foo '] },
          { tag: 'B', children: ['bar'] },
        ],
      })
    ).toBe('foo bar');
  });

  it('handles null/undefined', () => {
    expect(extractText(null)).toBe('');
    expect(extractText(undefined)).toBe('');
  });
});

describe('findArticle', () => {
  it('finds article by Num', () => {
    const a = findArticle(fixture, '30');
    expect(a).not.toBeNull();
    expect(a?.attr?.Num).toBe('30');
  });

  it('finds article with の2 (underscore)', () => {
    const a = findArticle(fixture, '30_2');
    expect(a).not.toBeNull();
    expect(a?.attr?.Num).toBe('30_2');
  });

  it('returns null for missing article', () => {
    expect(findArticle(fixture, '999')).toBeNull();
  });
});

describe('findParagraph / findItem', () => {
  it('finds paragraph by num', () => {
    const a = findArticle(fixture, '30')!;
    const p = findParagraph(a, 1);
    expect(p?.attr?.Num).toBe('1');
  });

  it('finds item within paragraph', () => {
    const a = findArticle(fixture, '30')!;
    const p = findParagraph(a, 1)!;
    const i = findItem(p, 1);
    expect(i?.attr?.Num).toBe('1');
  });
});

describe('getArticleCaption / getArticleTitle', () => {
  it('extracts caption', () => {
    const a = findArticle(fixture, '30')!;
    expect(getArticleCaption(a)).toBe('（仕入れに係る消費税額の控除）');
  });

  it('extracts title', () => {
    const a = findArticle(fixture, '30')!;
    expect(getArticleTitle(a)).toBe('第三十条');
  });
});

describe('extractToc', () => {
  it('extracts hierarchical TOC', () => {
    const toc = extractToc(fixture);
    expect(toc.length).toBeGreaterThan(0);
    const chapter = toc[0];
    expect(chapter.tag).toBe('Chapter');
    expect(chapter.title).toContain('税額控除等');
    expect(chapter.children.length).toBeGreaterThan(0);
    const firstArticle = chapter.children.find((c) => c.tag === 'Article');
    expect(firstArticle?.num).toBe('30');
  });
});

describe('getLawTitle', () => {
  it('extracts law title from LawBody', () => {
    expect(getLawTitle(fixture)).toBe('消費税法');
  });
});

describe('findChildByTag / findChildrenByTag', () => {
  it('finds first matching child', () => {
    const node: LawNode = {
      tag: 'X',
      children: [
        { tag: 'A', children: ['1'] },
        { tag: 'A', children: ['2'] },
      ],
    };
    expect(extractText(findChildByTag(node, 'A'))).toBe('1');
  });

  it('finds all matching children', () => {
    const node: LawNode = {
      tag: 'X',
      children: [
        { tag: 'A', children: ['1'] },
        { tag: 'B', children: ['skip'] },
        { tag: 'A', children: ['2'] },
      ],
    };
    expect(findChildrenByTag(node, 'A').length).toBe(2);
  });
});

// 大規模法令を想定した深い階層フィクスチャ（Part > Chapter > Section > Article）
const deepFixture: LawNode = {
  tag: 'Law',
  children: [
    {
      tag: 'LawBody',
      children: [
        { tag: 'LawTitle', children: ['深い法令'] },
        {
          tag: 'MainProvision',
          children: [
            {
              tag: 'Part',
              attr: { Num: '1' },
              children: [
                { tag: 'PartTitle', children: ['第一編 総則'] },
                {
                  tag: 'Chapter',
                  attr: { Num: '1' },
                  children: [
                    { tag: 'ChapterTitle', children: ['第一章 通則'] },
                    {
                      tag: 'Section',
                      attr: { Num: '1' },
                      children: [
                        { tag: 'SectionTitle', children: ['第一節 X'] },
                        {
                          tag: 'Article',
                          attr: { Num: '1' },
                          children: [{ tag: 'ArticleTitle', children: ['第一条'] }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('limitTocDepth', () => {
  it('depth=1 keeps only the top structural level (Part)', () => {
    const toc = extractToc(deepFixture);
    const limited = limitTocDepth(toc, 1);
    expect(limited.length).toBe(1);
    expect(limited[0].tag).toBe('Part');
    expect(limited[0].children).toEqual([]);
  });

  it('depth=2 keeps Part and Chapter', () => {
    const toc = extractToc(deepFixture);
    const limited = limitTocDepth(toc, 2);
    const part = limited[0];
    expect(part.tag).toBe('Part');
    expect(part.children).toHaveLength(1);
    expect(part.children[0].tag).toBe('Chapter');
    expect(part.children[0].children).toEqual([]);
  });

  it('depth=3 keeps down to Section (Article still trimmed off Section)', () => {
    const toc = extractToc(deepFixture);
    const limited = limitTocDepth(toc, 3);
    const section = limited[0].children[0].children[0];
    expect(section.tag).toBe('Section');
    expect(section.children).toEqual([]);
  });

  it('depth >= structural depth keeps everything (Article preserved)', () => {
    const toc = extractToc(deepFixture);
    const limited = limitTocDepth(toc, 4);
    const section = limited[0].children[0].children[0];
    expect(section.children[0].tag).toBe('Article');
  });

  it('invalid depth (<= 0) returns the input unchanged', () => {
    const toc = extractToc(deepFixture);
    expect(limitTocDepth(toc, 0)).toBe(toc);
    expect(limitTocDepth(toc, -1)).toBe(toc);
  });

  it('does not mutate the original TOC', () => {
    const toc = extractToc(deepFixture);
    const before = JSON.stringify(toc);
    limitTocDepth(toc, 1);
    expect(JSON.stringify(toc)).toBe(before);
  });
});

describe('countTocNodes', () => {
  it('counts every node including children', () => {
    const toc = extractToc(deepFixture);
    // Part(1) + Chapter(1) + Section(1) + Article(1) = 4
    expect(countTocNodes(toc)).toBe(4);
  });

  it('returns 0 for an empty TOC', () => {
    expect(countTocNodes([])).toBe(0);
  });
});
