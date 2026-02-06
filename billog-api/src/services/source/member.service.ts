import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Channel, MemberRole, SourceMember, User } from '@prisma/client';
import { IdentityService } from '../user/identity.service.js';
import { AccountService } from '../ledger/account.service.js';
import { LEDGER, LedgerCode } from '../ledger/constants.js';

export interface SyncMemberInput {
  channelId: string;
  displayName?: string;
  isActive?: boolean;
}

export interface SyncResult {
  added: number;
  updated: number;
  deactivated: number;
  members: SourceMember[];
}

@Injectable()
export class MemberService {
  private readonly logger = new Logger(MemberService.name);

  constructor(
    private prisma: PrismaService,
    private identityService: IdentityService,
    @Inject(forwardRef(() => AccountService))
    private accountService: AccountService,
  ) {}

  /**
   * Add or update a member in a source
   */
  async addMember(
    sourceId: string,
    channel: Channel,
    channelId: string,
    displayName?: string,
    role: MemberRole = 'MEMBER',
  ): Promise<{ member: SourceMember; user: User; isNew: boolean }> {
    // Resolve identity to user
    const { user, isNew: isNewUser } = await this.identityService.resolveIdentity(
      channel,
      channelId,
      displayName,
    );

    // Check if member already exists
    const existingMember = await this.prisma.sourceMember.findUnique({
      where: {
        sourceId_userId: { sourceId, userId: user.id },
      },
    });

    if (existingMember) {
      // Update if needed
      const updates: Partial<SourceMember> = {};
      if (displayName && existingMember.nickname !== displayName) {
        updates.nickname = displayName;
      }
      if (!existingMember.isActive) {
        updates.isActive = true;
        updates.leftAt = null;
      }

      if (Object.keys(updates).length > 0) {
        const updated = await this.prisma.sourceMember.update({
          where: { id: existingMember.id },
          data: updates,
        });
        return { member: updated, user, isNew: false };
      }

      return { member: existingMember, user, isNew: false };
    }

    // Create new member
    const member = await this.prisma.sourceMember.create({
      data: {
        sourceId,
        userId: user.id,
        nickname: displayName,
        role,
      },
    });

    this.logger.log(`Added member ${user.id} to source ${sourceId}`);

    // Create ledger accounts for the new member (THB by default)
    // This ensures money flow infrastructure is ready from first interaction
    await this.accountService.getOrCreateUserAccounts(user.id, sourceId, LEDGER.THB);
    this.logger.log(`Created ledger accounts for member ${user.id} in source ${sourceId}`);

    return { member, user, isNew: true };
  }

  /**
   * Resolve a nickname to a userId within a source
   */
  async resolveNickname(
    sourceId: string,
    nickname: string,
  ): Promise<string | null> {
    // Case-insensitive nickname match
    const member = await this.prisma.sourceMember.findFirst({
      where: {
        sourceId,
        isActive: true,
        OR: [
          { nickname: { equals: nickname, mode: 'insensitive' } },
          { user: { name: { equals: nickname, mode: 'insensitive' } } },
        ],
      },
      select: { userId: true },
    });

    return member?.userId ?? null;
  }

  /**
   * Resolve @target to user IDs
   * Handles: @all, @nickname, channelId
   */
  async resolveTarget(
    sourceId: string,
    channel: Channel,
    target: string,
  ): Promise<string[]> {
    // Handle @all
    if (target.toLowerCase() === '@all' || target.toLowerCase() === 'all') {
      const members = await this.getActiveMembers(sourceId);
      return members.map((m) => m.userId);
    }

    // Handle @nickname (strip @ prefix)
    const nickname = target.startsWith('@') ? target.slice(1) : target;

    // Try to resolve as nickname first
    const userId = await this.resolveNickname(sourceId, nickname);
    if (userId) {
      return [userId];
    }

    // Try to resolve as channelId
    const user = await this.identityService.findUserByIdentity(channel, target);
    if (user) {
      return [user.id];
    }

    this.logger.warn(`Could not resolve target: ${target} in source ${sourceId}`);
    return [];
  }

  /**
   * Get all active members in a source
   */
  async getActiveMembers(sourceId: string): Promise<SourceMember[]> {
    return this.prisma.sourceMember.findMany({
      where: { sourceId, isActive: true },
      include: {
        user: {
          select: { id: true, name: true },
        },
      },
    });
  }

  /**
   * Get member by user and source
   */
  async getMember(
    sourceId: string,
    userId: string,
  ): Promise<SourceMember | null> {
    return this.prisma.sourceMember.findUnique({
      where: {
        sourceId_userId: { sourceId, userId },
      },
    });
  }

  /**
   * Sync members from OpenClaw (e.g., WhatsApp group members)
   */
  async syncMembers(
    sourceId: string,
    channel: Channel,
    members: SyncMemberInput[],
  ): Promise<SyncResult> {
    let added = 0;
    let updated = 0;
    let deactivated = 0;
    const resultMembers: SourceMember[] = [];

    // Get current member channelIds
    const currentMembers = await this.prisma.sourceMember.findMany({
      where: { sourceId },
      include: {
        user: {
          include: { identities: true },
        },
      },
    });

    const currentChannelIds = new Set<string>();
    const userIdByChannelId = new Map<string, string>();

    for (const member of currentMembers) {
      for (const identity of member.user.identities) {
        if (identity.channel === channel) {
          currentChannelIds.add(identity.channelId);
          userIdByChannelId.set(identity.channelId, member.userId);
        }
      }
    }

    // Add/update members
    for (const input of members) {
      const { member, isNew } = await this.addMember(
        sourceId,
        channel,
        input.channelId,
        input.displayName,
      );

      resultMembers.push(member);

      if (isNew) {
        added++;
      } else {
        updated++;
      }
    }

    // Deactivate members not in the new list
    const newChannelIds = new Set(members.map((m) => m.channelId));
    for (const channelId of currentChannelIds) {
      if (!newChannelIds.has(channelId)) {
        const userId = userIdByChannelId.get(channelId);
        if (userId) {
          await this.prisma.sourceMember.update({
            where: {
              sourceId_userId: { sourceId, userId },
            },
            data: {
              isActive: false,
              leftAt: new Date(),
            },
          });
          deactivated++;
        }
      }
    }

    this.logger.log(
      `Synced members for source ${sourceId}: added=${added}, updated=${updated}, deactivated=${deactivated}`,
    );

    return { added, updated, deactivated, members: resultMembers };
  }

  /**
   * Deactivate a member
   */
  async deactivateMember(sourceId: string, userId: string): Promise<void> {
    await this.prisma.sourceMember.update({
      where: {
        sourceId_userId: { sourceId, userId },
      },
      data: {
        isActive: false,
        leftAt: new Date(),
      },
    });
  }

  /**
   * Update member nickname
   */
  async updateNickname(
    sourceId: string,
    userId: string,
    nickname: string,
  ): Promise<SourceMember> {
    return this.prisma.sourceMember.update({
      where: {
        sourceId_userId: { sourceId, userId },
      },
      data: { nickname },
    });
  }
}
