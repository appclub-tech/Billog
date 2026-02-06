/**
 * Gateway Router
 *
 * Routes messages from channels to the Billog agent.
 * Key principle: Session isolation via `channel:sourceId`
 */

import type { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { RequestContext } from '@mastra/core/request-context';
import type {
  Channel,
  ChannelAdapter,
  GatewayConfig,
  InboundMessage,
  OutboundResponse,
  AgentContext,
} from './types.js';
import { makeSessionKey, shouldActivate } from './types.js';
import { LineAdapter } from './adapters/line.js';
import { apiRequest, type ApiContext } from '../tools/api-client.js';
// WhatsApp adapter disabled - baileys has complex build requirements
// import { WhatsAppAdapter } from './adapters/whatsapp.js';

// ===========================================
// Gateway Router
// ===========================================

// User preferences cache entry
interface UserPrefsCache {
  language: 'th' | 'en';
  timezone: string;
  fetchedAt: number;
}

// Task complexity levels for model routing
type TaskComplexity = 'simple' | 'medium' | 'high';

export class GatewayRouter {
  private adapters: Map<Channel, ChannelAdapter> = new Map();
  private config: GatewayConfig;
  private mastra: Mastra | null = null;
  private agent: Agent | null = null;

  // Simple in-memory lock per session (prevent concurrent runs)
  private sessionLocks: Map<string, Promise<void>> = new Map();

  // User preferences cache (key: channel:userId)
  private userPrefsCache: Map<string, UserPrefsCache> = new Map();
  private readonly PREFS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  /**
   * Initialize the gateway with adapters
   */
  async initialize(mastra: Mastra): Promise<void> {
    this.mastra = mastra;

    // Get the billog agent
    this.agent = mastra.getAgent('billog');
    if (!this.agent) {
      throw new Error('Billog agent not found in Mastra instance');
    }

    // Initialize LINE adapter if configured
    if (this.config.line) {
      const lineAdapter = new LineAdapter({
        channelAccessToken: this.config.line.channelAccessToken,
        channelSecret: this.config.line.channelSecret,
        uploadsDir: this.config.line.uploadsDir,
        baseUrl: this.config.line.baseUrl,
      });
      await lineAdapter.initialize();
      this.adapters.set('LINE', lineAdapter);
    }

    // WhatsApp adapter disabled - baileys has complex build requirements
    // To enable: npm install baileys, uncomment imports, and uncomment below
    // if (this.config.whatsapp) {
    //   const { WhatsAppAdapter } = await import('./adapters/whatsapp.js');
    //   const waAdapter = new WhatsAppAdapter(this.config.whatsapp);
    //   waAdapter.onMessage((msg) => this.handleMessage(msg));
    //   await waAdapter.initialize();
    //   this.adapters.set('WHATSAPP', waAdapter);
    // }

    console.log(`✓ Gateway router initialized with ${this.adapters.size} adapter(s)`);
  }

  /**
   * Get adapter by channel
   */
  getAdapter(channel: Channel): ChannelAdapter | undefined {
    return this.adapters.get(channel);
  }

  /**
   * Handle LINE webhook
   */
  async handleLineWebhook(body: unknown, signature: string): Promise<void> {
    const adapter = this.adapters.get('LINE') as LineAdapter | undefined;
    if (!adapter) {
      throw new Error('LINE adapter not initialized');
    }

    // Verify signature
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
    if (!adapter.verifySignature(bodyStr, signature)) {
      throw new Error('Invalid LINE signature');
    }

    // Parse and handle messages
    const messages = await adapter.parseWebhook(body);
    for (const msg of messages) {
      await this.handleMessage(msg);
    }
  }

  /**
   * Handle incoming message from any channel
   */
  async handleMessage(message: InboundMessage): Promise<void> {
    // Log full inbound message for debugging
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[GATEWAY] 📥 INBOUND MESSAGE`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Channel:    ${message.channel}`);
    console.log(`  Source ID:  ${message.source.id}`);
    console.log(`  Source:     ${message.source.type} - ${message.source.name || 'N/A'}`);
    console.log(`  Sender ID:  ${message.sender.id}`);
    console.log(`  Sender:     ${message.sender.name || 'N/A'}`);
    console.log(`  Text:       ${message.text?.substring(0, 100) || '(no text)'}`);
    if (message.imageUrl) {
      console.log(`  Image URL:  ${message.imageUrl}`);
    }
    console.log(`${'='.repeat(60)}\n`);

    // Check activation for groups
    const activationMode = this.config.groupActivation?.mode || 'mention';
    const mentionPatterns = this.config.groupActivation?.mentionPatterns || ['@billog', 'billog'];

    if (!shouldActivate(message, activationMode, mentionPatterns)) {
      // Don't respond in groups unless activated
      console.log(`[${message.channel}] Skipping (not activated): ${message.text?.substring(0, 50)}`);
      return;
    }

    // Create session key for isolation
    const sessionKey = makeSessionKey(message.channel, message.source.id);

    // Acquire lock for this session (prevent concurrent runs)
    await this.acquireLock(sessionKey);

    try {
      console.log(`[${sessionKey}] Processing: ${message.text?.substring(0, 50) || '(no text)'}`);

      // Ensure source, user, membership, and accounts exist
      // This guarantees the user is "registered" regardless of first interaction type
      // Account creation is idempotent (getOrCreate), so safe to call on every message
      await this.ensureSourceInitialized(message);

      // Detect task complexity for model routing
      const taskComplexity = this.detectComplexity(message);

      // Build agent context (includes fetching user preferences)
      const context = await this.buildAgentContext(message);
      console.log(`[${sessionKey}] Agent context:`, JSON.stringify(context, null, 2));
      console.log(`[${sessionKey}] Task complexity: ${taskComplexity}`);

      // Send immediate acknowledgment for high-complexity tasks (receipts)
      // This keeps users engaged while we process the image (~5-10s)
      if (taskComplexity === 'high' && (message.imageUrl || message.imageBase64)) {
        await this.sendResponse(message, { text: '📸 Thanks! Working on it...' });
        // Clear reply token after use - LINE tokens can only be used once
        // The agent response will use push API instead
        message.replyToken = undefined;
      }

      // Format message for agent (includes context injection)
      const agentInput = this.formatAgentInput(message, context);

      // Call agent with session isolation (thread = sourceId) and user context
      const response = await this.callAgent(agentInput, message.source.id, message.channel, context, taskComplexity);

      console.log(`[${sessionKey}] Agent response: ${response?.substring(0, 200) || '(no response)'}`);

      // Send response back via appropriate adapter
      if (response) {
        await this.sendResponse(message, { text: response });
      }
    } catch (error) {
      console.error(`[${sessionKey}] ❌ Error:`, error);
      // Send error message
      await this.sendResponse(message, {
        text: 'ขออภัย เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง 🙏',
      });
    } finally {
      this.releaseLock(sessionKey);
    }
  }

  /**
   * Send response via the appropriate channel
   */
  private async sendResponse(
    originalMessage: InboundMessage,
    response: OutboundResponse
  ): Promise<void> {
    const adapter = this.adapters.get(originalMessage.channel);
    if (!adapter) {
      console.error(`No adapter for channel: ${originalMessage.channel}`);
      return;
    }

    await adapter.send(
      originalMessage.source.id,
      response,
      originalMessage.replyToken
    );
  }

  /**
   * Detect task complexity for model routing
   *
   * Philosophy: Only escalate to gpt-4o when we're CERTAIN it's needed.
   * gpt-4o-mini is capable enough for most expense tracking tasks.
   *
   * - high: Only for images (receipt OCR needs vision + reasoning)
   * - simple: Everything else (let gpt-4o-mini handle it)
   */
  private detectComplexity(message: InboundMessage): TaskComplexity {
    // HIGH: Only for images - receipt processing needs GPT-4o vision
    if (message.imageUrl || message.imageBase64) {
      return 'high';
    }

    // Everything else: gpt-4o-mini is fast and capable enough
    return 'simple';
  }

  /**
   * Build context for agent tools
   */
  private async buildAgentContext(message: InboundMessage): Promise<AgentContext> {
    // Fetch user preferences (cached)
    const prefs = await this.getUserPreferences(message.channel, message.sender.id);

    return {
      channel: message.channel,
      senderChannelId: message.sender.id,
      sourceChannelId: message.source.id,
      isGroup: message.source.type === 'group',
      senderName: message.sender.name,
      sourceName: message.source.name,
      userLanguage: prefs?.language,
      userTimezone: prefs?.timezone,
    };
  }

  /**
   * Get user preferences (with caching)
   * Uses the same apiRequest as tools (proven to work)
   */
  private async getUserPreferences(
    channel: Channel,
    userId: string
  ): Promise<UserPrefsCache | null> {
    const cacheKey = `${channel}:${userId}`;

    // Check cache
    const cached = this.userPrefsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.PREFS_CACHE_TTL_MS) {
      return cached;
    }

    // Fetch from API using same apiRequest as tools
    try {
      const context: ApiContext = {
        channel: channel as 'LINE' | 'WHATSAPP' | 'TELEGRAM',
        senderChannelId: userId,
        sourceChannelId: userId, // For DM, source = sender
      };

      const data = await apiRequest<{
        user?: { language?: string; timezone?: string };
      }>('GET', '/users/me', context);

      const prefs: UserPrefsCache = {
        language: (data.user?.language === 'en' ? 'en' : 'th') as 'th' | 'en',
        timezone: data.user?.timezone || 'Asia/Bangkok',
        fetchedAt: Date.now(),
      };

      // Cache it
      this.userPrefsCache.set(cacheKey, prefs);
      console.log(`[Gateway] Loaded user prefs: language=${prefs.language}`);

      return prefs;
    } catch (error) {
      // User might not exist yet, that's OK
      console.log(`[Gateway] User prefs not found (will use defaults)`);
      return null;
    }
  }

  /**
   * Ensure source, user, membership, and ledger accounts exist
   * Called on every message to guarantee user is registered in the system
   * Uses the same apiRequest as tools (proven to work)
   */
  private async ensureSourceInitialized(message: InboundMessage): Promise<void> {
    try {
      const context: ApiContext = {
        channel: message.channel as 'LINE' | 'WHATSAPP' | 'TELEGRAM',
        senderChannelId: message.sender.id,
        sourceChannelId: message.source.id,
        sourceType: message.source.type === 'group' ? 'GROUP' : 'DM',
      };

      const data = await apiRequest<{
        isNewSource?: boolean;
        isNewUser?: boolean;
        source?: { id: string; name: string };
        user?: { id: string; name: string };
      }>('POST', '/sources/init', context, {
        channel: message.channel,
        sourceChannelId: message.source.id,
        sourceType: message.source.type === 'group' ? 'GROUP' : 'DM',
        sourceName: message.source.name,
        senderChannelId: message.sender.id,
        senderDisplayName: message.sender.name,
        currency: 'THB',
      });

      if (data.isNewSource) {
        console.log(`[Gateway] New source: ${data.source?.name}`);
      }
      if (data.isNewUser) {
        console.log(`[Gateway] New user: ${data.user?.name}`);
      }
    } catch (error) {
      // Don't fail message processing if init fails
      console.error(`[Gateway] Source init error:`, error);
    }
  }

  /**
   * Invalidate user preferences cache (call when language changes)
   */
  invalidateUserPrefs(channel: Channel, userId: string): void {
    const cacheKey = `${channel}:${userId}`;
    this.userPrefsCache.delete(cacheKey);
  }

  /**
   * Format message for agent input
   * Returns either a string (text only) or multi-modal content array (text + image)
   */
  private formatAgentInput(
    message: InboundMessage,
    context: AgentContext
  ): string | Array<{ type: 'text'; text: string } | { type: 'image'; image: URL | string }> {
    // Build context header for the agent
    const contextLines: string[] = [
      `[Context]`,
      `Channel: ${context.channel}`,
      `SenderChannelId: ${context.senderChannelId}`,
      `SourceChannelId: ${context.sourceChannelId}`,
      `IsGroup: ${context.isGroup}`,
    ];

    if (context.senderName) {
      contextLines.push(`SenderName: ${context.senderName}`);
    }
    if (context.sourceName) {
      contextLines.push(`SourceName: ${context.sourceName}`);
    }

    // Note: UserLanguage is passed via RequestContext for dynamic instructions

    // Include quoted message info if present (for expense lookup by EX:id)
    if (message.quotedMessage) {
      contextLines.push(`QuotedMessageId: ${message.quotedMessage.id}`);
      if (message.quotedMessage.text) {
        contextLines.push(`QuotedText: ${message.quotedMessage.text}`);
      }
    }

    // For groups, identify the sender
    let messageText = message.text || '';
    if (message.source.type === 'group') {
      const senderLabel = message.sender.name || message.sender.id;
      messageText = `[From: ${senderLabel}]\n${messageText}`;
    }

    const textContent = `${contextLines.join('\n')}\n\n[Message]\n${messageText}`;

    // If there's an image, return multi-modal content for GPT-4o vision
    // Include imageUrl in context so agent can pass it to OCR tool
    if (message.imageBase64 || message.imageUrl) {
      const imageInstruction = message.imageUrl
        ? `\n\n[Receipt image attached - ImageURL: ${message.imageUrl}]\nUse process-receipt tool with imageUrl="${message.imageUrl}" to process this receipt and save the expense.`
        : '\n\n[Receipt image attached - please process and record the expense]';

      console.log(`[GATEWAY] 🖼️ Including image in multi-modal message`);
      if (message.imageUrl) {
        console.log(`[GATEWAY] 🖼️ ImageURL for OCR tool: ${message.imageUrl}`);
      }

      // Prefer base64 for GPT-4o vision (more reliable)
      if (message.imageBase64) {
        return [
          { type: 'text', text: textContent + imageInstruction },
          { type: 'image', image: message.imageBase64 },
        ];
      } else if (message.imageUrl) {
        return [
          { type: 'text', text: textContent + imageInstruction },
          { type: 'image', image: new URL(message.imageUrl) },
        ];
      }
    }

    return textContent;
  }

  /**
   * Call the Billog agent
   * Supports both text-only and multi-modal (text + image) input
   * Passes user preferences via RequestContext for dynamic instructions
   */
  private async callAgent(
    input: string | Array<{ type: 'text'; text: string } | { type: 'image'; image: URL | string }>,
    sourceId: string,
    channel: Channel,
    context: AgentContext,
    taskComplexity: TaskComplexity
  ): Promise<string | null> {
    if (!this.agent) {
      throw new Error('Agent not initialized');
    }

    // Build the message(s) for the agent
    // For multi-modal content, we need to pass it as a user message with content array
    const messages = Array.isArray(input)
      ? [{ role: 'user' as const, content: input }]
      : input;

    // Create RequestContext with user preferences and task complexity
    // This is the Mastra-idiomatic way to pass dynamic context
    const requestContext = new RequestContext<{
      userLanguage: 'th' | 'en';
      userTimezone: string;
      channel: Channel;
      senderChannelId: string;
      sourceChannelId: string;
      isGroup: boolean;
      senderName?: string;
      sourceName?: string;
      taskComplexity: TaskComplexity;
    }>();

    // Set user preferences (used by dynamic instructions)
    requestContext.set('userLanguage', context.userLanguage || 'th');
    requestContext.set('userTimezone', context.userTimezone || 'Asia/Bangkok');
    requestContext.set('channel', context.channel);
    requestContext.set('senderChannelId', context.senderChannelId);
    requestContext.set('sourceChannelId', context.sourceChannelId);
    requestContext.set('isGroup', context.isGroup);
    if (context.senderName) requestContext.set('senderName', context.senderName);
    if (context.sourceName) requestContext.set('sourceName', context.sourceName);

    // Set task complexity for model routing
    requestContext.set('taskComplexity', taskComplexity);
    console.log(`[Router] Task complexity: ${taskComplexity}`);

    // Call agent with memory for session isolation and requestContext
    // thread = sourceId (group/DM), resource = channel:sourceId
    // maxSteps allows multi-turn: tool call → process result → generate response
    const result = await this.agent.generate(messages, {
      memory: {
        thread: sourceId,
        resource: `${channel}:${sourceId}`,
      },
      requestContext,
      toolChoice: 'auto',
      maxSteps: 5, // Allow up to 5 steps for complex workflows (tool calls + response)
    });

    return result.text || null;
  }

  // ===========================================
  // Session Locking (simple mutex)
  // ===========================================

  private async acquireLock(sessionKey: string): Promise<void> {
    // Wait for existing lock to release
    while (this.sessionLocks.has(sessionKey)) {
      await this.sessionLocks.get(sessionKey);
    }

    // Create new lock
    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    // Store both the promise and resolver
    (lockPromise as any).__release = releaseLock!;
    this.sessionLocks.set(sessionKey, lockPromise);
  }

  private releaseLock(sessionKey: string): void {
    const lock = this.sessionLocks.get(sessionKey);
    if (lock) {
      (lock as any).__release?.();
      this.sessionLocks.delete(sessionKey);
    }
  }

  // ===========================================
  // Cleanup
  // ===========================================

  async shutdown(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown?.();
    }
    this.adapters.clear();
    console.log('Gateway router shutdown complete');
  }
}

// ===========================================
// Factory function
// ===========================================

export function createGateway(config: GatewayConfig): GatewayRouter {
  return new GatewayRouter(config);
}
