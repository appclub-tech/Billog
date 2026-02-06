import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { SourceService } from '../../services/source/source.service.js';
import { MemberService } from '../../services/source/member.service.js';
import { AccountService } from '../../services/ledger/account.service.js';
import { AuthGuard, GetUser, JwtPayload } from '../guards/auth.guard.js';
import { SyncMembersDto } from '../dto/sync-members.dto.js';
import { InitSourceDto } from '../dto/init-source.dto.js';
import { LEDGER, currencyToLedger } from '../../services/ledger/constants.js';
import { Channel } from '@prisma/client';

@Controller('sources')
export class SourceController {
  private readonly logger = new Logger(SourceController.name);

  constructor(
    private sourceService: SourceService,
    private memberService: MemberService,
    private accountService: AccountService,
  ) {}

  /**
   * Initialize a source - creates source, user, membership, and accounts
   * This should be called before any transactions to ensure proper money flow
   */
  @Post('init')
  @UseGuards(AuthGuard)
  async initSource(@Body() dto: InitSourceDto) {
    const requestId = Math.random().toString(36).slice(2, 10);
    this.logger.log(`[${requestId}] Initializing source for ${dto.channel}:${dto.sourceChannelId}`);

    // Step 1: Get or create source
    const source = await this.sourceService.getOrCreateSource(
      dto.channel,
      dto.sourceChannelId,
      dto.sourceType || 'GROUP',
      dto.sourceName,
    );
    const isNewSource = !source.createdAt ||
      (Date.now() - source.createdAt.getTime()) < 5000; // Created within last 5 seconds
    this.logger.log(`[${requestId}] Step 1: Source ${isNewSource ? 'created' : 'found'} - ${source.id}`);

    // Step 2: Add sender as member (resolves identity automatically)
    const { member: membership, user, isNew: isNewUser } = await this.memberService.addMember(
      source.id,
      dto.channel,
      dto.senderChannelId,
      dto.senderDisplayName,
      'MEMBER',
    );
    this.logger.log(`[${requestId}] Step 2: User ${isNewUser ? 'created' : 'found'} - ${user.id} (${user.name})`);

    // Step 3: Create ledger accounts for user in this source
    const currency = dto.currency || 'THB';
    const ledger = currencyToLedger(currency);
    const accounts = await this.accountService.getOrCreateUserAccounts(
      user.id,
      source.id,
      ledger,
    );
    this.logger.log(`[${requestId}] Step 3: Accounts ready - asset:${accounts.asset.id}, liability:${accounts.liability.id}`);

    // Step 4: Sync additional members if provided (WhatsApp group scenario)
    let memberCount = 1;
    if (dto.members && dto.members.length > 0) {
      const syncResult = await this.memberService.syncMembers(
        source.id,
        dto.channel,
        dto.members,
      );
      memberCount = syncResult.members.length;
      this.logger.log(`[${requestId}] Step 4: Synced ${memberCount} members (added: ${syncResult.added}, updated: ${syncResult.updated})`);

      // Create accounts for all synced members
      for (const syncedMember of syncResult.members) {
        await this.accountService.getOrCreateUserAccounts(
          syncedMember.userId,
          source.id,
          ledger,
        );
      }
      this.logger.log(`[${requestId}] Step 5: Created accounts for all members`);
    }

    // Get final member count
    const allMembers = await this.memberService.getActiveMembers(source.id);

    this.logger.log(`[${requestId}] ✅ Source initialized - ${source.id} with ${allMembers.length} members`);

    return {
      source: {
        id: source.id,
        name: source.name,
        type: source.type,
        channel: source.channel,
        channelId: source.channelId,
        memberCount: allMembers.length,
      },
      user: {
        id: user.id,
        name: user.name,
        nickname: membership.nickname,
      },
      membership: {
        id: membership.id,
        role: membership.role,
        joinedAt: membership.joinedAt,
      },
      accounts: {
        asset: accounts.asset.id,
        liability: accounts.liability.id,
      },
      isNewSource,
      isNewUser,
    };
  }

  /**
   * Get source by channel and channelId (query params)
   */
  @Get()
  @UseGuards(AuthGuard)
  async getSourceByChannel(
    @Query('channel') channel: string,
    @Query('channelId') channelId: string,
  ) {
    if (!channel || !channelId) {
      return { error: 'channel and channelId are required' };
    }

    const source = await this.sourceService.findByChannel(
      channel as Channel,
      channelId,
    );

    if (!source) {
      return { source: null };
    }

    const members = await this.memberService.getActiveMembers(source.id);

    return {
      source: {
        id: source.id,
        name: source.name,
        type: source.type,
        channel: source.channel,
        channelId: source.channelId,
        memberCount: members.length,
        createdAt: source.createdAt,
      },
    };
  }

  /**
   * Get source by ID
   */
  @Get(':id')
  @UseGuards(AuthGuard)
  async getSource(@Param('id') id: string) {
    const source = await this.sourceService.getSourceWithMembers(id);

    if (!source) {
      return { error: 'Source not found' };
    }

    return {
      source: {
        id: source.id,
        channel: source.channel,
        channelId: source.channelId,
        type: source.type,
        name: source.name,
        members: source.members.map((m) => ({
          userId: m.userId,
          name: (m as any).user?.name,
          nickname: m.nickname,
          role: m.role,
        })),
      },
    };
  }

  /**
   * Sync members for a source (used by WhatsApp to sync group members)
   */
  @Post(':id/sync-members')
  @UseGuards(AuthGuard)
  async syncMembers(
    @Param('id') sourceId: string,
    @Body() dto: SyncMembersDto,
    @GetUser() user: JwtPayload,
  ) {
    this.logger.log(`Syncing ${dto.members.length} members for source ${sourceId}`);

    const channel = dto.channel || user.channel;

    const result = await this.memberService.syncMembers(
      sourceId,
      channel,
      dto.members,
    );

    return {
      members: result.members.map((m) => ({
        userId: m.userId,
        nickname: m.nickname,
        role: m.role,
        isActive: m.isActive,
      })),
      added: result.added,
      updated: result.updated,
      deactivated: result.deactivated,
    };
  }

  /**
   * Get members of a source
   */
  @Get(':id/members')
  @UseGuards(AuthGuard)
  async getMembers(@Param('id') sourceId: string) {
    const members = await this.memberService.getActiveMembers(sourceId);

    return {
      members: members.map((m) => ({
        userId: m.userId,
        name: (m as any).user?.name,
        nickname: m.nickname,
        role: m.role,
      })),
    };
  }

  /**
   * Update member nickname
   */
  @Patch(':sourceId/members/:memberId')
  @UseGuards(AuthGuard)
  async updateMemberNickname(
    @Param('sourceId') sourceId: string,
    @Param('memberId') memberId: string,
    @Body() body: { nickname: string },
  ) {
    // memberId here is actually the userId from the skill's perspective
    const member = await this.memberService.updateNickname(
      sourceId,
      memberId,
      body.nickname,
    );

    return {
      member: {
        id: member.id,
        userId: member.userId,
        nickname: member.nickname,
        role: member.role,
      },
    };
  }
}
