#!/usr/bin/env node

/**
 * JP-Houki MCP Server — bin エントリ
 * Japanese laws and regulations MCP — thin e-Gov core with pluggable extensions
 *
 * Phase 2-6 で CLI モードを追加。`--bulk-download-everything` / `--status` 等の
 * フラグで起動した場合は CLI ハンドラを実行し exit する。引数なしの場合は
 * MCP server として stdio に常駐する。
 *
 * v0.4.0 で MCP SDK v2 (`@modelcontextprotocol/server`) に移行。
 * サーバー本体は `src/server.ts` の `createServer()`。
 */

import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { runCli, shouldFallbackToMcp } from './cli/index.js';
import { PACKAGE_INFO } from './config.js';
import { createServer } from './server.js';
import { logger } from './utils/logger.js';

// Start server (or run CLI command, depending on argv)
async function main() {
  // 1) CLI mode: bulk DL / status / help / version
  const cliResult = await runCli(process.argv);
  if (!shouldFallbackToMcp(cliResult)) {
    process.exit(cliResult.exitCode);
  }

  // 2) MCP server mode (default — argv なし)
  //    serveStdio が transport を所有し、protocol version の交渉も行う。
  //    factory は接続ごとに呼ばれる（stdio では 1 プロセス 1 接続）。
  const handle = serveStdio(createServer);
  const shutdown = () => {
    void handle.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  logger.info('server', `${PACKAGE_INFO.name} v${PACKAGE_INFO.version} started`);
}

main().catch((error) => {
  logger.error('server', 'fatal error', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
});
