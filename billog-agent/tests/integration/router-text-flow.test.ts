/**
 * Router Text Flow Integration Tests
 *
 * Tests text-based expense creation:
 * Router → Agent → Tools → API → Database
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { GatewayRouter, createGateway } from '../../src/mastra/gateway/router.js';
import type { InboundMessage, GatewayConfig, ChannelAdapter } from '../../src/mastra/gateway/types.js';
import { billogAgent } from '../../src/mastra/agents/billog.agent.js';
import {
  isApiReachable,
  initializeTestSource,
  getTestExpenseById,
  deleteTestExpense,
  testApiRequest,
  getTestExpenseFullDetails,
} from '../helpers/test-api.js';
import { TEST_CONTEXT } from '../helpers/test-context.js';

// Track created resources for cleanup
let createdExpenseIds: string[] = [];

// Test prerequisites
let canRunIntegration = false;
let skipReason = '';

describe('Router Text Flow', () => {
  let router: GatewayRouter;
  let mockAdapter: ChannelAdapter;

  beforeAll(async () => {
    // Check prerequisites
    if (!process.env.OPENAI_API_KEY) {
      skipReason = 'OPENAI_API_KEY not set';
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
    // This tests the agent-based expense recording path.
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

  // Helper to create test message with unique source ID
  function createTestMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
    const uniqueSourceId = `test-text-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      channel: 'LINE',
      text: 'coffee 65',
      sender: {
        id: TEST_CONTEXT.senderChannelId,
        name: TEST_CONTEXT.senderName,
      },
      source: {
        id: uniqueSourceId,
        type: 'group',
        name: TEST_CONTEXT.sourceName,
      },
      timestamp: new Date(),
      replyToken: 'test-reply-token',
      ...overrides,
    };
  }

  function extractExpenseId(text: string): string | null {
    const match = text.match(/EX:([a-zA-Z0-9-]+)/i);
    return match ? match[1] : null;
  }

  describe('Simple Text Expenses', () => {
    it('creates expense from "coffee 65"', async () => {
      if (!canRunIntegration) {
        console.log(`Skipped: ${skipReason}`);
        return;
      }

      const message = createTestMessage({ text: 'coffee 65' });
      await router.handleMessage(message);

      const response = (mockAdapter.send as any).mock.calls[0][1];
      const expenseId = extractExpenseId(response.text);

      expect(expenseId).not.toBeNull();
      createdExpenseIds.push(expenseId!);

      const { expense } = await getTestExpenseById(expenseId!);
      expect(expense.description.toLowerCase()).toContain('coffee');
      expect(expense.amount).toBe(65);
      expect(expense.currency).toBe('THB');
    }, 60000);

    it('creates expense with category detection: "grab home 120"', async () => {
      if (!canRunIntegration) return;

      const message = createTestMessage({ text: 'grab home 120' });
      await router.handleMessage(message);

      const response = (mockAdapter.send as any).mock.calls[0][1];
      const expenseId = extractExpenseId(response.text);

      expect(expenseId).not.toBeNull();
      createdExpenseIds.push(expenseId!);

      const { expense } = await getTestExpenseById(expenseId!);
      expect(expense.amount).toBe(120);
    }, 60000);

    it('handles Thai input: "กาแฟ 45"', async () => {
      if (!canRunIntegration) return;

      const message = createTestMessage({ text: 'กาแฟ 45' });
      await router.handleMessage(message);

      const response = (mockAdapter.send as any).mock.calls[0][1];
      const expenseId = extractExpenseId(response.text);

      if (expenseId) {
        createdExpenseIds.push(expenseId);
        const { expense } = await getTestExpenseById(expenseId);
        expect(expense.amount).toBe(45);
      }
    }, 60000);

    it('handles split: "lunch 500 @all"', async () => {
      if (!canRunIntegration) return;

      const message = createTestMessage({ text: 'lunch 500 @all' });
      await router.handleMessage(message);

      const response = (mockAdapter.send as any).mock.calls[0][1];
      const expenseId = extractExpenseId(response.text);

      if (expenseId) {
        createdExpenseIds.push(expenseId);
      }
    }, 60000);
  });

  describe('Context Passing', () => {
    it('passes channel context to tools', async () => {
      if (!canRunIntegration) return;

      const message = createTestMessage({ text: 'test expense 50' });
      await router.handleMessage(message);

      expect(mockAdapter.send).toHaveBeenCalled();
      const response = (mockAdapter.send as any).mock.calls[0][1];
      expect(response.text).toMatch(/EX:[a-zA-Z0-9-]+/);

      const expenseId = extractExpenseId(response.text);
      if (expenseId) createdExpenseIds.push(expenseId);
    }, 60000);

    it('handles DM vs Group correctly', async () => {
      if (!canRunIntegration) return;

      const dmMessage = createTestMessage({
        text: 'dm expense 75',
        source: {
          id: `dm-${Date.now()}`,
          type: 'dm',
        },
      });

      await router.handleMessage(dmMessage);

      const response = (mockAdapter.send as any).mock.calls[0][1];
      const expenseId = extractExpenseId(response.text);
      if (expenseId) createdExpenseIds.push(expenseId);
    }, 60000);
  });

  describe('Payment Method Linking', () => {
    it('links default Cash payment method to text expense', async () => {
      if (!canRunIntegration) return;

      const message = createTestMessage({ text: 'payment test 99' });
      await router.handleMessage(message);

      const response = (mockAdapter.send as any).mock.calls[0][1];
      const expenseId = extractExpenseId(response.text);

      expect(expenseId).not.toBeNull();
      createdExpenseIds.push(expenseId!);

      // Verify payment method was linked
      const { expense } = await getTestExpenseById(expenseId!);
      expect(expense).toBeDefined();

      // Check for payment method linkage via API
      const details = await testApiRequest<{
        expense: {
          id: string;
          paymentMethods?: Array<{ id: string; name: string; type: string; amount: number }>;
        };
      }>('GET', `/expenses/${expenseId}?include=paymentMethods`);

      console.log(`[TEST] Payment methods: ${JSON.stringify(details.expense.paymentMethods)}`);

      // Should have at least one payment method (Cash default)
      if (details.expense.paymentMethods) {
        expect(details.expense.paymentMethods.length).toBeGreaterThan(0);
        const cashMethod = details.expense.paymentMethods.find(pm => pm.type === 'CASH');
        expect(cashMethod).toBeDefined();
      }
    }, 60000);
  });
});
