import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
  createParamDecorator,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { Channel, SourceType } from '@prisma/client';

const { TokenExpiredError, JsonWebTokenError } = jwt;

/**
 * Extended JWT payload with optional channel context
 */
export interface JwtPayload extends jwt.JwtPayload {
  channel?: Channel;
  senderChannelId?: string;
  sourceChannelId?: string;
  sourceType?: SourceType;
}

/**
 * Extended request with JWT payload
 */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/**
 * JWT auth guard for API calls
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Missing authorization header');
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid authorization format');
    }

    try {
      // Get JWT secret from config service or environment (fallback for tests)
      const secret = this.configService?.get<string>('jwt.secret')
        || process.env.BILLOG_JWT_SECRET
        || 'dev-secret-change-me';

      if (!secret || secret === 'dev-secret-change-me') {
        this.logger.warn('Using default JWT secret - ensure BILLOG_JWT_SECRET is set in production');
      }

      const payload = jwt.verify(token, secret) as JwtPayload;

      // Attach payload to request
      request.user = payload;

      this.logger.debug(`Authenticated request: ${payload.sub}`);

      return true;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new UnauthorizedException('Token expired');
      }
      if (error instanceof JsonWebTokenError) {
        throw new UnauthorizedException('Invalid token');
      }
      throw error;
    }
  }
}

/**
 * Decorator to get JWT payload from request
 */
export const GetUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
