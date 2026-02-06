/**
 * Vitest setup file - runs before all tests
 * Sets environment variables needed for test configuration
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env file first
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// IMPORTANT: This must match TEST_JWT_SECRET in test-jwt.ts
const TEST_JWT_SECRET = 'test-jwt-secret';

// Override specific test environment variables
process.env.BILLOG_JWT_SECRET = TEST_JWT_SECRET;
process.env.NODE_ENV = 'test';

// Suppress noisy logs during tests
process.env.LOG_LEVEL = 'error';
