/**
 * MCP サーバー本体（factory）。
 *
 * 低レベル `Server` を維持し、tools/call の family error contract
 * (UNKNOWN_TOOL / INTERNAL_ERROR の JSON 化 + isError) はこのファイルに置く。
 * `src/index.ts`（bin エントリ）が `serveStdio(createServer)` で起動するほか、
 * テストからは `InMemoryTransport` で in-process 起動する。
 */

import { fromJsonSchema, Server, type StandardSchemaV1 } from '@modelcontextprotocol/server';
import { PACKAGE_INFO } from './config.js';
import { isLawServiceError, makeError, NEXT_ACTIONS } from './errors.js';
import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';
import { logger } from './utils/logger.js';

/**
 * MCP サーバーを組み立てる factory。
 * `serveStdio` に渡すほか、テストから `InMemoryTransport` で in-process 起動するために export する。
 */
/**
 * definitions.ts の JSON Schema から引数バリデータを作る (SDK v2 の fromJsonSchema)。
 * 低レベル Server は registerTool と違って引数検証をしないため、tools/call で自前に呼ぶ。
 * 失敗時は family error contract の INVALID_ARGUMENT で返す (SDK 生成の文言は使わない)。
 */
const argValidators = new Map<string, StandardSchemaV1<unknown>>(
  tools.map((t) => [t.name, fromJsonSchema(t.inputSchema as Parameters<typeof fromJsonSchema>[0])])
);

/** 引数を検証し、問題があれば INVALID_ARGUMENT の LawServiceError を返す (問題なければ null) */
async function validateArgs(name: string, args: unknown) {
  const validator = argValidators.get(name);
  if (!validator) return null;
  const result = await validator['~standard'].validate(args ?? {});
  if (!('issues' in result) || !result.issues || result.issues.length === 0) return null;
  // fromJsonSchema の既定バリデータは path を持たず、message が `data/name must be string` 形式で来る。
  // 先頭の `data/` を剥がして path に、残りを message にする
  const detail = result.issues.map((i) => {
    const fromPath = (i.path ?? [])
      .map((seg) => (typeof seg === 'object' ? String(seg.key) : String(seg)))
      .join('.');
    const m = /^data(?:\/([^\s]+))?\s+(.*)$/.exec(i.message);
    const path = fromPath || (m?.[1] ?? '').replace(/\//g, '.');
    const message = m ? m[2] : i.message;
    return { path, message };
  });
  return makeError(
    'INVALID_ARGUMENT',
    `引数が tools/list の inputSchema に合いません: ${detail.map((d) => (d.path ? `${d.path}: ${d.message}` : d.message)).join('; ')}`,
    {
      hint: `tools/list の ${name} の inputSchema を確認してください (型・必須・enum)`,
      next_actions: [
        { action: 'list_tools', reason: 'inputSchema で引数の型と必須項目を確認できます' },
      ],
      detail: { issues: detail },
    }
  );
}

export function createServer(): Server {
  const server = new Server(
    {
      name: PACKAGE_INFO.name,
      version: PACKAGE_INFO.version,
    },
    {
      // SDK v2 の低レベル Server は capabilities を推論しない。
      // 省略すると setRequestHandler('tools/list') が throw する。
      capabilities: {
        tools: {},
      },
    }
  );

  // List tools
  server.setRequestHandler('tools/list', async () => {
    return { tools };
  });

  // Execute tool
  server.setRequestHandler('tools/call', async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const handler = toolHandlers[name];
      if (!handler) {
        const err = makeError('UNKNOWN_TOOL', `Unknown tool: ${name}`, {
          hint: `利用可能なツール: ${Object.keys(toolHandlers).join(', ')}`,
          next_actions: [
            {
              action: 'list_tools',
              reason: 'MCP の tools/list で利用可能ツールを確認できます',
            },
          ],
        });
        return {
          content: [{ type: 'text', text: JSON.stringify(err, null, 2) }],
          isError: true,
        };
      }

      const invalid = await validateArgs(name, args);
      if (invalid) {
        return {
          content: [{ type: 'text', text: JSON.stringify(invalid, null, 2) }],
          isError: true,
        };
      }

      const result = await handler(args);

      // handler が LawServiceError を返した場合は isError: true を立てる
      // これにより MCP クライアント / LLM 側でエラーかどうかを判別しやすくする
      const isError = isLawServiceError(result);

      return {
        content: [
          {
            type: 'text',
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          },
        ],
        ...(isError ? { isError: true } : {}),
      };
    } catch (error) {
      // 想定外の例外（バグ等）。INTERNAL_ERROR として LLM 可読形に変換。
      const cause = error instanceof Error ? error.message : String(error);
      const err = makeError('INTERNAL_ERROR', `内部エラーが発生しました: ${cause}`, {
        hint: 'バグの可能性があります。再現手順を添えて GitHub issue でご報告ください',
        retryable: true,
        next_actions: [NEXT_ACTIONS.retryLater()],
        detail: { cause },
      });
      logger.error(
        'server',
        `tool ${name} threw`,
        error instanceof Error ? error : new Error(String(error))
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(err, null, 2) }],
        isError: true,
      };
    }
  });

  return server;
}
