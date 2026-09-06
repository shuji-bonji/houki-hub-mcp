import { describe, expect, it } from 'vitest';
import { LRUCache } from './cache.js';

describe('LRUCache', () => {
  it('stores and retrieves values', () => {
    const c = new LRUCache<string, number>(3);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBe(2);
    expect(c.size).toBe(2);
  });

  it('evicts least recently used when full', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.set('c', 3); // a should be evicted
    expect(c.has('a')).toBe(false);
    expect(c.has('b')).toBe(true);
    expect(c.has('c')).toBe(true);
  });

  it('updates LRU order on get', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // a is now most recently used
    c.set('c', 3); // b should be evicted
    expect(c.has('a')).toBe(true);
    expect(c.has('b')).toBe(false);
    expect(c.has('c')).toBe(true);
  });

  it('updates value on re-set', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('a', 100);
    expect(c.get('a')).toBe(100);
    expect(c.size).toBe(1);
  });

  it('throws on invalid maxSize', () => {
    expect(() => new LRUCache(0)).toThrow();
    expect(() => new LRUCache(-1)).toThrow();
  });

  it('clears all entries', () => {
    const c = new LRUCache<string, number>(3);
    c.set('a', 1);
    c.set('b', 2);
    c.clear();
    expect(c.size).toBe(0);
    expect(c.has('a')).toBe(false);
  });
});
