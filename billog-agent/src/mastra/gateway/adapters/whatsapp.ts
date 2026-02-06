/**
 * WhatsApp Adapter via Baileys
 *
 * Maintains a persistent WhatsApp Web connection.
 * Messages are received via socket events, not webhooks.
 */

import { EventEmitter } from 'events';
import type { ChannelAdapter, InboundMessage, OutboundResponse } from '../types.js';

// ===========================================
// Types for Baileys (minimal, use 'any' for flexibility)
// ===========================================

interface BaileysMessage {
  key: {
    remoteJid?: string;
    fromMe?: boolean;
    id?: string;
    participant?: string;
  };
  message?: {
    conversation?: string;
    extendedTextMessage?: {
      text?: string;
      contextInfo?: {
        mentionedJid?: string[];
      };
    };
    imageMessage?: {
      url?: string;
      caption?: string;
    };
  };
  pushName?: string;
  messageTimestamp?: number;
}

type MessageHandler = (message: InboundMessage) => Promise<void>;

// ===========================================
// WhatsApp Adapter
// ===========================================

export class WhatsAppAdapter extends EventEmitter implements ChannelAdapter {
  readonly channel = 'WHATSAPP' as const;

  private sock: any = null;
  private sessionPath: string;
  private messageHandler: MessageHandler | null = null;
  private botJid: string | null = null;

  constructor(config: { sessionPath?: string } = {}) {
    super();
    this.sessionPath = config.sessionPath || './data/whatsapp';
  }

  /**
   * Set message handler (called when message received)
   */
  onMessage(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  /**
   * Initialize WhatsApp connection
   */
  async initialize(): Promise<void> {
    // Dynamic import Baileys (it's optional)
    let baileys;
    try {
      baileys = await import('@whiskeysockets/baileys');
    } catch {
      console.log('⚠️ WhatsApp: baileys not installed, skipping WhatsApp adapter');
      return;
    }

    const {
      makeWASocket,
      DisconnectReason,
      useMultiFileAuthState,
      fetchLatestBaileysVersion,
    } = baileys;

    const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
    const { version } = await fetchLatestBaileysVersion();

    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      // Reduce noise
      logger: {
        level: 'silent',
        child: () => ({ level: 'silent' }),
        trace: () => {},
        debug: () => {},
        info: () => {},
        warn: console.warn,
        error: console.error,
        fatal: console.error,
      } as any,
    });

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle connection updates
    this.sock.ev.on('connection.update', (update: any) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        console.log('📱 WhatsApp: Scan QR code to connect');
      }

      if (connection === 'close') {
        const shouldReconnect =
          lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          console.log('WhatsApp: Reconnecting...');
          this.initialize();
        } else {
          console.log('WhatsApp: Logged out');
        }
      }

      if (connection === 'open') {
        this.botJid = this.sock?.user?.id || null;
        console.log(`✓ WhatsApp adapter connected: ${this.sock?.user?.name || 'Unknown'}`);
      }
    });

    // Handle incoming messages
    this.sock.ev.on('messages.upsert', async (m: any) => {
      for (const msg of m.messages) {
        // Skip our own messages
        if (msg.key.fromMe) continue;

        // Parse and forward to handler
        const inbound = this.parseMessage(msg);
        if (inbound && this.messageHandler) {
          try {
            await this.messageHandler(inbound);
          } catch (error) {
            console.error('WhatsApp message handler error:', error);
          }
        }
      }
    });
  }

  /**
   * Parse webhook is not used for WhatsApp (uses socket events)
   */
  async parseWebhook(_payload: unknown): Promise<InboundMessage[]> {
    // WhatsApp doesn't use webhooks, messages come via socket events
    return [];
  }

  /**
   * Send response via WhatsApp
   */
  async send(
    sourceId: string,
    response: OutboundResponse,
    _replyToken?: string
  ): Promise<void> {
    if (!this.sock) {
      throw new Error('WhatsApp not connected');
    }

    // Send text message
    if (response.text) {
      await this.sock.sendMessage(sourceId, { text: response.text });
    }

    // Send image if provided
    if (response.imageUrl) {
      await this.sock.sendMessage(sourceId, {
        image: { url: response.imageUrl },
        caption: response.text ? undefined : 'Image', // Only add caption if no text sent
      });
    }
  }

  /**
   * Shutdown connection
   */
  async shutdown(): Promise<void> {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
    }
  }

  // ===========================================
  // Private helpers
  // ===========================================

  private parseMessage(msg: BaileysMessage): InboundMessage | null {
    const jid = msg.key.remoteJid;
    if (!jid) return null;

    // Extract text
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      msg.message?.imageMessage?.caption;

    // Determine source type
    const isGroup = jid.endsWith('@g.us');
    const sourceType = isGroup ? 'group' : 'dm';

    // Get sender ID
    const senderId = isGroup
      ? msg.key.participant || 'unknown'
      : jid.split('@')[0];

    // Extract mentions
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    // Check if bot is mentioned
    const botMentioned = this.botJid ? mentions.includes(this.botJid) : false;

    return {
      id: msg.key.id || `wa-${Date.now()}`,
      channel: 'WHATSAPP',
      text,
      sender: {
        id: senderId,
        name: msg.pushName,
      },
      source: {
        id: jid,
        type: sourceType,
      },
      mentions: botMentioned ? [this.botJid!] : mentions,
      timestamp: new Date((msg.messageTimestamp || Date.now()) * 1000),
    };
  }

  /**
   * Get JID from phone number
   */
  formatJid(phoneNumber: string): string {
    // Remove + and any non-digits
    const cleaned = phoneNumber.replace(/\D/g, '');
    return `${cleaned}@s.whatsapp.net`;
  }

  /**
   * Check if connected
   */
  get connected(): boolean {
    return this.sock !== null;
  }
}
