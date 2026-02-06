import jwt from 'jsonwebtoken';
import type { Channel, SourceType } from '@prisma/client';

/**
 * JWT payload for tests
 */
export interface TestJwtPayload {
  sub?: string;
  channel?: Channel;
  senderChannelId?: string;
  sourceChannelId?: string;
  sourceType?: SourceType;
}

/**
 * Default test context
 */
export const TEST_CONTEXT = {
  channel: 'LINE' as Channel,
  senderChannelId: 'test-sender-123',
  sourceChannelId: 'test-group-456',
  sourceType: 'GROUP' as SourceType,
};

/**
 * Test JWT secret (matches config default)
 */
export const TEST_JWT_SECRET = 'test-jwt-secret';

/**
 * Generate a test JWT token
 */
export function generateTestToken(payload: TestJwtPayload = {}): string {
  const defaultPayload: TestJwtPayload = {
    sub: 'test-agent',
    ...TEST_CONTEXT,
    ...payload,
  };

  return jwt.sign(defaultPayload, TEST_JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Get authorization header for tests
 */
export function getAuthHeader(payload?: TestJwtPayload): { Authorization: string } {
  return {
    Authorization: `Bearer ${generateTestToken(payload)}`,
  };
}
