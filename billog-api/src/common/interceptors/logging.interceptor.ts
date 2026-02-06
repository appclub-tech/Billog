import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { randomUUID } from 'crypto';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();

    const requestId = randomUUID().slice(0, 8);
    const method = request.method;
    const url = request.url;
    const body = request.body;
    const userAgent = request.get('user-agent') || '';
    const startTime = Date.now();

    // Attach requestId to request for downstream logging
    request.requestId = requestId;

    // Get auth info for logging
    const authHeader = request.get('authorization') || '';
    const authType = authHeader.split(' ')[0] || 'none';
    const authToken = authHeader.split(' ')[1];
    const maskedToken = authToken ? `${authToken.substring(0, 20)}...` : 'none';

    // Log incoming request
    this.logger.log(
      `[${requestId}] ➡️  ${method} ${url}` +
      `\n[${requestId}]    Auth: ${authType} ${maskedToken}` +
      (body && Object.keys(body).length > 0 ? `\n[${requestId}]    Body: ${this.sanitizeBody(body)}` : '')
    );

    return next.handle().pipe(
      tap({
        next: (data) => {
          const duration = Date.now() - startTime;
          const statusCode = response.statusCode;

          this.logger.log(
            `[${requestId}] ⬅️  ${method} ${url} ${statusCode} ${duration}ms` +
            (data ? `\n[${requestId}]    Response: ${this.sanitizeResponse(data)}` : '')
          );
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          const statusCode = error.status || 500;

          this.logger.error(
            `[${requestId}] ❌ ${method} ${url} ${statusCode} ${duration}ms\n` +
            `[${requestId}]    Error: ${error.message}`
          );
        },
      }),
    );
  }

  private sanitizeBody(body: any): string {
    const sanitized = { ...body };
    // Remove sensitive fields
    if (sanitized.password) sanitized.password = '***';
    if (sanitized.token) sanitized.token = '***';
    if (sanitized.secret) sanitized.secret = '***';

    const str = JSON.stringify(sanitized);
    return str.length > 500 ? str.slice(0, 500) + '...' : str;
  }

  private sanitizeResponse(data: any): string {
    const str = JSON.stringify(data);
    return str.length > 300 ? str.slice(0, 300) + '...' : str;
  }
}
