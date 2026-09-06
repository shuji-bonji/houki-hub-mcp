/**
 * MCP サーバー本体（factory）。
 *
 * 低レベル `Server` を維持し、tools/call の family error contract
 * (UNKNOWN_TOOL / INTERNAL_ERROR の JSON 化 + isError) はこのファイルに置く。
 * `src/index.ts`（bin エントリ）が `serveStdio(createServer)` で起動するほか、
 * テストからは `InMemoryTransport` で in-process 起動する。
 */

import { Server } from '@modelcontextprotocol/server';
import { PACKAGE_INFO } from './config.js';
import { isLawServiceError, makeError, NEXT_ACTIONS } from './errors.js';
import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';
import { logger } from './utils/logger.js';

/**
 * MCP サーバーを組み立てる factory。
 * `serveStdio` に渡すほか、テストから `InMemoryTransport` で in-process 起動するために export する。
 */
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
