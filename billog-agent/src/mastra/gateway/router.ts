/**
 * Gateway Router
 *
 * Routes messages from channels to the Billog workflows/agent.
 * Key principle: Session isolation via `channel:sourceId`
 *
 * Flow:
 * 1. Check for suspended workflow → resume
 * 2. Check if message should use workflow → start workflow
 * 3. Fallback to agent for queries/settlements/help
 */

import type { Mastra, Workflow } from '@mastra/core';
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
import {
  type MessageInput,
  type MessageOutput,
} from '../workflows/index.js';
import { parseExpenseText } from '../tools/parse-text.tool.js';

// ===========================================
// Types
// ===========================================

// User preferences cache entry
interface UserPrefsCache {
  language: 'th' | 'en';
  timezone: string;
  currency: string;
  fetchedAt: number;
}

// Task complexity levels for model routing
type TaskComplexity = 'simple' | 'medium' | 'high';

// Suspended workflow run info
interface SuspendedRun {
  runId: string;
  workflowId: string;
  suspendedStep: string;
  suspendPayload: {
    prompt: string;
    missingFields: string[];
  };
  originalMessage: InboundMessage;
  context: AgentContext;
  createdAt: number;
}

// ===========================================
// Gateway Router
// ===========================================

export class GatewayRouter {
  private adapters: Map<Channel, ChannelAdapter> = new Map();
  private config: GatewayConfig;
  private mastra: Mastra | null = null;
  private agent: Agent | null = null;
  private insightsAgent: Agent | null = null;
  private workflow: Workflow<any, any, any> | null = null;

  // Simple in-memory lock per session (prevent concurrent runs)
  private sessionLocks: Map<string, Promise<void>> = new Map();

  // User preferences cache (key: channel:userId)
  private userPrefsCache: Map<string, UserPrefsCache> = new Map();
  private readonly PREFS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Suspended workflow runs (key: sessionKey)
  private suspendedRuns: Map<string, SuspendedRun> = new Map();
  private readonly SUSPENDED_RUN_TTL_MS = 5 * 60 * 1000; // 5 minutes timeout

  constructor(config: GatewayConfig) {
    this.config = config;
  }

  /**
   * Initialize the gateway with adapters
   */
  async initialize(mastra: Mastra): Promise<void> {
    this.mastra = mastra;

    // Get the billog agent (for fallback)
    this.agent = mastra.getAgent('billog');
    if (!this.agent) {
      throw new Error('Billog agent not found in Mastra instance');
    }

    // Get the insights agent (optional - for parallel execution)
    this.insightsAgent = mastra.getAgent('insights');
    if (this.insightsAgent) {
      console.log('✓ Insights agent registered (parallel mode enabled)');
    } else {
      console.log('⚠ Insights agent not found - running in single-agent mode');
    }

    // Get the message workflow
    this.workflow = mastra.getWorkflow('messageWorkflow');
    if (!this.workflow) {
      console.warn('Message workflow not found - will use agent only');
    } else {
      console.log('✓ Message workflow registered');
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

    console.log(`✓ Gateway router initialized with ${this.adapters.size} adapter(s)`);

    // Start cleanup timer for expired suspended runs
    setInterval(() => this.cleanupExpiredRuns(), 60000); // Every minute
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
    // Compact inbound message log
    const sender = message.sender.name || message.sender.id.substring(0, 8);
    const source = message.source.name || message.source.id.substring(0, 8);
    const text = message.text?.substring(0, 50) || (message.imageUrl ? '📷 image' : '(empty)');
    console.log(`[${message.channel}] 📥 ${sender}@${source}: ${text}`);

    // Check activation for groups
    const activationMode = this.config.groupActivation?.mode || 'mention';
    const mentionPatterns = this.config.groupActivation?.mentionPatterns || ['@billog', 'billog'];

    if (!shouldActivate(message, activationMode, mentionPatterns)) {
      console.log(`[${message.channel}] Skipping (not activated): ${message.text?.substring(0, 50)}`);
      return;
    }

    // Create session key for isolation
    const sessionKey = makeSessionKey(message.channel, message.source.id);

    // Acquire lock for this session (prevent concurrent runs)
    await this.acquireLock(sessionKey);

    // Build context outside try block for error handling
    let context: AgentContext | null = null;

    try {
      console.log(`[${sessionKey}] Processing: ${message.text?.substring(0, 50) || '(no text)'}`);

      // Build agent context (includes fetching user preferences)
      context = await this.buildAgentContext(message);
      console.log(`[${sessionKey}] Context: language=${context.userLanguage}, isGroup=${context.isGroup}`);

      // Check for suspended workflow first
      const suspendedRun = this.suspendedRuns.get(sessionKey);
      if (suspendedRun) {
        console.log(`[${sessionKey}] Resuming suspended workflow: ${suspendedRun.runId}`);
        await this.handleResume(message, sessionKey, suspendedRun, context);
        return;
      }

      // Always use workflow - it handles fallback internally
      if (this.workflow) {
        console.log(`[${sessionKey}] 🔄 Using WORKFLOW`);
        await this.handleWithWorkflow(message, sessionKey, context);
      } else {
        console.log(`[${sessionKey}] 🤖 Using AGENT (no workflow)`);
        await this.handleWithAgent(message, sessionKey, context);
      }
    } catch (error) {
      console.error(`[${sessionKey}] ❌ Error:`, error);
      await this.sendResponse(message, {
        text: context?.userLanguage === 'en'
          ? 'Sorry, an error occurred. Please try again.'
          : 'ขออภัย เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
      });
    } finally {
      this.releaseLock(sessionKey);
    }
  }

  /**
   * Handle message with workflow
   */
  private async handleWithWorkflow(
    message: InboundMessage,
    sessionKey: string,
    context: AgentContext
  ): Promise<void> {
    if (!this.workflow) {
      throw new Error('Workflow not initialized');
    }

    // Build workflow input
    const prefs = await this.getUserPreferences(message.channel, message.sender.id);
    const workflowInput: MessageInput = {
      channel: message.channel as 'LINE' | 'WHATSAPP' | 'TELEGRAM',
      senderChannelId: message.sender.id,
      sourceChannelId: message.source.id,
      isGroup: message.source.type === 'group',
      senderName: message.sender.name,
      sourceName: message.source.name,
      userLanguage: prefs?.language || 'th',
      userCurrency: prefs?.currency || 'THB',
      userTimezone: prefs?.timezone || 'Asia/Bangkok',
      messageText: message.text,
      imageUrl: message.imageUrl,
      imageBase64: message.imageBase64,
      quotedMessageId: message.quotedMessage?.id,
      quotedMessageText: message.quotedMessage?.text,
    };

    // Start workflow
    const run = await this.workflow.createRun();
    const result = await run.start({ inputData: workflowInput });

    // Handle result
    await this.handleWorkflowResult(result, run.runId, sessionKey, message, context);
  }

  /**
   * Handle resume of suspended workflow
   */
  private async handleResume(
    message: InboundMessage,
    sessionKey: string,
    suspendedRun: SuspendedRun,
    context: AgentContext
  ): Promise<void> {
    if (!this.workflow) {
      throw new Error('Workflow not initialized');
    }

    // Parse user's reply to extract missing data
    const resumeData = this.parseResumeData(
      message.text || '',
      suspendedRun.suspendPayload.missingFields
    );

    console.log(`[${sessionKey}] Resume data: ${JSON.stringify(resumeData)}`);

    // Resume workflow
    const run = await this.workflow.createRun({ runId: suspendedRun.runId });
    const result = await run.resume({
      step: suspendedRun.suspendedStep,
      resumeData,
    });

    // Clear suspended run (will be re-added if still suspended)
    this.suspendedRuns.delete(sessionKey);

    // Handle result
    await this.handleWorkflowResult(result, run.runId, sessionKey, message, context);
  }

  /**
   * Handle workflow result (success, suspended, failed)
   */
  private async handleWorkflowResult(
    result: { status: string; result?: unknown; error?: Error; suspendPayload?: unknown; suspended?: unknown },
    runId: string,
    sessionKey: string,
    message: InboundMessage,
    context: AgentContext
  ): Promise<void> {
    console.log(`[${sessionKey}] Workflow result: status=${result.status}`);

    if (result.status === 'success') {
      const rawOutput = result.result as Record<string, unknown> | undefined;

      // Debug log (compact)
      const outputKeys = rawOutput ? Object.keys(rawOutput).join(',') : 'empty';
      console.log(`[${sessionKey}] Workflow output keys: ${outputKeys}`);

      // Extract message from nested workflow output structure
      // Output can be: { message: "..." } or { "dm-workflow": { "step-id": { message: "..." } } }
      const output = this.extractWorkflowOutput(rawOutput);

      // If no message in output, fallback to agent
      if (!output?.message) {
        console.log(`[${sessionKey}] ⚠️ No message in workflow output, falling back to agent`);
        await this.handleWithAgent(message, sessionKey, context);
        return;
      }

      // Check if this is a fallback status (workflow can't handle this message type)
      if (output.status === 'fallback') {
        console.log(`[${sessionKey}] 🔄 Workflow returned fallback: ${output.fallbackReason}`);
        await this.handleWithAgent(message, sessionKey, context);
        return;
      }

      console.log(`[${sessionKey}] ✅ Workflow success: ${output.message.substring(0, 100)}`);
      await this.sendResponse(message, { text: output.message });
      message.replyToken = undefined; // Clear for subsequent push messages

      // Run insights agent in parallel for expense messages
      if (this.insightsAgent && output.expenseId) {
        console.log(`[${sessionKey}] 💡 Running Insights for expense`);
        try {
          const insightsResponse = await this.callInsightsAgent(message, context);
          if (insightsResponse && insightsResponse.trim() !== 'SILENT') {
            console.log(`[${sessionKey}] 💡 Insights: ${insightsResponse.substring(0, 100)}`);
            await this.sendResponse(message, { text: insightsResponse });
          }
        } catch (error) {
          console.error(`[${sessionKey}] Insights error (non-fatal):`, error);
        }
      }
    } else if (result.status === 'suspended') {
      // Store suspended run for resume
      const suspendPayload = result.suspendPayload as {
        prompt: string;
        missingFields: string[];
      };
      // suspended is [[stepId, ...]], extract last step path's last step
      const suspendedPaths = result.suspended as string[][] | undefined;
      const lastPath = suspendedPaths?.[suspendedPaths.length - 1];
      const suspendedStep = lastPath?.[lastPath.length - 1] || 'unknown';

      console.log(`[${sessionKey}] ⏸️ Workflow suspended at: ${suspendedStep}`);
      console.log(`[${sessionKey}] Missing fields: ${suspendPayload.missingFields.join(', ')}`);

      this.suspendedRuns.set(sessionKey, {
        runId,
        workflowId: 'messageWorkflow',
        suspendedStep,
        suspendPayload,
        originalMessage: message,
        context,
        createdAt: Date.now(),
      });

      // Send prompt to user
      await this.sendResponse(message, { text: suspendPayload.prompt });
    } else if (result.status === 'failed') {
      const errorMsg = result.error?.message || 'Unknown error';
      console.error(`[${sessionKey}] ❌ Workflow failed: ${errorMsg}`);

      const text = context.userLanguage === 'en'
        ? `Error: ${errorMsg}`
        : `เกิดข้อผิดพลาด: ${errorMsg}`;
      await this.sendResponse(message, { text });
    } else {
      // Check for fallback status
      const output = result.result as MessageOutput | undefined;
      if (output?.status === 'fallback') {
        console.log(`[${sessionKey}] 🔄 Workflow fallback: ${output.fallbackReason}`);
        // Fall back to agent
        await this.handleWithAgent(message, sessionKey, context);
      } else {
        console.warn(`[${sessionKey}] Unexpected workflow status: ${result.status}`);
        await this.handleWithAgent(message, sessionKey, context);
      }
    }
  }

  /**
   * Extract MessageOutput from nested workflow result
   * Workflow results can be nested like: { "dm-workflow": { "step-id": { message: "..." } } }
   */
  private extractWorkflowOutput(rawOutput: Record<string, unknown> | undefined): MessageOutput | undefined {
    if (!rawOutput) return undefined;

    // If output has message directly, return it
    if (typeof rawOutput.message === 'string') {
      return rawOutput as unknown as MessageOutput;
    }

    // Otherwise, traverse nested structure to find the deepest object with 'message'
    const findMessage = (obj: Record<string, unknown>): MessageOutput | undefined => {
      for (const value of Object.values(obj)) {
        if (value && typeof value === 'object') {
          const nested = value as Record<string, unknown>;
          if (typeof nested.message === 'string') {
            return nested as unknown as MessageOutput;
          }
          // Recurse deeper
          const found = findMessage(nested);
          if (found) return found;
        }
      }
      return undefined;
    };

    return findMessage(rawOutput);
  }

  /**
   * Parse user's reply to extract resume data
   */
  private parseResumeData(
    text: string,
    missingFields: string[]
  ): { description?: string; amount?: number; splitTargets?: string[] } {
    const parsed = parseExpenseText(text);
    const resumeData: { description?: string; amount?: number; splitTargets?: string[] } = {};

    if (missingFields.includes('amount') && parsed.amount) {
      resumeData.amount = parsed.amount;
    }
    if (missingFields.includes('description') && parsed.description) {
      resumeData.description = parsed.description;
    }
    if (missingFields.includes('splitInfo') && parsed.splitTargets.length > 0) {
      resumeData.splitTargets = parsed.splitTargets;
    }

    // If no structured data found, treat entire text as description
    if (!resumeData.description && !resumeData.amount && text.trim()) {
      // Check if it's just a number (amount)
      const numMatch = text.match(/^\s*(\d+(?:\.\d{2})?)\s*$/);
      if (numMatch) {
        resumeData.amount = parseFloat(numMatch[1]);
      } else {
        // Treat as description
        resumeData.description = text.trim();
      }
    }

    return resumeData;
  }

  /**
   * Handle message with agent (fallback)
   * Runs both Bookkeeper and Insights agents in parallel when appropriate
   */
  private async handleWithAgent(
    message: InboundMessage,
    sessionKey: string,
    context: AgentContext
  ): Promise<void> {
    const taskComplexity = this.detectComplexity(message);
    const agentInput = this.formatAgentInput(message, context);

    // Always run both agents in parallel - each decides whether to respond
    // Insights Agent will return "SILENT" if it has nothing useful to say
    if (this.insightsAgent) {
      console.log(`[${sessionKey}] 🔀 Running PARALLEL agents (Bookkeeper + Insights)`);

      const [bookkeeperResult, insightsResult] = await Promise.allSettled([
        this.callAgent(agentInput, message.source.id, message.channel, context, taskComplexity),
        this.callInsightsAgent(message, context),
      ]);

      // Send Bookkeeper response first (if any)
      if (bookkeeperResult.status === 'fulfilled' && bookkeeperResult.value) {
        console.log(`[${sessionKey}] 🤖 Bookkeeper: ${bookkeeperResult.value.substring(0, 100)}`);
        await this.sendResponse(message, { text: bookkeeperResult.value });
        message.replyToken = undefined; // Clear for subsequent push messages
      } else if (bookkeeperResult.status === 'rejected') {
        console.error(`[${sessionKey}] ❌ Bookkeeper error:`, bookkeeperResult.reason);
      }

      // Send Insights response if it has something useful (not "SILENT")
      if (insightsResult.status === 'fulfilled' && insightsResult.value) {
        const insightsResponse = insightsResult.value.trim();
        if (insightsResponse && !insightsResponse.toUpperCase().includes('SILENT')) {
          console.log(`[${sessionKey}] 💡 Insights: ${insightsResponse.substring(0, 100)}`);
          await this.sendResponse(message, { text: insightsResponse });
        } else {
          console.log(`[${sessionKey}] 💡 Insights: (silent)`);
        }
      } else if (insightsResult.status === 'rejected') {
        console.error(`[${sessionKey}] ❌ Insights error:`, insightsResult.reason);
      }
    } else {
      // Insights Agent not configured - run Bookkeeper only
      console.log(`[${sessionKey}] 🤖 Running SINGLE agent (Bookkeeper only)`);

      const response = await this.callAgent(
        agentInput,
        message.source.id,
        message.channel,
        context,
        taskComplexity
      );

      if (response) {
        console.log(`[${sessionKey}] 🤖 Bookkeeper: ${response.substring(0, 100)}`);
        await this.sendResponse(message, { text: response });
      }
    }
  }

  /**
   * Call Insights Agent
   * Let the agent decide whether to respond or stay silent
   */
  private async callInsightsAgent(
    message: InboundMessage,
    context: AgentContext
  ): Promise<string | null> {
    if (!this.insightsAgent) {
      return null;
    }

    // Simple context - let the agent understand the message naturally
    const contextLines: string[] = [
      `[Context]`,
      `Channel: ${context.channel}`,
      `SourceChannelId: ${context.sourceChannelId}`,
      `IsGroup: ${context.isGroup}`,
    ];

    const messageText = message.text || '';
    const content = `${contextLines.join('\n')}\n\n[Message]\n${messageText}`;

    const requestContext = new RequestContext<{
      userLanguage: 'th' | 'en';
      userTimezone: string;
      channel: Channel;
      senderChannelId: string;
      sourceChannelId: string;
      isGroup: boolean;
    }>();

    requestContext.set('userLanguage', context.userLanguage || 'th');
    requestContext.set('userTimezone', context.userTimezone || 'Asia/Bangkok');
    requestContext.set('channel', context.channel);
    requestContext.set('senderChannelId', context.senderChannelId);
    requestContext.set('sourceChannelId', context.sourceChannelId);
    requestContext.set('isGroup', context.isGroup);

    try {
      const result = await this.insightsAgent.generate(content, {
        requestContext,
        toolChoice: 'auto',
        maxSteps: 3,
      });

      return result.text || null;
    } catch (error) {
      console.error(`[Insights] Agent error:`, error);
      return null;
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
   */
  private detectComplexity(message: InboundMessage): TaskComplexity {
    if (message.imageUrl || message.imageBase64) {
      return 'high';
    }
    return 'simple';
  }

  /**
   * Build context for agent tools
   */
  private async buildAgentContext(message: InboundMessage): Promise<AgentContext> {
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
   */
  private async getUserPreferences(
    channel: Channel,
    userId: string
  ): Promise<UserPrefsCache | null> {
    const cacheKey = `${channel}:${userId}`;

    const cached = this.userPrefsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.PREFS_CACHE_TTL_MS) {
      return cached;
    }

    try {
      const context: ApiContext = {
        channel: channel as 'LINE' | 'WHATSAPP' | 'TELEGRAM',
        senderChannelId: userId,
        sourceChannelId: userId,
      };

      const data = await apiRequest<{
        user?: { language?: string; timezone?: string; currency?: string };
      }>('GET', '/users/me', context);

      const prefs: UserPrefsCache = {
        language: (data.user?.language === 'en' ? 'en' : 'th') as 'th' | 'en',
        timezone: data.user?.timezone || 'Asia/Bangkok',
        currency: data.user?.currency || 'THB',
        fetchedAt: Date.now(),
      };

      this.userPrefsCache.set(cacheKey, prefs);
      console.log(`[Gateway] Loaded user prefs: language=${prefs.language}, currency=${prefs.currency}`);

      return prefs;
    } catch (error) {
      console.log(`[Gateway] User prefs not found (will use defaults)`);
      return null;
    }
  }

  /**
   * Invalidate user preferences cache
   */
  invalidateUserPrefs(channel: Channel, userId: string): void {
    const cacheKey = `${channel}:${userId}`;
    this.userPrefsCache.delete(cacheKey);
  }

  /**
   * Format message for agent input
   */
  private formatAgentInput(
    message: InboundMessage,
    context: AgentContext
  ): string | Array<{ type: 'text'; text: string } | { type: 'image'; image: URL | string }> {
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

    if (message.quotedMessage) {
      contextLines.push(`QuotedMessageId: ${message.quotedMessage.id}`);
      if (message.quotedMessage.text) {
        contextLines.push(`QuotedText: ${message.quotedMessage.text}`);
      }
    }

    let messageText = message.text || '';
    if (message.source.type === 'group') {
      const senderLabel = message.sender.name || message.sender.id;
      messageText = `[From: ${senderLabel}]\n${messageText}`;
    }

    const textContent = `${contextLines.join('\n')}\n\n[Message]\n${messageText}`;
 
    if (message.imageUrl) {
      console.log(`[GATEWAY] 🧾 Receipt: ${message.imageUrl}`);
      return textContent + `\n\n[Receipt Image]\nImageURL: ${message.imageUrl}`;
    }
  

    return textContent;
  }

  /**
   * Call the Billog agent
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

    const messages = Array.isArray(input)
      ? [{ role: 'user' as const, content: input }]
      : input;

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

    requestContext.set('userLanguage', context.userLanguage || 'th');
    requestContext.set('userTimezone', context.userTimezone || 'Asia/Bangkok');
    requestContext.set('channel', context.channel);
    requestContext.set('senderChannelId', context.senderChannelId);
    requestContext.set('sourceChannelId', context.sourceChannelId);
    requestContext.set('isGroup', context.isGroup);
    if (context.senderName) requestContext.set('senderName', context.senderName);
    if (context.sourceName) requestContext.set('sourceName', context.sourceName);
    requestContext.set('taskComplexity', taskComplexity);

    const result = await this.agent.generate(messages, {
      memory: {
        thread: sourceId,
        resource: `${channel}:${sourceId}`,
      },
      requestContext,
      toolChoice: 'auto',
      maxSteps: 5,
    });

    return result.text || null;
  }

  // ===========================================
  // Session Locking
  // ===========================================

  private async acquireLock(sessionKey: string): Promise<void> {
    while (this.sessionLocks.has(sessionKey)) {
      await this.sessionLocks.get(sessionKey);
    }

    let releaseLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

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

  private cleanupExpiredRuns(): void {
    const now = Date.now();
    for (const [key, run] of this.suspendedRuns) {
      if (now - run.createdAt > this.SUSPENDED_RUN_TTL_MS) {
        console.log(`[Gateway] Cleaning up expired suspended run: ${key}`);
        this.suspendedRuns.delete(key);
      }
    }
  }

  async shutdown(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown?.();
    }
    this.adapters.clear();
    this.suspendedRuns.clear();
    console.log('Gateway router shutdown complete');
  }
}

// ===========================================
// Factory function
// ===========================================

export function createGateway(config: GatewayConfig): GatewayRouter {
  return new GatewayRouter(config);
}
