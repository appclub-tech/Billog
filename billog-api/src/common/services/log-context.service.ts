import { Injectable, Scope, Inject, Logger } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { Request } from 'express';

/**
 * Request-scoped service for contextual logging
 * Provides consistent log formatting with request correlation
 */
@Injectable({ scope: Scope.REQUEST })
export class LogContextService {
  private readonly requestId: string;

  constructor(@Inject(REQUEST) private request: Request) {
    this.requestId = (request as any).requestId || 'no-req-id';
  }

  /**
   * Create a logger with request context
   */
  createLogger(context: string): ContextLogger {
    return new ContextLogger(context, this.requestId);
  }

  getRequestId(): string {
    return this.requestId;
  }
}

/**
 * Logger with request context prefix
 */
export class ContextLogger {
  private readonly logger: Logger;
  private readonly requestId: string;
  private step = 0;

  constructor(context: string, requestId: string) {
    this.logger = new Logger(context);
    this.requestId = requestId;
  }

  /**
   * Log a step in the flow
   */
  logStep(message: string, data?: Record<string, any>) {
    this.step++;
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    this.logger.log(`[${this.requestId}] Step ${this.step}: ${message}${dataStr}`);
  }

  /**
   * Log info
   */
  log(message: string, data?: Record<string, any>) {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    this.logger.log(`[${this.requestId}] ${message}${dataStr}`);
  }

  /**
   * Log debug
   */
  debug(message: string, data?: Record<string, any>) {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    this.logger.debug(`[${this.requestId}] ${message}${dataStr}`);
  }

  /**
   * Log warning
   */
  warn(message: string, data?: Record<string, any>) {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    this.logger.warn(`[${this.requestId}] ⚠️ ${message}${dataStr}`);
  }

  /**
   * Log error
   */
  error(message: string, error?: Error | any) {
    const errorStr = error ? ` | ${error.message || error}` : '';
    this.logger.error(`[${this.requestId}] ❌ ${message}${errorStr}`);
    if (error?.stack) {
      this.logger.error(`[${this.requestId}] Stack: ${error.stack}`);
    }
  }

  /**
   * Log success
   */
  success(message: string, data?: Record<string, any>) {
    const dataStr = data ? ` | ${JSON.stringify(data)}` : '';
    this.logger.log(`[${this.requestId}] ✅ ${message}${dataStr}`);
  }
}
