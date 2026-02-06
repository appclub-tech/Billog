/**
 * Test Setup
 * Configures environment for E2E agent tests
 * Loads environment variables from .env file
 */

import { beforeAll, afterAll } from 'vitest';
import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// Get the directory of this file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env file from billog-agent root (parent of tests/)
config({ path: resolve(__dirname, '..', '.env') });

// Set test environment
process.env.NODE_ENV = 'test';

// Log loaded env vars (without secrets)
console.log('Test environment loaded:');
console.log(`  BILLOG_API_URL: ${process.env.BILLOG_API_URL || '(not set)'}`);
console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? '***' + process.env.OPENAI_API_KEY.slice(-4) : '(not set)'}`);
console.log(`  GOOGLE_API_KEY: ${process.env.GOOGLE_API_KEY ? '***' + process.env.GOOGLE_API_KEY.slice(-4) : '(not set)'}`);

// Suppress verbose console logs during tests unless DEBUG is set
if (!process.env.DEBUG) {
  const originalLog = console.log;
  const originalError = console.error;

  // Keep important logs, suppress tool/API noise
  console.log = (...args: unknown[]) => {
    const msg = String(args[0] || '');
    // Keep test framework logs and important messages
    if (msg.includes('Test environment') ||
        msg.includes('Setting up') ||
        msg.includes('Cleaning up') ||
        msg.includes('✓') ||
        msg.includes('✗')) {
      originalLog(...args);
    }
  };

  // Keep errors visible
  console.error = (...args: unknown[]) => {
    originalError(...args);
  };
}

beforeAll(async () => {
  console.log('Setting up E2E tests...');
});

afterAll(async () => {
  console.log('Cleaning up E2E tests...');
});
