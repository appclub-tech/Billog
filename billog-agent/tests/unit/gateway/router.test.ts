/**
 * Unit tests for GatewayRouter
 *
 * Tests the router logic without making real API calls or agent invocations.
 * Uses mocks to isolate each component.
 *
 * Strategy: Initialize router WITHOUT LINE config to avoid adapter initialization,
 * then manually inject a mock adapter for testing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { InboundMessage, GatewayConfig, ChannelAdapter } from '../../../src/mastra/gateway/types.js';

// Mock the api-client module
vi.mock('../../../src/mastra/tools/api-client.js', () => ({
  apiRequest: vi.fn().mockResolvedValue({}),
}));

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

describe('GatewayRouter', () => {
  let router: GatewayRouter;
  let mockConfig: GatewayConfig;
  let mockLineAdapterInstance: ReturnType<typeof createMockAdapter>;
  let mockMastra: any;
  let mockAgent: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create fresh mock adapter
    mockLineAdapterInstance = createMockAdapter();

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
      generate: vi.fn().mockResolvedValue({ text: 'Test response' }),
    };

    mockMastra = {
      getAgent: vi.fn().mockReturnValue(mockAgent),
    };

    router = createGateway(mockConfig);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Helper to initialize router with mock adapter
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

    it('throws error if billog agent not found', async () => {
      mockMastra.getAgent.mockReturnValue(null);
      await expect(router.initialize(mockMastra)).rejects.toThrow('Billog agent not found');
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

      // Should not call agent
      expect(mockAgent.generate).not.toHaveBeenCalled();
    });

    it('processes message in group with @billog mention', async () => {
      const message = createTestMessage({ text: '@billog coffee 65' });
      await router.handleMessage(message);

      // Should call agent
      expect(mockAgent.generate).toHaveBeenCalled();
    });

    it('always processes DM messages', async () => {
      const message = createTestMessage({
        text: 'coffee 65',
        source: { id: 'U123', type: 'dm' },
      });
      await router.handleMessage(message);

      expect(mockAgent.generate).toHaveBeenCalled();
    });

    it('sends response back via adapter', async () => {
      const message = createTestMessage({ text: '@billog coffee 65' });
      await router.handleMessage(message);

      expect(mockLineAdapterInstance.send).toHaveBeenCalledWith(
        'C456', // sourceId
        { text: 'Test response' },
        'reply-token-123'
      );
    });

    it('calls ensureSourceInitialized before processing', async () => {
      const message = createTestMessage({
        text: 'coffee 65',
        source: { id: 'U123', type: 'dm' },
      });

      await router.handleMessage(message);

      // Should have called apiRequest for source init
      expect(apiRequest).toHaveBeenCalledWith(
        'POST',
        '/sources/init',
        expect.any(Object),
        expect.objectContaining({
          channel: 'LINE',
          sourceChannelId: 'U123',
        })
      );
    });

    it('sends error message on agent failure', async () => {
      mockAgent.generate.mockRejectedValue(new Error('Agent error'));

      const message = createTestMessage({
        text: 'coffee 65',
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

    it('sends acknowledgment for image messages before processing', async () => {
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
        { text: expect.stringContaining('Working on it') },
        'reply-token-123'
      );
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

    it('parses and processes messages from webhook', async () => {
      const testMessage = {
        id: 'msg-1',
        channel: 'LINE' as const,
        text: 'test',
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

  describe('session locking', () => {
    beforeEach(async () => {
      await initializeWithMockAdapter();
    });

    it('prevents concurrent processing for same session', async () => {
      const processingOrder: number[] = [];
      let resolveFirst: () => void;
      const firstBlocking = new Promise<void>((r) => { resolveFirst = r; });

      // First call blocks until we release it
      mockAgent.generate
        .mockImplementationOnce(async () => {
          processingOrder.push(1);
          await firstBlocking;
          processingOrder.push(2);
          return { text: 'First' };
        })
        .mockImplementationOnce(async () => {
          processingOrder.push(3);
          return { text: 'Second' };
        });

      const message1: InboundMessage = {
        id: 'msg-1',
        channel: 'LINE',
        text: 'first',
        sender: { id: 'U123' },
        source: { id: 'U123', type: 'dm' },
        timestamp: new Date(),
      };

      const message2: InboundMessage = {
        id: 'msg-2',
        channel: 'LINE',
        text: 'second',
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

      mockAgent.generate
        .mockImplementationOnce(async () => {
          processingOrder.push('session1-start');
          await new Promise((r) => setTimeout(r, 50));
          processingOrder.push('session1-end');
          return { text: 'First' };
        })
        .mockImplementationOnce(async () => {
          processingOrder.push('session2-start');
          await new Promise((r) => setTimeout(r, 10));
          processingOrder.push('session2-end');
          return { text: 'Second' };
        });

      const message1: InboundMessage = {
        id: 'msg-1',
        channel: 'LINE',
        text: 'msg from user1',
        sender: { id: 'U111' },
        source: { id: 'U111', type: 'dm' },
        timestamp: new Date(),
      };

      const message2: InboundMessage = {
        id: 'msg-2',
        channel: 'LINE',
        text: 'msg from user2',
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
