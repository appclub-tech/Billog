import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Channel, User } from '@prisma/client';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(private prisma: PrismaService) {}

  async findByChannelId(channel: Channel, channelId: string): Promise<User | null> {
    const identity = await this.prisma.userIdentity.findFirst({
      where: { channel, channelId },
      include: { user: true },
    });
    return identity?.user || null;
  }

  async findOrCreate(channel: Channel, channelId: string, name?: string): Promise<User> {
    let user = await this.findByChannelId(channel, channelId);

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          name: name || `User ${channelId.substring(0, 8)}`,
          identities: {
            create: {
              channel,
              channelId,
              displayName: name,
            },
          },
        },
      });
      this.logger.log(`Created new user: ${user.id}`);
    }

    return user;
  }

  async getUserById(userId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id: userId },
    });
  }

  async getUserSources(userId: string) {
    return this.prisma.sourceMember.findMany({
      where: { userId, isActive: true },
      include: {
        source: {
          select: { id: true, channel: true, channelId: true, name: true, type: true },
        },
      },
    });
  }

  async updateUser(
    userId: string,
    data: { name?: string; email?: string; timezone?: string; language?: string },
  ) {
    return this.prisma.user.update({
      where: { id: userId },
      data,
    });
  }
}
