#!/usr/bin/env node

/**
 * JP-Houki MCP Server
 * Japanese laws and regulations MCP — thin e-Gov core with pluggable extensions
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { tools } from './tools/definitions.js';
import { toolHandlers } from './tools/handlers.js';
import { PACKAGE_INFO } from './config.js';
import { logger } from './utils/logger.js';
import { makeError, isLawServiceError, NEXT_ACTIONS } from './errors.js';

// Server instance
const server = new Server(
  {
    name: PACKAGE_INFO.name,
    version: PACKAGE_INFO.version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools };
});

// Execute tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('server', `${PACKAGE_INFO.name} v${PACKAGE_INFO.version} started`);
}

main().catch((error) => {
  logger.error('server', 'fatal error', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
