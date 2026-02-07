/**
 * Unit tests for GatewayRouter
 *
 * Tests the router logic without making real API calls or agent invocations.
 * Uses mocks to isolate each component.
 *
 * Strategy: Initialize router WITHOUT LINE config to avoid adapter initialization,
 * then manually inject a mock adapter for testing.
 *
 * Note: The router now uses workflows for expense-like messages and falls back
 * to agent for queries/settlements/help. These tests focus on routing behavior.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InboundMessage, GatewayConfig, ChannelAdapter } from '../../../src/mastra/gateway/types.js';

// Mock the api-client module (keep actual exports, only mock apiRequest)
vi.mock('../../../src/mastra/tools/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/mastra/tools/api-client.js')>();
  return {
    ...actual,
    apiRequest: vi.fn().mockResolvedValue({}),
  };
});

// Import after mocks are set up
import { GatewayRouter, createGateway } from '../../../src/mastra/gateway/router.js';
import { apiRequest } from '../../../src/mastra/tools/api-client.js';

// Create mock adapter that we can inject
function createMockAdapter(): ChannelAdapter & { send: ReturnType<typeof vi.fn> } {
  return {
    channel: 'LINE',
    initialize: vi.fn().mockResolvedValue(undefined),
    verifySignature: vi.fn().mockReturnValue(true),
    parseWebhook: vi.fn().mockResolvedValue([]),
    send: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  };
}

// Create mock workflow
function createMockWorkflow() {
  const mockRun = {
    runId: 'mock-run-123',
    start: vi.fn().mockResolvedValue({
      status: 'success',
      result: { success: true, status: 'success', message: 'Workflow response' },
    }),
    resume: vi.fn().mockResolvedValue({
      status: 'success',
      result: { success: true, status: 'success', message: 'Resume response' },
    }),
  };

  return {
    createRun: vi.fn().mockResolvedValue(mockRun),
    _mockRun: mockRun,
  };
}

describe('GatewayRouter', () => {
  let router: GatewayRouter;
  let mockConfig: GatewayConfig;
  let mockLineAdapterInstance: ReturnType<typeof createMockAdapter>;
  let mockMastra: any;
  let mockAgent: any;
  let mockWorkflow: ReturnType<typeof createMockWorkflow>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mock adapter
    mockLineAdapterInstance = createMockAdapter();

    // Create mock workflow
    mockWorkflow = createMockWorkflow();

    // Config WITHOUT LINE to avoid real adapter initialization
    mockConfig = {
      billogApiUrl: 'http://localhost:8000',
      // No line config - we'll inject the mock adapter manually
      groupActivation: {
        mode: 'mention',
        mentionPatterns: ['@billog', 'billog'],
      },
    };

    mockAgent = {
      generate: vi.fn().mockResolvedValue({ text: 'Agent response' }),
    };

    mockMastra = {
      getAgent: vi.fn().mockReturnValue(mockAgent),
      getWorkflow: vi.fn().mockReturnValue(mockWorkflow),
    };

    router = createGateway(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to initialize router with mock adapter and workflow
  async function initializeWithMockAdapter() {
    await router.initialize(mockMastra);
    // Inject mock adapter
    (router as any).adapters.set('LINE', mockLineAdapterInstance);
  }

  describe('createGateway', () => {
    it('creates a GatewayRouter instance', () => {
      expect(router).toBeInstanceOf(GatewayRouter);
    });
  });

  describe('initialize', () => {
    it('initializes with Mastra and gets billog agent', async () => {
      await router.initialize(mockMastra);
      expect(mockMastra.getAgent).toHaveBeenCalledWith('billog');
    });

    it('initializes with Mastra and gets message workflow', async () => {
      await router.initialize(mockMastra);
      expect(mockMastra.getWorkflow).toHaveBeenCalledWith('messageWorkflow');
    });

    it('throws error if billog agent not found', async () => {
      mockMastra.getAgent.mockReturnValue(null);
      await expect(router.initialize(mockMastra)).rejects.toThrow('Billog agent not found');
    });

    it('logs warning if workflow not found (uses agent fallback)', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      mockMastra.getWorkflow.mockReturnValue(null);
      await router.initialize(mockMastra);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('workflow not found'));
    });

    it('returns undefined for unconfigured adapter', async () => {
      await router.initialize(mockMastra);
      // No LINE config, so adapter should not exist
      const adapter = router.getAdapter('LINE');
      expect(adapter).toBeUndefined();
    });
  });

  describe('handleMessage', () => {
    const createTestMessage = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
      id: 'msg-1',
      channel: 'LINE',
      text: '@billog coffee 65',
      sender: { id: 'U123', name: 'Test User' },
      source: { id: 'C456', type: 'group', name: 'Test Group' },
      timestamp: new Date(),
      replyToken: 'reply-token-123',
      ...overrides,
    });

    beforeEach(async () => {
      await initializeWithMockAdapter();
    });

    it('skips message in group without activation trigger', async () => {
      const message = createTestMessage({ text: 'random chat' });
      await router.handleMessage(message);

      // Should not call workflow or agent
      expect(mockWorkflow.createRun).not.toHaveBeenCalled();
      expect(mockAgent.generate).not.toHaveBeenCalled();
    });

    it('uses workflow for expense-like messages (text expense)', async () => {
      const message = createTestMessage({ text: '@billog coffee 65' });
      await router.handleMessage(message);

      // Should use workflow, not agent
      expect(mockWorkflow.createRun).toHaveBeenCalled();
      expect(mockAgent.generate).not.toHaveBeenCalled();
    });

    it('uses agent fallback for query messages (list)', async () => {
      const message = createTestMessage({ text: '@billog list expenses' });
      await router.handleMessage(message);

      // Should use agent (fallback) for "list" pattern
      expect(mockAgent.generate).toHaveBeenCalled();
      expect(mockWorkflow.createRun).not.toHaveBeenCalled();
    });

    it('uses agent fallback for balance queries', async () => {
      const message = createTestMessage({ text: '@billog who owes what' });
      await router.handleMessage(message);

      expect(mockAgent.generate).toHaveBeenCalled();
      expect(mockWorkflow.createRun).not.toHaveBeenCalled();
    });

    it('uses agent fallback for summary queries', async () => {
      const message = createTestMessage({ text: '@billog summary' });
      await router.handleMessage(message);

      expect(mockAgent.generate).toHaveBeenCalled();
      expect(mockWorkflow.createRun).not.toHaveBeenCalled();
    });

    it('always processes DM messages', async () => {
      const message = createTestMessage({
        text: 'coffee 65',
        source: { id: 'U123', type: 'dm' },
      });
      await router.handleMessage(message);

      // DM expense should use workflow
      expect(mockWorkflow.createRun).toHaveBeenCalled();
    });

    it('sends workflow response back via adapter', async () => {
      const message = createTestMessage({ text: '@billog coffee 65' });
      await router.handleMessage(message);

      expect(mockLineAdapterInstance.send).toHaveBeenCalledWith(
        'C456', // sourceId
        { text: 'Workflow response' },
        'reply-token-123'
      );
    });

    it('sends agent response back via adapter for queries', async () => {
      const message = createTestMessage({ text: '@billog list expenses' });
      await router.handleMessage(message);

      expect(mockLineAdapterInstance.send).toHaveBeenCalledWith(
        'C456',
        { text: 'Agent response' },
        'reply-token-123'
      );
    });

    it('sends error message on workflow failure', async () => {
      mockWorkflow._mockRun.start.mockResolvedValue({
        status: 'failed',
        error: new Error('Workflow error'),
      });

      const message = createTestMessage({
        text: 'coffee 65',
        source: { id: 'U123', type: 'dm' },
      });
      await router.handleMessage(message);

      expect(mockLineAdapterInstance.send).toHaveBeenCalledWith(
        'U123',
        expect.objectContaining({
          text: expect.stringContaining('Workflow error'),
        }),
        'reply-token-123'
      );
    });

    it('sends error message on agent failure', async () => {
      mockAgent.generate.mockRejectedValue(new Error('Agent error'));

      // Use query pattern so agent is called instead of workflow
      const message = createTestMessage({
        text: 'list expenses',
        source: { id: 'U123', type: 'dm' },
      });
      await router.handleMessage(message);

      expect(mockLineAdapterInstance.send).toHaveBeenCalledWith(
        'U123',
        expect.objectContaining({
          text: expect.stringContaining('ขออภัย'),
        }),
        'reply-token-123'
      );
    });

    it('sends acknowledgment for image messages before workflow processing', async () => {
      const message = createTestMessage({
        text: undefined,
        imageUrl: 'https://example.com/receipt.jpg',
        source: { id: 'U123', type: 'dm' },
      });

      await router.handleMessage(message);

      // First call should be acknowledgment
      expect(mockLineAdapterInstance.send).toHaveBeenNthCalledWith(
        1,
        'U123',
        { text: expect.stringMatching(/Processing|ประมวลผล/i) },
        'reply-token-123'
      );
    });

    it('uses workflow for receipt images', async () => {
      const message = createTestMessage({
        text: undefined,
        imageUrl: 'https://example.com/receipt.jpg',
        source: { id: 'U123', type: 'dm' },
      });

      await router.handleMessage(message);

      expect(mockWorkflow.createRun).toHaveBeenCalled();
    });
  });

  describe('handleLineWebhook', () => {
    beforeEach(async () => {
      await initializeWithMockAdapter();
    });

    it('throws error when LINE adapter not initialized', async () => {
      (router as any).adapters.clear();

      await expect(
        router.handleLineWebhook({}, 'signature')
      ).rejects.toThrow('LINE adapter not initialized');
    });

    it('throws error on invalid signature', async () => {
      (mockLineAdapterInstance.verifySignature as any).mockReturnValue(false);

      await expect(
        router.handleLineWebhook({ events: [] }, 'invalid-sig')
      ).rejects.toThrow('Invalid LINE signature');
    });

    it('parses and processes messages from webhook using workflow', async () => {
      const testMessage = {
        id: 'msg-1',
        channel: 'LINE' as const,
        text: 'coffee 65', // Expense-like message → uses workflow
        sender: { id: 'U123' },
        source: { id: 'U123', type: 'dm' as const },
        timestamp: new Date(),
      };

      (mockLineAdapterInstance.parseWebhook as any).mockResolvedValue([testMessage]);

      await router.handleLineWebhook({ events: [] }, 'valid-sig');

      expect(mockLineAdapterInstance.parseWebhook).toHaveBeenCalled();
      expect(mockWorkflow.createRun).toHaveBeenCalled();
    });

    it('parses and processes query messages using agent fallback', async () => {
      const testMessage = {
        id: 'msg-1',
        channel: 'LINE' as const,
        text: 'list expenses', // Query message (matches "list" pattern) → uses agent
        sender: { id: 'U123' },
        source: { id: 'U123', type: 'dm' as const },
        timestamp: new Date(),
      };

      (mockLineAdapterInstance.parseWebhook as any).mockResolvedValue([testMessage]);

      await router.handleLineWebhook({ events: [] }, 'valid-sig');

      expect(mockLineAdapterInstance.parseWebhook).toHaveBeenCalled();
      expect(mockAgent.generate).toHaveBeenCalled();
    });
  });

  describe('workflow suspend/resume', () => {
    beforeEach(async () => {
      await initializeWithMockAdapter();
    });

    it('stores suspended workflow run for later resume', async () => {
      // Configure workflow to suspend
      mockWorkflow._mockRun.start.mockResolvedValue({
        status: 'suspended',
        suspendPayload: {
          prompt: 'What is the amount?',
          missingFields: ['amount'],
        },
        suspended: [['dm-validate']],
      });

      const message = createTestMessage({
        text: 'coffee',
        source: { id: 'U123', type: 'dm' },
      });

      await router.handleMessage(message);

      // Should send the prompt
      expect(mockLineAdapterInstance.send).toHaveBeenCalledWith(
        'U123',
        { text: 'What is the amount?' },
        'reply-token-123'
      );

      // Session key should have suspended run stored
      const suspendedRuns = (router as any).suspendedRuns as Map<string, any>;
      expect(suspendedRuns.has('LINE:U123')).toBe(true);
    });

    it('resumes suspended workflow on follow-up message', async () => {
      // First: configure workflow to suspend
      mockWorkflow._mockRun.start.mockResolvedValue({
        status: 'suspended',
        suspendPayload: {
          prompt: 'What is the amount?',
          missingFields: ['amount'],
        },
        suspended: [['dm-validate']],
      });

      const firstMessage = createTestMessage({
        text: 'coffee',
        source: { id: 'U123', type: 'dm' },
        replyToken: 'token-1',
      });

      await router.handleMessage(firstMessage);

      // Reset workflow mock for resume
      mockWorkflow._mockRun.resume.mockResolvedValue({
        status: 'success',
        result: { success: true, status: 'success', message: 'Recorded coffee 65' },
      });

      // Second: send follow-up with amount
      const secondMessage = createTestMessage({
        id: 'msg-2',
        text: '65',
        source: { id: 'U123', type: 'dm' },
        replyToken: 'token-2',
      });

      await router.handleMessage(secondMessage);

      // Should have resumed the workflow
      expect(mockWorkflow._mockRun.resume).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'dm-validate',
          resumeData: expect.objectContaining({ amount: 65 }),
        })
      );
    });

    // Helper for suspend/resume tests
    function createTestMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
      return {
        id: 'msg-1',
        channel: 'LINE',
        text: '@billog coffee 65',
        sender: { id: 'U123', name: 'Test User' },
        source: { id: 'C456', type: 'group', name: 'Test Group' },
        timestamp: new Date(),
        replyToken: 'reply-token-123',
        ...overrides,
      };
    }
  });

  describe('session locking', () => {
    beforeEach(async () => {
      await initializeWithMockAdapter();
    });

    it('prevents concurrent processing for same session', async () => {
      const processingOrder: number[] = [];
      let resolveFirst: () => void;
      const firstBlocking = new Promise<void>((r) => { resolveFirst = r; });

      // First workflow call blocks until we release it
      mockWorkflow._mockRun.start
        .mockImplementationOnce(async () => {
          processingOrder.push(1);
          await firstBlocking;
          processingOrder.push(2);
          return { status: 'success', result: { success: true, status: 'success', message: 'First' } };
        })
        .mockImplementationOnce(async () => {
          processingOrder.push(3);
          return { status: 'success', result: { success: true, status: 'success', message: 'Second' } };
        });

      const message1: InboundMessage = {
        id: 'msg-1',
        channel: 'LINE',
        text: 'coffee 65', // Expense message → uses workflow
        sender: { id: 'U123' },
        source: { id: 'U123', type: 'dm' },
        timestamp: new Date(),
      };

      const message2: InboundMessage = {
        id: 'msg-2',
        channel: 'LINE',
        text: 'lunch 100', // Expense message → uses workflow
        sender: { id: 'U123' },
        source: { id: 'U123', type: 'dm' },
        timestamp: new Date(),
      };

      // Start both in parallel
      const promise1 = router.handleMessage(message1);
      const promise2 = router.handleMessage(message2);

      // Give time for both to start
      await new Promise((r) => setTimeout(r, 50));

      // Release first
      resolveFirst!();

      await Promise.all([promise1, promise2]);

      // Second should wait for first to complete
      expect(processingOrder).toEqual([1, 2, 3]);
    });

    it('allows parallel processing for different sessions', async () => {
      const processingOrder: string[] = [];

      mockWorkflow._mockRun.start
        .mockImplementationOnce(async () => {
          processingOrder.push('session1-start');
          await new Promise((r) => setTimeout(r, 50));
          processingOrder.push('session1-end');
          return { status: 'success', result: { success: true, status: 'success', message: 'First' } };
        })
        .mockImplementationOnce(async () => {
          processingOrder.push('session2-start');
          await new Promise((r) => setTimeout(r, 10));
          processingOrder.push('session2-end');
          return { status: 'success', result: { success: true, status: 'success', message: 'Second' } };
        });

      const message1: InboundMessage = {
        id: 'msg-1',
        channel: 'LINE',
        text: 'coffee 65', // Expense message
        sender: { id: 'U111' },
        source: { id: 'U111', type: 'dm' },
        timestamp: new Date(),
      };

      const message2: InboundMessage = {
        id: 'msg-2',
        channel: 'LINE',
        text: 'lunch 100', // Expense message
        sender: { id: 'U222' },
        source: { id: 'U222', type: 'dm' },
        timestamp: new Date(),
      };

      await Promise.all([
        router.handleMessage(message1),
        router.handleMessage(message2),
      ]);

      // Both should start immediately (interleaved)
      expect(processingOrder[0]).toBe('session1-start');
      expect(processingOrder[1]).toBe('session2-start');
    });
  });

  describe('shutdown', () => {
    it('shuts down all adapters', async () => {
      await initializeWithMockAdapter();

      await router.shutdown();

      expect(mockLineAdapterInstance.shutdown).toHaveBeenCalled();
      expect(router.getAdapter('LINE')).toBeUndefined();
    });
  });
});
