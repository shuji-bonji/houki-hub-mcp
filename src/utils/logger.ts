/**
 * Logger Utility
 * Centralized logging abstraction.
 *
 * RULE: MCP servers communicate over stdio — console.log breaks the protocol.
 * Always use console.error (stderr) or this logger.
 */

import { RUNTIME_FLAGS } from '../config.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface Logger {
  debug(context: string, message: string): void;
  info(context: string, message: string): void;
  warn(context: string, message: string): void;
  error(context: string, message: string, error?: Error): void;
}

function formatMessage(_level: LogLevel, context: string, message: string): string {
  return `[${context}] ${message}`;
}

export const logger: Logger = {
  debug(context, message) {
    if (RUNTIME_FLAGS.debug) {
      console.error(formatMessage('debug', context, message));
    }
  },
  info(context, message) {
    console.error(formatMessage('info', context, message));
  },
  warn(context, message) {
    console.error(formatMessage('warn', context, message));
  },
  error(context, message, error) {
    console.error(formatMessage('error', context, message));
    if (error && RUNTIME_FLAGS.debug) {
      console.error(error.stack);
    }
  },
};
