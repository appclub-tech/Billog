/**
 * Test Fixtures
 * Provides test data like receipt images
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

/**
 * Path to test assets directory (in project root)
 */
const TEST_ASSETS_DIR = resolve(process.cwd(), '..', 'test-assets');

/**
 * Public test receipt URL (Flickr-hosted receipt image)
 */
export const TEST_RECEIPT_URL = 'https://live.staticflickr.com/65535/49976843926_0cd6e7a210_b.jpg';

/**
 * Get the test receipt image as base64
 * Returns null if file doesn't exist
 */
export function getTestReceiptBase64(): string | null {
  const receiptPath = resolve(TEST_ASSETS_DIR, 'receipt-test.jpg');

  if (!existsSync(receiptPath)) {
    // Fall back to null - tests will use URL instead
    return null;
  }

  const buffer = readFileSync(receiptPath);
  return `data:image/jpeg;base64,${buffer.toString('base64')}`;
}

/**
 * Get the test receipt image path
 */
export function getTestReceiptPath(): string | null {
  const receiptPath = resolve(TEST_ASSETS_DIR, 'receipt-test.jpg');

  if (!existsSync(receiptPath)) {
    return null;
  }

  return receiptPath;
}

/**
 * Check if test assets are available
 */
export function hasTestAssets(): boolean {
  return existsSync(TEST_ASSETS_DIR) && existsSync(resolve(TEST_ASSETS_DIR, 'receipt-test.jpg'));
}

/**
 * Get test receipt as URL (for when served locally)
 * Uses the uploads directory which is served by the agent server
 */
export function getTestReceiptUrl(): string | null {
  // If we have a base URL and the receipt is copied to uploads, use that
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const uploadsPath = resolve(process.cwd(), 'uploads', 'receipt-test.jpg');

  if (existsSync(uploadsPath)) {
    return `${baseUrl}/uploads/receipt-test.jpg`;
  }

  // For testing, we can use the base64 directly with the imageBase64 field
  return null;
}
