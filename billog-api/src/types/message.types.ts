import { Channel, SourceType } from '@prisma/client';

export interface IncomingMessage {
  channel: Channel;
  senderId: string;
  senderName?: string;
  sourceId: string;
  sourceType: SourceType;
  text?: string;
  imageUrl?: string;
  imageBuffer?: Buffer;
  replyToId?: string;
  metadata?: Record<string, unknown>;
}

export interface OutgoingMessage {
  channel: Channel;
  sourceId: string;
  text: string;
  replyToId?: string;
}

export interface SkillContext {
  channel: Channel;
  senderChannelId: string;
  sourceChannelId?: string;
  sourceType?: SourceType;
  gatewayId: string;
}
