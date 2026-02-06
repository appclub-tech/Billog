/**
 * Billog Gateway - Lightweight Channel Abstraction
 *
 * Simple types for multi-channel support.
 * Key design: Session isolation via `channel:sourceId`
 */

// ===========================================
// Core Types
// ===========================================

export type Channel = 'LINE' | 'WHATSAPP' | 'TELEGRAM';

export type SourceType = 'dm' | 'group';

/**
 * Inbound message from any channel
 */
export interface InboundMessage {
  /** Message ID from platform */
  id: string;
  /** Channel source */
  channel: Channel;
  /** Text content */
  text?: string;
  /** Image URL or base64 (for receipts) */
  imageUrl?: string;
  imageBase64?: string;
  /** Who sent it */
  sender: {
    id: string;           // Platform user ID
    name?: string;        // Display name
    pictureUrl?: string;  // Avatar
  };
  /** Where it came from */
  source: {
    id: string;           // Group ID or User ID for DM
    type: SourceType;     // 'dm' or 'group'
    name?: string;        // Group name
  };
  /** Mentioned users (for group activation) */
  mentions?: string[];
  /** Reply token (LINE) */
  replyToken?: string;
  /** Quoted/replied message (for context like EX:expense_id) */
  quotedMessage?: {
    id: string;
    text?: string;
  };
  /** Timestamp */
  timestamp: Date;
}

/**
 * Outbound response to send
 */
export interface OutboundResponse {
  /** Text to send */
  text: string;
  /** Optional image URL */
  imageUrl?: string;
  /** Quick replies (platform-dependent) */
  quickReplies?: Array<{ label: string; text: string }>;
}

/**
 * Context passed to agent
 * This is what tools receive for API calls
 */
export interface AgentContext {
  channel: Channel;
  senderChannelId: string;
  sourceChannelId: string;
  isGroup: boolean;
  senderName?: string;
  sourceName?: string;
  // User preferences (loaded at start)
  userLanguage?: 'th' | 'en';
  userTimezone?: string;
}

// ===========================================
// Session Management
// ===========================================

/**
 * Session key format: `channel:sourceId`
 * Examples:
 *   - LINE:U1234567890 (LINE DM)
 *   - LINE:C1234567890 (LINE Group)
 *   - WHATSAPP:6281234567890 (WhatsApp DM)
 *   - WHATSAPP:120363403215116621@g.us (WhatsApp Group)
 */
export function makeSessionKey(channel: Channel, sourceId: string): string {
  return `${channel}:${sourceId}`;
}

export function parseSessionKey(key: string): { channel: Channel; sourceId: string } | null {
  const [channel, ...rest] = key.split(':');
  if (!channel || rest.length === 0) return null;
  return {
    channel: channel as Channel,
    sourceId: rest.join(':'), // Handle sourceIds with colons
  };
}

// ===========================================
// Group Activation
// ===========================================

export type ActivationMode = 'mention' | 'always';

/**
 * Check if agent should respond in group
 */
export function shouldActivate(
  message: InboundMessage,
  mode: ActivationMode,
  mentionPatterns: string[] = []
): boolean {
  // DMs always activate
  if (message.source.type === 'dm') return true;

  // Groups: check activation mode
  if (mode === 'always') return true;

  // Check mentions
  if (message.mentions && message.mentions.length > 0) {
    return true; // Platform detected mention
  }

  // Check text for mention patterns
  if (message.text && mentionPatterns.length > 0) {
    const text = message.text.toLowerCase();
    return mentionPatterns.some((pattern) => {
      const regex = new RegExp(pattern, 'i');
      return regex.test(text);
    });
  }

  return false;
}

// ===========================================
// Gateway Config
// ===========================================

export interface GatewayConfig {
  /** LINE Messaging API */
  line?: {
    channelAccessToken: string;
    channelSecret: string;
    /** Directory to store uploaded images */
    uploadsDir?: string;
    /** Base URL for serving images (e.g., https://billog.example.com) */
    baseUrl?: string;
  };

  /** WhatsApp via Baileys */
  whatsapp?: {
    sessionPath?: string; // Default: ./data/whatsapp
  };

  /** Telegram Bot API */
  telegram?: {
    botToken: string;
  };

  /** Group activation settings */
  groupActivation?: {
    mode: ActivationMode;
    mentionPatterns: string[]; // e.g., ['@billog', 'billog']
  };

  /** Billog API URL */
  billogApiUrl: string;
}

// ===========================================
// Adapter Interface
// ===========================================

export interface ChannelAdapter {
  readonly channel: Channel;

  /** Initialize (connect, authenticate) */
  initialize(): Promise<void>;

  /** Verify webhook signature */
  verifySignature?(body: string | Buffer, signature: string): boolean;

  /** Parse webhook into messages */
  parseWebhook(payload: unknown): Promise<InboundMessage[]>;

  /** Send response */
  send(sourceId: string, response: OutboundResponse, replyToken?: string): Promise<void>;

  /** Cleanup */
  shutdown?(): Promise<void>;
}
