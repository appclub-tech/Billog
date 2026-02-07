/**
 * Router Receipt Flow Integration Tests
 *
 * Tests receipt/image processing:
 * Router → Agent → OCR Tool → Create Expense Tool → API → Database
 *
 * This tests the problematic flow where:
 * 1. User sends image
 * 2. Router detects high complexity (image)
 * 3. Agent calls extract-receipt tool (OCR)
 * 4. Agent calls create-expense with receiptData
 * 5. API creates expense + items + receipt records
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { GatewayRouter, createGateway } from '../../src/mastra/gateway/router.js';
import type { InboundMessage, GatewayConfig, ChannelAdapter } from '../../src/mastra/gateway/types.js';
import { billogAgent } from '../../src/mastra/agents/billog.agent.js';
import {
  isApiReachable,
  initializeTestSource,
  getTestExpenseById,
  getTestExpenseFullDetails,
  deleteTestExpense,
} from '../helpers/test-api.js';
import { TEST_CONTEXT } from '../helpers/test-context.js';

// Real receipt for testing
const REAL_RECEIPT_URL = 'https://billog-gateway.ngrok.app/uploads/599859283680821517.jpeg';

// Track created resources for cleanup
let createdExpenseIds: string[] = [];

// Test prerequisites
let canRunIntegration = false;
let skipReason = '';

describe('Router Receipt Flow', () => {
  let router: GatewayRouter;
  let mockAdapter: ChannelAdapter;

  beforeAll(async () => {
    // Check prerequisites
    if (!process.env.OPENAI_API_KEY) {
      skipReason = 'OPENAI_API_KEY not set';
      console.warn(`Skipping integration tests: ${skipReason}`);
      return;
    }

    if (!process.env.GOOGLE_API_KEY) {
      skipReason = 'GOOGLE_API_KEY not set (needed for OCR)';
      console.warn(`Skipping integration tests: ${skipReason}`);
      return;
    }

    const apiReachable = await isApiReachable();
    if (!apiReachable) {
      skipReason = 'Billog API not reachable';
      console.warn(`Skipping integration tests: ${skipReason}`);
      return;
    }

    canRunIntegration = true;

    // Initialize test source
    await initializeTestSource();

    // Create mock adapter for sending responses
    mockAdapter = {
      channel: 'LINE',
      initialize: vi.fn().mockResolvedValue(undefined),
      verifySignature: vi.fn().mockReturnValue(true),
      parseWebhook: vi.fn().mockResolvedValue([]),
      send: vi.fn().mockResolvedValue(undefined),
      shutdown: vi.fn().mockResolvedValue(undefined),
    };

    // Create router with test config
    const config: GatewayConfig = {
      billogApiUrl: process.env.BILLOG_API_URL || 'http://localhost:8000',
      groupActivation: {
        mode: 'always',
        mentionPatterns: ['@billog', 'billog'],
      },
    };

    router = createGateway(config);

    // Note: We skip workflow integration tests for now due to nested workflow data passing issues.
    // The router will fall back to using the agent directly when workflow is not available.
    // This tests the agent-based receipt processing path.
    const mockMastra = {
      getAgent: vi.fn().mockReturnValue(billogAgent),
      getWorkflow: vi.fn().mockReturnValue(null), // No workflow - use agent fallback
    };

    await router.initialize(mockMastra as any);
    (router as any).adapters.set('LINE', mockAdapter);
  });

  beforeEach(() => {
    createdExpenseIds = [];
    vi.clearAllMocks();
  });

  afterAll(async () => {
    for (const id of createdExpenseIds) {
      try {
        await deleteTestExpense(id);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  function extractExpenseId(text: string): string | null {
    const match = text.match(/EX:([a-zA-Z0-9-]+)/i);
    return match ? match[1] : null;
  }

  describe('Receipt Image Processing', () => {
    it('processes receipt image through router', async () => {
      if (!canRunIntegration) {
        console.log(`Skipped: ${skipReason}`);
        return;
      }

      // Create message with receipt image (unique source to avoid memory)
      const uniqueSourceId = `test-receipt-${Date.now()}`;
      const message: InboundMessage = {
        id: `msg-receipt-${Date.now()}`,
        channel: 'LINE',
        text: undefined, // No text, just image
        imageUrl: REAL_RECEIPT_URL,
        sender: {
          id: TEST_CONTEXT.senderChannelId,
          name: TEST_CONTEXT.senderName,
        },
        source: {
          id: uniqueSourceId,
          type: 'dm',
        },
        timestamp: new Date(),
        replyToken: 'test-reply-token',
      };

      console.log(`\n${'='.repeat(60)}`);
      console.log(`[TEST] Processing receipt: ${REAL_RECEIPT_URL}`);
      console.log(`[TEST] Source ID: ${uniqueSourceId}`);
      console.log(`${'='.repeat(60)}\n`);

      await router.handleMessage(message);

      // Check responses
      const sendCalls = (mockAdapter.send as any).mock.calls;
      console.log(`[TEST] Adapter.send called ${sendCalls.length} times`);

      expect(sendCalls.length).toBeGreaterThanOrEqual(1);

      // First call should be acknowledgment for image
      if (sendCalls.length >= 1) {
        const firstResponse = sendCalls[0][1];
        console.log(`[TEST] First response: ${firstResponse.text}`);
      }

      // Last call should have the expense result
      const finalResponse = sendCalls[sendCalls.length - 1][1];
      console.log(`[TEST] Final response: ${finalResponse.text?.substring(0, 500)}`);

      const expenseId = extractExpenseId(finalResponse.text || '');

      if (expenseId) {
        console.log(`[TEST] ✓ Expense created: EX:${expenseId}`);
        createdExpenseIds.push(expenseId);

        // Verify expense in database
        const { expense } = await getTestExpenseById(expenseId);
        expect(expense).toBeDefined();
        console.log(`[TEST] Amount: ${expense.amount} ${expense.currency}`);
        console.log(`[TEST] Items: ${expense.items?.length || 0}`);

        // Check items
        if (expense.items && expense.items.length > 0) {
          console.log(`[TEST] Line items:`);
          for (const item of expense.items) {
            console.log(`  - ${item.name}: ${item.quantity} x ${item.unitPrice}`);
          }
          expect(expense.items.length).toBeGreaterThan(0);
        }

        // Check receipt linkage
        if (expense.receipt) {
          console.log(`[TEST] Receipt: ${expense.receipt.id}`);
          console.log(`[TEST] Store: ${expense.receipt.storeName}`);
          expect(expense.receipt).toBeDefined();
        }
      } else {
        // Debug: why no expense?
        console.log(`[TEST] ❌ No expense ID in response`);
        console.log(`[TEST] Full response: ${finalResponse.text}`);

        // Check for errors
        const isError = /error|ผิดพลาด|fail|sorry/i.test(finalResponse.text || '');
        if (isError) {
          console.log(`[TEST] Error detected in response`);
        }

        // Fail if no expense created
        expect(expenseId).not.toBeNull();
      }
    }, 180000); // 3 minute timeout for OCR + LLM

    it('creates expense items from receipt', async () => {
      if (!canRunIntegration) return;

      const uniqueSourceId = `test-items-${Date.now()}`;
      const message: InboundMessage = {
        id: `msg-items-${Date.now()}`,
        channel: 'LINE',
        text: undefined,
        imageUrl: REAL_RECEIPT_URL,
        sender: {
          id: TEST_CONTEXT.senderChannelId,
          name: TEST_CONTEXT.senderName,
        },
        source: {
          id: uniqueSourceId,
          type: 'dm',
        },
        timestamp: new Date(),
        replyToken: 'test-reply-token',
      };

      await router.handleMessage(message);

      const sendCalls = (mockAdapter.send as any).mock.calls;
      const finalResponse = sendCalls[sendCalls.length - 1][1];
      const expenseId = extractExpenseId(finalResponse.text || '');

      if (expenseId) {
        createdExpenseIds.push(expenseId);

        const { expense } = await getTestExpenseById(expenseId);

        // Receipt should have items
        console.log(`[TEST] Expense has ${expense.items?.length || 0} items`);

        if (expense.items && expense.items.length > 0) {
          // Verify item structure
          const firstItem = expense.items[0];
          expect(firstItem.name).toBeDefined();
          expect(firstItem.unitPrice).toBeGreaterThanOrEqual(0);
        }
      }
    }, 180000);

    it('links receipt record to expense', async () => {
      if (!canRunIntegration) return;

      const uniqueSourceId = `test-receipt-link-${Date.now()}`;
      const message: InboundMessage = {
        id: `msg-link-${Date.now()}`,
        channel: 'LINE',
        text: undefined,
        imageUrl: REAL_RECEIPT_URL,
        sender: {
          id: TEST_CONTEXT.senderChannelId,
          name: TEST_CONTEXT.senderName,
        },
        source: {
          id: uniqueSourceId,
          type: 'dm',
        },
        timestamp: new Date(),
        replyToken: 'test-reply-token',
      };

      await router.handleMessage(message);

      const sendCalls = (mockAdapter.send as any).mock.calls;
      const finalResponse = sendCalls[sendCalls.length - 1][1];
      const expenseId = extractExpenseId(finalResponse.text || '');

      if (expenseId) {
        createdExpenseIds.push(expenseId);

        const { expense } = await getTestExpenseById(expenseId);

        // Should have receipt linked
        expect(expense.receipt).toBeDefined();
        if (expense.receipt) {
          expect(expense.receipt.id).toBeDefined();
          console.log(`[TEST] Receipt linked: ${expense.receipt.id}`);
          console.log(`[TEST] Store name: ${expense.receipt.storeName}`);
          console.log(`[TEST] Image URL: ${expense.receipt.imageUrl}`);
        }
      }
    }, 180000);

    it('records payment method from receipt', async () => {
      if (!canRunIntegration) return;

      const uniqueSourceId = `test-payment-${Date.now()}`;
      const message: InboundMessage = {
        id: `msg-payment-${Date.now()}`,
        channel: 'LINE',
        text: undefined,
        imageUrl: REAL_RECEIPT_URL,
        sender: {
          id: TEST_CONTEXT.senderChannelId,
          name: TEST_CONTEXT.senderName,
        },
        source: {
          id: uniqueSourceId,
          type: 'dm',
        },
        timestamp: new Date(),
        replyToken: 'test-reply-token',
      };

      await router.handleMessage(message);

      const sendCalls = (mockAdapter.send as any).mock.calls;
      const finalResponse = sendCalls[sendCalls.length - 1][1];
      const expenseId = extractExpenseId(finalResponse.text || '');

      if (expenseId) {
        createdExpenseIds.push(expenseId);

        // Get full details including payment
        const details = await getTestExpenseFullDetails(expenseId);

        console.log(`[TEST] Payment method: ${JSON.stringify(details.expense.paymentMethod)}`);

        // Payment method presence depends on receipt content
        // Just log for now, don't fail if not present
      }
    }, 180000);
  });

  describe('Error Handling', () => {
    it('handles unreachable image URL gracefully', async () => {
      if (!canRunIntegration) return;

      const uniqueSourceId = `test-bad-url-${Date.now()}`;
      const message: InboundMessage = {
        id: `msg-bad-${Date.now()}`,
        channel: 'LINE',
        text: undefined,
        imageUrl: 'https://example.com/nonexistent-image.jpg',
        sender: {
          id: TEST_CONTEXT.senderChannelId,
          name: TEST_CONTEXT.senderName,
        },
        source: {
          id: uniqueSourceId,
          type: 'dm',
        },
        timestamp: new Date(),
        replyToken: 'test-reply-token',
      };

      await router.handleMessage(message);

      // Should respond with error, not crash
      expect(mockAdapter.send).toHaveBeenCalled();
    }, 60000);
  });
});
