/**
 * createServer() の統合テスト。
 *
 * MCP SDK v2 の InMemoryTransport で Client と in-process 接続し、
 * tools/list と tools/call の応答（family error contract を含む）を検証する。
 * e-Gov API には触れない（UNKNOWN_TOOL / explain_law_type / resolve_abbreviation のみ）。
 */

import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PACKAGE_INFO } from './config.js';
import { makeError } from './errors.js';
import { createServer } from './server.js';
import { tools } from './tools/definitions.js';

// 実 handler に、error contract の 2 経路を検証するためのテスト用 handler を足す
// （e-Gov API に触れずに INTERNAL_ERROR / LawServiceError の経路を通す）
vi.mock('./tools/handlers.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./tools/handlers.js')>();
  return {
    ...mod,
    toolHandlers: {
      ...mod.toolHandlers,
      __test_throw: async () => {
        throw new Error('boom');
      },
      __test_law_error: async () =>
        makeError('LAW_NOT_FOUND', '該当する法令がありません', { hint: 'テスト用' }),
    },
  };
});

interface TextContent {
  type: 'text';
  text: string;
}

function firstText(result: { content?: unknown }): string {
  const content = result.content as TextContent[];
  expect(content[0]?.type).toBe('text');
  return content[0].text;
}

describe('createServer (SDK v2, InMemoryTransport)', () => {
  let client: Client;

  beforeEach(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createServer();
    client = new Client({ name: 'houki-egov-test', version: '0.0.0' });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
  });

  it('initialize で PACKAGE_INFO の name / version を返す', () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe(PACKAGE_INFO.name);
    expect(info?.version).toBe(PACKAGE_INFO.version);
  });

  it('tools/list が definitions.ts の全ツールを返す', async () => {
    const res = await client.listTools();
    const names = res.tools.map((t) => t.name).sort();
    expect(names).toEqual(tools.map((t) => t.name).sort());
    expect(names).toContain('search_law');
    expect(names).toContain('search_fulltext');
  });

  it('tools/list の inputSchema が JSON Schema のまま渡る', async () => {
    const res = await client.listTools();
    const searchLaw = res.tools.find((t) => t.name === 'search_law');
    expect(searchLaw?.inputSchema.type).toBe('object');
    expect(searchLaw?.inputSchema.required).toEqual(['keyword']);
  });

  it('存在しないツール名は UNKNOWN_TOOL + isError: true (family error contract)', async () => {
    const res = await client.callTool({ name: 'no_such_tool', arguments: {} });
    expect(res.isError).toBe(true);
    const body = JSON.parse(firstText(res));
    expect(body.code).toBe('UNKNOWN_TOOL');
    expect(body.hint).toContain('search_law');
    expect(body.next_actions[0].action).toBe('list_tools');
  });

  it('explain_law_type が isError なしで JSON を返す', async () => {
    const res = await client.callTool({ name: 'explain_law_type', arguments: { name: '政令' } });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(firstText(res));
    expect(body.name).toBe('政令');
  });

  it('LawServiceError を返す handler は isError: true になる', async () => {
    const res = await client.callTool({ name: '__test_law_error', arguments: {} });
    expect(res.isError).toBe(true);
    const body = JSON.parse(firstText(res));
    expect(body.code).toBe('LAW_NOT_FOUND');
    expect(body.hint).toBe('テスト用');
  });

  it('handler が throw すると INTERNAL_ERROR + retryable: true (protocol error にしない)', async () => {
    const res = await client.callTool({ name: '__test_throw', arguments: {} });
    expect(res.isError).toBe(true);
    const body = JSON.parse(firstText(res));
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.retryable).toBe(true);
    expect(body.detail.cause).toBe('boom');
  });

  it('見つからない法令種別は found: false を isError なしで返す（後方互換）', async () => {
    const res = await client.callTool({
      name: 'explain_law_type',
      arguments: { name: '存在しない法令種別' },
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(firstText(res));
    expect(body.found).toBe(false);
  });

  it('resolve_abbreviation が略称を解決する', async () => {
    const res = await client.callTool({
      name: 'resolve_abbreviation',
      arguments: { abbr: '労基法' },
    });
    expect(res.isError).toBeFalsy();
    const body = JSON.parse(firstText(res));
    expect(body.abbr).toBe('労基法');
    expect(body.resolved).not.toBeNull();
  });
});
