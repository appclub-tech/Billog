/**
 * Test Context Helpers
 * Creates mock contexts for agent testing
 */

import { RequestContext } from '@mastra/core/request-context';
import type { InboundMessage, Channel, AgentContext } from '../../src/mastra/gateway/types.js';

/**
 * Task complexity levels
 */
type TaskComplexity = 'simple' | 'medium' | 'high';

/**
 * Test context type definition
 */
interface TestContextType {
  channel: Channel;
  senderChannelId: string;
  sourceChannelId: string;
  senderName: string;
  sourceName: string;
  isGroup: boolean;
  userLanguage: 'th' | 'en';
  userTimezone: string;
  taskComplexity: TaskComplexity;
}

/**
 * Default test context values
 */
export const TEST_CONTEXT: TestContextType = {
  channel: 'LINE',
  senderChannelId: 'test-sender-123',
  sourceChannelId: 'test-group-456',
  senderName: 'Test User',
  sourceName: 'Test Group',
  isGroup: true,
  userLanguage: 'th',
  userTimezone: 'Asia/Bangkok',
  taskComplexity: 'simple',
};

/**
 * Create a mock InboundMessage
 */
export function createMockMessage(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: `msg-${Date.now()}`,
    channel: TEST_CONTEXT.channel,
    text: 'coffee 65',
    sender: {
      id: TEST_CONTEXT.senderChannelId,
      name: TEST_CONTEXT.senderName,
    },
    source: {
      id: TEST_CONTEXT.sourceChannelId,
      type: 'group',
      name: TEST_CONTEXT.sourceName,
    },
    timestamp: new Date(),
    ...overrides,
  };
}

/**
 * Create a mock InboundMessage with image (receipt)
 */
export function createMockReceiptMessage(
  imageUrl: string,
  overrides: Partial<InboundMessage> = {}
): InboundMessage {
  return createMockMessage({
    text: undefined,
    imageUrl,
    imageBase64: undefined, // Will be set if needed
    ...overrides,
  });
}

/**
 * Create a mock AgentContext
 */
export function createMockAgentContext(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    channel: TEST_CONTEXT.channel,
    senderChannelId: TEST_CONTEXT.senderChannelId,
    sourceChannelId: TEST_CONTEXT.sourceChannelId,
    isGroup: TEST_CONTEXT.isGroup,
    senderName: TEST_CONTEXT.senderName,
    sourceName: TEST_CONTEXT.sourceName,
    userLanguage: TEST_CONTEXT.userLanguage,
    userTimezone: TEST_CONTEXT.userTimezone,
    ...overrides,
  };
}

/**
 * Create a mock RequestContext for agent.generate()
 */
export function createMockRequestContext(
  overrides: Partial<TestContextType> = {}
): RequestContext<TestContextType> {
  const ctx = new RequestContext<TestContextType>();
  const merged = { ...TEST_CONTEXT, ...overrides };

  ctx.set('channel', merged.channel);
  ctx.set('senderChannelId', merged.senderChannelId);
  ctx.set('sourceChannelId', merged.sourceChannelId);
  ctx.set('senderName', merged.senderName);
  ctx.set('sourceName', merged.sourceName);
  ctx.set('isGroup', merged.isGroup);
  ctx.set('userLanguage', merged.userLanguage);
  ctx.set('userTimezone', merged.userTimezone);
  ctx.set('taskComplexity', merged.taskComplexity);

  return ctx;
}

/**
 * Content part types for multi-modal messages
 */
type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image'; image: string };
type ContentPart = TextPart | ImagePart;

/**
 * Format message for agent input (same as router)
 * Returns string for text-only, or array of content parts for multi-modal
 */
export function formatAgentInput(
  message: InboundMessage,
  context: AgentContext
): string | ContentPart[] {
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

  // Multi-modal content for images
  if (message.imageBase64 || message.imageUrl) {
    const imageInstruction = message.imageUrl
      ? `\n\n[Receipt image attached - ImageURL: ${message.imageUrl}]\nUse extract-receipt tool with imageUrl="${message.imageUrl}" to process this receipt.`
      : '\n\n[Receipt image attached - please extract items and amounts]';

    const parts: ContentPart[] = [
      { type: 'text', text: textContent + imageInstruction },
    ];

    if (message.imageBase64) {
      parts.push({ type: 'image', image: message.imageBase64 });
    } else if (message.imageUrl) {
      parts.push({ type: 'image', image: message.imageUrl });
    }

    return parts;
  }

  return textContent;
}

/**
 * Wrap agent input for generate() call
 * The agent.generate() expects either a string or properly formatted messages
 */
export function wrapAgentInput(
  input: string | ContentPart[]
): string | Array<{ role: 'user'; content: ContentPart[] }> {
  if (typeof input === 'string') {
    return input;
  }
  // Wrap multi-modal content in a message with role
  return [{ role: 'user' as const, content: input }];
}
