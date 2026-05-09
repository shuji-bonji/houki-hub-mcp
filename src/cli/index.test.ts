/**
 * Phase 2-6: CLI 引数解析のテスト
 *
 * 実 bulk DL を走らせる統合テストはここでは行わず、引数解析と早期 exit
 * (--help / --version / 不正フラグ) のみ verify する。
 * 実 DL 系は `--bulk-download-by-date` で smoke 確認を別途実施する想定。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCli, shouldFallbackToMcp } from './index.js';

describe('runCli — 引数解析', () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('引数なしは MCP fallback', async () => {
    const result = await runCli(['node', 'index.js']);
    expect(shouldFallbackToMcp(result)).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it('--help は exitCode=0 で help 出力', async () => {
    const result = await runCli(['node', 'index.js', '--help']);
    expect(result.command).toBe('help');
    expect(result.exitCode).toBe(0);
    expect(logSpy).toHaveBeenCalled();
    expect(shouldFallbackToMcp(result)).toBe(false);
  });

  it('-h も --help と同じ', async () => {
    const result = await runCli(['node', 'index.js', '-h']);
    expect(result.command).toBe('help');
    expect(result.exitCode).toBe(0);
  });

  it('--version はバージョン出力', async () => {
    const result = await runCli(['node', 'index.js', '--version']);
    expect(result.command).toBe('version');
    expect(result.exitCode).toBe(0);
    const out = logSpy.mock.calls.flat().join(' ');
    expect(out).toContain('houki-egov-mcp');
  });

  it('--bulk-download-by-date は YYYYMMDD 必須', async () => {
    const result = await runCli(['node', 'index.js', '--bulk-download-by-date']);
    expect(result.exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalled();
  });

  it('--bulk-download-by-date に不正な日付形式は拒否', async () => {
    const result = await runCli(['node', 'index.js', '--bulk-download-by-date', '2026-05-07']);
    expect(result.exitCode).toBe(2);
  });

  it('未知のフラグは exitCode=2 でヘルプ表示', async () => {
    const result = await runCli(['node', 'index.js', '--unknown-flag']);
    expect(result.command).toBe('unknown');
    expect(result.exitCode).toBe(2);
    expect(errSpy).toHaveBeenCalled();
    // help も出てる
    expect(logSpy).toHaveBeenCalled();
  });

  it('shouldFallbackToMcp は CLI コマンド実行時 false', async () => {
    const result = await runCli(['node', 'index.js', '--help']);
    expect(shouldFallbackToMcp(result)).toBe(false);
  });

  it('shouldFallbackToMcp は引数なし時 true', async () => {
    const result = await runCli(['node', 'index.js']);
    expect(shouldFallbackToMcp(result)).toBe(true);
  });
});
