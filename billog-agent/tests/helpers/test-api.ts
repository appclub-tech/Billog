/**
 * Test API Helpers
 * For verifying API calls and database state
 */

import jwt from 'jsonwebtoken';
import { TEST_CONTEXT } from './test-context.js';

const BILLOG_API_URL = process.env.BILLOG_API_URL || 'http://localhost:8000';
const BILLOG_JWT_SECRET = process.env.BILLOG_JWT_SECRET || 'test-jwt-secret';

/**
 * Generate a test JWT token
 */
export function generateTestToken(
  overrides: Partial<typeof TEST_CONTEXT> = {}
): string {
  const payload = {
    sub: 'test-agent',
    channel: TEST_CONTEXT.channel,
    senderChannelId: TEST_CONTEXT.senderChannelId,
    sourceChannelId: TEST_CONTEXT.sourceChannelId,
    sourceType: 'GROUP',
    iss: 'billog-agent-test',
    ...overrides,
  };

  return jwt.sign(payload, BILLOG_JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Make an API request with test authentication
 */
export async function testApiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const url = `${BILLOG_API_URL}/api${path}`;
  const token = generateTestToken();

  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return {} as T;
  }
}

/**
 * Initialize source (registers user and source in the database)
 */
export async function initializeTestSource(): Promise<{
  source: { id: string; name: string };
  user: { id: string; name: string };
}> {
  return testApiRequest('POST', '/sources/init', {
    channel: TEST_CONTEXT.channel,
    sourceChannelId: TEST_CONTEXT.sourceChannelId,
    sourceType: 'GROUP',
    sourceName: TEST_CONTEXT.sourceName,
    senderChannelId: TEST_CONTEXT.senderChannelId,
    senderDisplayName: TEST_CONTEXT.senderName,
    currency: 'THB',
  });
}

/**
 * Get expenses for the test source
 */
export async function getTestExpenses(limit = 10): Promise<{
  expenses: Array<{
    id: string;
    description: string;
    amount: number;
    currency: string;
    items?: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
    }>;
  }>;
  total: number;
}> {
  const params = new URLSearchParams({
    channel: TEST_CONTEXT.channel,
    sourceChannelId: TEST_CONTEXT.sourceChannelId,
    limit: limit.toString(),
  });

  return testApiRequest('GET', `/expenses?${params}`);
}

/**
 * Get a specific expense by ID
 */
export async function getTestExpenseById(expenseId: string): Promise<{
  expense: {
    id: string;
    description: string;
    amount: number;
    currency: string;
    items?: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      ingredientType?: string;
    }>;
    receipt?: {
      id: string;
      storeName?: string;
      imageUrl?: string;
    };
  };
}> {
  return testApiRequest('GET', `/expenses/${expenseId}`);
}

/**
 * Delete a test expense
 */
export async function deleteTestExpense(expenseId: string): Promise<void> {
  await testApiRequest('DELETE', `/expenses/${expenseId}`);
}

/**
 * Clean up test expenses (delete all expenses for test source)
 */
export async function cleanupTestExpenses(): Promise<void> {
  try {
    const { expenses } = await getTestExpenses(100);
    for (const expense of expenses) {
      await deleteTestExpense(expense.id);
    }
  } catch (error) {
    // Source might not exist yet, ignore
  }
}

/**
 * Check if the API is reachable
 */
export async function isApiReachable(): Promise<boolean> {
  try {
    const response = await fetch(`${BILLOG_API_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get source details (verifies source exists with accounts)
 */
export async function getTestSource(): Promise<{
  source: {
    id: string;
    name: string;
    channel: string;
    channelId: string;
    currency: string;
    accounts?: Array<{
      id: string;
      name: string;
      type: string;
    }>;
  };
}> {
  const params = new URLSearchParams({
    channel: TEST_CONTEXT.channel,
    sourceChannelId: TEST_CONTEXT.sourceChannelId,
  });
  return testApiRequest('GET', `/sources?${params}`);
}

/**
 * Get balances for the test source (verifies ledger entries)
 */
export async function getTestBalances(): Promise<{
  balances: Array<{
    userId: string;
    userName: string;
    balance: number;
    owes: Array<{ to: string; amount: number }>;
    owed: Array<{ from: string; amount: number }>;
  }>;
}> {
  const params = new URLSearchParams({
    channel: TEST_CONTEXT.channel,
    sourceChannelId: TEST_CONTEXT.sourceChannelId,
  });
  return testApiRequest('GET', `/balances?${params}`);
}

/**
 * Get expense with full details including receipt and ledger transfers
 */
export async function getTestExpenseFullDetails(expenseId: string): Promise<{
  expense: {
    id: string;
    description: string;
    amount: number;
    currency: string;
    paidById: string;
    paidByName?: string;
    sourceId: string;
    items?: Array<{
      id: string;
      name: string;
      quantity: number;
      unitPrice: number;
    }>;
    receipt?: {
      id: string;
      storeName?: string;
      imageUrl?: string;
      rawText?: string;
    };
    splits?: Array<{
      userId: string;
      userName?: string;
      amount: number;
    }>;
    ledgerEntries?: Array<{
      id: string;
      fromAccountId: string;
      toAccountId: string;
      amount: number;
    }>;
    paymentMethod?: {
      id: string;
      name: string;
      type: string;
    };
  };
}> {
  return testApiRequest('GET', `/expenses/${expenseId}?include=receipt,items,splits,ledger`);
}

/**
 * Get receipt by ID
 */
export async function getTestReceipt(receiptId: string): Promise<{
  receipt: {
    id: string;
    expenseId: string;
    storeName?: string;
    storeAddress?: string;
    imageUrl?: string;
    rawText?: string;
    processedAt?: string;
    createdAt: string;
  };
}> {
  return testApiRequest('GET', `/receipts/${receiptId}`);
}

/**
 * Get receipts for the test source
 */
export async function getTestReceipts(limit = 10): Promise<{
  receipts: Array<{
    id: string;
    expenseId: string;
    storeName?: string;
    imageUrl?: string;
    createdAt: string;
  }>;
  total: number;
}> {
  const params = new URLSearchParams({
    channel: TEST_CONTEXT.channel,
    sourceChannelId: TEST_CONTEXT.sourceChannelId,
    limit: limit.toString(),
  });
  return testApiRequest('GET', `/receipts?${params}`);
}
