import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Channel, Source, SourceType, Prisma } from '@prisma/client';

@Injectable()
export class SourceService {
  private readonly logger = new Logger(SourceService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Get or create a source (conversation context)
   */
  async getOrCreateSource(
    channel: Channel,
    channelId: string,
    type: SourceType = 'GROUP',
    name?: string,
  ): Promise<Source> {
    const existing = await this.prisma.source.findUnique({
      where: {
        channel_channelId: { channel, channelId },
      },
    });

    if (existing) {
      // Update name if provided and different
      if (name && existing.name !== name) {
        return this.prisma.source.update({
          where: { id: existing.id },
          data: { name },
        });
      }
      return existing;
    }

    const source = await this.prisma.source.create({
      data: {
        channel,
        channelId,
        type,
        name: name || `${channel} ${type}`,
      },
    });

    this.logger.log(
      `Created new source ${source.id} for ${channel}:${channelId}`,
    );

    return source;
  }

  /**
   * Find source by channel and channelId
   */
  async findByChannel(
    channel: Channel,
    channelId: string,
  ): Promise<Source | null> {
    return this.prisma.source.findUnique({
      where: {
        channel_channelId: { channel, channelId },
      },
    });
  }

  /**
   * Get source by ID
   */
  async getSourceById(sourceId: string): Promise<Source | null> {
    return this.prisma.source.findUnique({
      where: { id: sourceId },
    });
  }

  /**
   * Get source with members
   */
  async getSourceWithMembers(sourceId: string) {
    return this.prisma.source.findUnique({
      where: { id: sourceId },
      include: {
        members: {
          where: { isActive: true },
          include: {
            user: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });
  }

  /**
   * Update source metadata
   */
  async updateSource(
    sourceId: string,
    data: { name?: string; description?: string; metadata?: Prisma.InputJsonValue },
  ) {
    return this.prisma.source.update({
      where: { id: sourceId },
      data,
    });
  }

  /**
   * Get all sources for a user
   */
  async getUserSources(userId: string) {
    const memberships = await this.prisma.sourceMember.findMany({
      where: { userId, isActive: true },
      include: {
        source: true,
      },
    });

    return memberships.map((m) => m.source);
  }
}
