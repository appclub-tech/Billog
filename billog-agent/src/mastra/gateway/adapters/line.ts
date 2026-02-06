/**
 * LINE Messaging API Adapter
 *
 * Handles LINE webhook parsing and message sending.
 * Uses LINE Messaging API v3.
 */

import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type { ChannelAdapter, InboundMessage, OutboundResponse } from '../types.js';

// ===========================================
// LINE Types (minimal subset we need)
// ===========================================

interface LineWebhookEvent {
  type: string;
  replyToken?: string;
  source: {
    type: 'user' | 'group' | 'room';
    userId?: string;
    groupId?: string;
    roomId?: string;
  };
  timestamp: number;
  message?: {
    type: string;
    id: string;
    text?: string;
    quotedMessageId?: string; // ID of the message being replied to
    mention?: {
      mentionees: Array<{ userId: string }>;
    };
    contentProvider?: {
      type: 'line' | 'external';
      originalContentUrl?: string;
    };
  };
}

interface LineWebhookBody {
  events: LineWebhookEvent[];
}

interface LineProfile {
  displayName: string;
  userId: string;
  pictureUrl?: string;
}

interface LineGroupSummary {
  groupId: string;
  groupName: string;
}

// ===========================================
// LINE Adapter
// ===========================================

export class LineAdapter implements ChannelAdapter {
  readonly channel = 'LINE' as const;

  private accessToken: string;
  private channelSecret: string;
  private apiBase = 'https://api.line.me/v2';
  private uploadsDir: string;
  private baseUrl: string;

  constructor(config: {
    channelAccessToken: string;
    channelSecret: string;
    uploadsDir?: string;
    baseUrl?: string;
  }) {
    this.accessToken = config.channelAccessToken;
    this.channelSecret = config.channelSecret;
    this.uploadsDir = config.uploadsDir || './uploads';
    this.baseUrl = config.baseUrl || process.env.BASE_URL || 'http://localhost:3000';
  }

  async initialize(): Promise<void> {
    // Ensure uploads directory exists
    await fs.mkdir(this.uploadsDir, { recursive: true });

    // Verify credentials by getting bot info
    try {
      const response = await fetch(`${this.apiBase}/bot/info`, {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`LINE API error: ${response.status}`);
      }
      const info = await response.json();
      console.log(`✓ LINE adapter initialized: ${info.displayName}`);
    } catch (error) {
      console.error('Failed to initialize LINE adapter:', error);
      throw error;
    }
  }

  /**
   * Verify webhook signature (X-Line-Signature header)
   */
  verifySignature(body: string | Buffer, signature: string): boolean {
    const bodyStr = typeof body === 'string' ? body : body.toString('utf-8');
    const hash = crypto
      .createHmac('SHA256', this.channelSecret)
      .update(bodyStr)
      .digest('base64');
    return hash === signature;
  }

  /**
   * Parse LINE webhook payload into unified messages
   */
  async parseWebhook(payload: unknown): Promise<InboundMessage[]> {
    const body = payload as LineWebhookBody;
    const messages: InboundMessage[] = [];

    for (const event of body.events) {
      // Only handle message events
      if (event.type !== 'message' || !event.message) {
        continue;
      }

      const messageType = event.message.type;

      // Skip unsupported message types
      if (!['text', 'image'].includes(messageType)) {
        continue;
      }

      const sourceId = this.getSourceId(event.source);
      const sourceType = event.source.type === 'user' ? 'dm' : 'group';

      // Get sender profile (best effort)
      let senderName: string | undefined;
      let pictureUrl: string | undefined;
      if (event.source.userId) {
        try {
          const profile = await this.getProfile(
            event.source.userId,
            sourceType === 'group' ? sourceId : undefined
          );
          senderName = profile.displayName;
          pictureUrl = profile.pictureUrl;
        } catch {
          // Profile fetch failed, continue without it
        }
      }

      // Get group name (best effort)
      let sourceName: string | undefined;
      if (sourceType === 'group') {
        try {
          const group = await this.getGroupSummary(sourceId);
          sourceName = group.groupName;
        } catch {
          // Group fetch failed, continue without it
        }
      }

      // Extract mentions (only for text messages)
      const mentions = event.message.mention?.mentionees.map((m) => m.userId) || [];

      // Build base message
      const message: InboundMessage = {
        id: event.message.id,
        channel: 'LINE',
        sender: {
          id: event.source.userId || 'unknown',
          name: senderName,
          pictureUrl,
        },
        source: {
          id: sourceId,
          type: sourceType,
          name: sourceName,
        },
        mentions,
        replyToken: event.replyToken,
        timestamp: new Date(event.timestamp),
      };

      // Handle text message
      if (messageType === 'text') {
        message.text = event.message.text;
      }

      // Handle image message
      if (messageType === 'image') {
        try {
          // Download image and get both URL and base64
          const { url, base64, mimeType } = await this.downloadAndSaveImageWithBase64(event.message.id);
          message.imageUrl = url;
          message.imageBase64 = `data:${mimeType};base64,${base64}`;
          message.text = '[Receipt Image]'; // Placeholder text so agent knows there's an image
          console.log(`✓ Image ready: URL=${url}, base64 length=${base64.length}`);
        } catch (error) {
          console.error('Failed to download image:', error);
          message.text = '[Failed to download image]';
        }
      }

      // Handle quoted/replied message - just pass the ID, agent can query by EX:id
      if (event.message.quotedMessageId) {
        message.quotedMessage = {
          id: event.message.quotedMessageId,
        };
        console.log(`✓ Message is replying to: ${event.message.quotedMessageId}`);
      }

      messages.push(message);
    }

    return messages;
  }

  /**
   * Download image from LINE and save locally
   * Returns the accessible URL
   */
  async downloadAndSaveImage(messageId: string): Promise<string> {
    // Download from LINE Content API
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    // Get content type and determine extension
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpeg';

    // Generate unique filename
    const filename = `${messageId}.${ext}`;
    const filepath = path.join(this.uploadsDir, filename);

    // Save to disk
    const buffer = await response.arrayBuffer();
    await fs.writeFile(filepath, Buffer.from(buffer));

    console.log(`✓ Saved image: ${filepath}`);

    // Return accessible URL
    return `${this.baseUrl}/uploads/${filename}`;
  }

  /**
   * Download image from LINE and save locally + return base64
   * Returns both URL and base64 for flexibility
   */
  async downloadAndSaveImageWithBase64(messageId: string): Promise<{ url: string; base64: string; mimeType: string }> {
    // Download from LINE Content API
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    // Get content type and determine extension
    const mimeType = response.headers.get('content-type') || 'image/jpeg';
    const ext = mimeType.includes('png') ? 'png' : 'jpeg';

    // Generate unique filename
    const filename = `${messageId}.${ext}`;
    const filepath = path.join(this.uploadsDir, filename);

    // Save to disk and convert to base64
    const buffer = await response.arrayBuffer();
    const nodeBuffer = Buffer.from(buffer);
    await fs.writeFile(filepath, nodeBuffer);
    const base64 = nodeBuffer.toString('base64');

    console.log(`✓ Saved image: ${filepath} (${nodeBuffer.length} bytes)`);

    // Return both URL and base64
    return {
      url: `${this.baseUrl}/uploads/${filename}`,
      base64,
      mimeType,
    };
  }

  /**
   * Send response via LINE
   */
  async send(
    sourceId: string,
    response: OutboundResponse,
    replyToken?: string
  ): Promise<void> {
    const messages = this.buildLineMessages(response);

    if (replyToken) {
      // Use reply API (preferred, no additional cost)
      await this.replyMessage(replyToken, messages);
    } else {
      // Use push API (costs quota)
      await this.pushMessage(sourceId, messages);
    }
  }

  // ===========================================
  // Private helpers
  // ===========================================

  private getSourceId(source: LineWebhookEvent['source']): string {
    return source.groupId || source.roomId || source.userId || 'unknown';
  }

  private async getProfile(userId: string, groupId?: string): Promise<LineProfile> {
    const url = groupId
      ? `${this.apiBase}/bot/group/${groupId}/member/${userId}`
      : `${this.apiBase}/bot/profile/${userId}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get profile: ${response.status}`);
    }

    return response.json();
  }

  private async getGroupSummary(groupId: string): Promise<LineGroupSummary> {
    const response = await fetch(`${this.apiBase}/bot/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to get group summary: ${response.status}`);
    }

    return response.json();
  }

  private buildLineMessages(response: OutboundResponse): object[] {
    const messages: object[] = [];

    // Text message
    if (response.text) {
      // Split long messages (LINE limit: 5000 chars)
      const chunks = this.splitText(response.text, 4900);
      for (const chunk of chunks) {
        messages.push({ type: 'text', text: chunk });
      }
    }

    // Image message (only if it's a URL we can serve)
    if (response.imageUrl) {
      messages.push({
        type: 'image',
        originalContentUrl: response.imageUrl,
        previewImageUrl: response.imageUrl,
      });
    }

    // Quick replies (attach to last message)
    if (response.quickReplies && response.quickReplies.length > 0 && messages.length > 0) {
      const lastMsg = messages[messages.length - 1] as Record<string, unknown>;
      lastMsg.quickReply = {
        items: response.quickReplies.map((qr) => ({
          type: 'action',
          action: {
            type: 'message',
            label: qr.label.substring(0, 20), // LINE limit
            text: qr.text,
          },
        })),
      };
    }

    return messages;
  }

  private splitText(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }

      // Find break point (newline or space)
      let breakAt = remaining.lastIndexOf('\n', maxLength);
      if (breakAt < maxLength / 2) {
        breakAt = remaining.lastIndexOf(' ', maxLength);
      }
      if (breakAt < maxLength / 2) {
        breakAt = maxLength;
      }

      chunks.push(remaining.substring(0, breakAt));
      remaining = remaining.substring(breakAt).trimStart();
    }

    return chunks;
  }

  private async replyMessage(replyToken: string, messages: object[]): Promise<void> {
    const response = await fetch(`${this.apiBase}/bot/message/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) }), // LINE limit: 5 messages
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LINE reply failed: ${response.status} ${error}`);
    }
  }

  private async pushMessage(to: string, messages: object[]): Promise<void> {
    const response = await fetch(`${this.apiBase}/bot/message/push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({ to, messages: messages.slice(0, 5) }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LINE push failed: ${response.status} ${error}`);
    }
  }

  /**
   * Download image content from LINE (returns base64)
   * Use downloadAndSaveImage for receipt processing
   */
  async downloadImage(messageId: string): Promise<{ base64: string; mimeType: string }> {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const mimeType = response.headers.get('content-type') || 'image/jpeg';

    return { base64, mimeType };
  }
}
