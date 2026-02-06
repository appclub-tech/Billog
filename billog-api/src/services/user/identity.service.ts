import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Channel, User, UserIdentity } from '@prisma/client';

export interface ResolveIdentityResult {
  user: User;
  identity: UserIdentity;
  isNew: boolean;
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Resolve a channel identity to a User, creating both if needed
   */
  async resolveIdentity(
    channel: Channel,
    channelId: string,
    displayName?: string,
  ): Promise<ResolveIdentityResult> {
    // Try to find existing identity
    const existingIdentity = await this.prisma.userIdentity.findUnique({
      where: {
        channel_channelId: { channel, channelId },
      },
      include: { user: true },
    });

    if (existingIdentity) {
      // Update display name if provided and different
      if (displayName && existingIdentity.displayName !== displayName) {
        await this.prisma.userIdentity.update({
          where: { id: existingIdentity.id },
          data: { displayName },
        });
      }

      return {
        user: existingIdentity.user,
        identity: existingIdentity,
        isNew: false,
      };
    }

    // Create new user with identity and default payment method
    const user = await this.prisma.user.create({
      data: {
        name: displayName || `User ${channelId.substring(0, 8)}`,
        identities: {
          create: {
            channel,
            channelId,
            displayName,
          },
        },
        // Auto-create default payment method (Cash)
        paymentMethods: {
          create: {
            name: 'Cash',
            type: 'CASH',
            isDefault: true,
          },
        },
      },
      include: {
        identities: true,
        paymentMethods: true,
      },
    });

    this.logger.log(
      `Created new user ${user.id} for ${channel}:${channelId} with default payment method`,
    );

    return {
      user,
      identity: user.identities[0],
      isNew: true,
    };
  }

  /**
   * Find user by channel identity
   */
  async findUserByIdentity(
    channel: Channel,
    channelId: string,
  ): Promise<User | null> {
    const identity = await this.prisma.userIdentity.findUnique({
      where: {
        channel_channelId: { channel, channelId },
      },
      include: { user: true },
    });

    return identity?.user ?? null;
  }

  /**
   * Find all identities for a user
   */
  async getUserIdentities(userId: string): Promise<UserIdentity[]> {
    return this.prisma.userIdentity.findMany({
      where: { userId },
    });
  }

  /**
   * Link a new channel identity to an existing user (multi-identity support)
   */
  async linkIdentity(
    userId: string,
    channel: Channel,
    channelId: string,
    displayName?: string,
  ): Promise<UserIdentity> {
    // Check if identity already exists
    const existing = await this.prisma.userIdentity.findUnique({
      where: {
        channel_channelId: { channel, channelId },
      },
    });

    if (existing) {
      if (existing.userId === userId) {
        return existing;
      }
      throw new Error(
        `Identity ${channel}:${channelId} is already linked to another user`,
      );
    }

    return this.prisma.userIdentity.create({
      data: {
        userId,
        channel,
        channelId,
        displayName,
      },
    });
  }

  /**
   * Get user by ID with all identities
   */
  async getUserWithIdentities(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      include: { identities: true },
    });
  }
}
