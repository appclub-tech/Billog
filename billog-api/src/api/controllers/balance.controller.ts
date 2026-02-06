import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { BalanceService } from '../../services/ledger/balance.service.js';
import { SourceService } from '../../services/source/source.service.js';
import { MemberService } from '../../services/source/member.service.js';
import { AuthGuard } from '../guards/auth.guard.js';
import { currencyToLedger } from '../../services/ledger/constants.js';
import { Channel } from '@prisma/client';

@Controller('balances')
export class BalanceController {
  private readonly logger = new Logger(BalanceController.name);

  constructor(
    private balanceService: BalanceService,
    private sourceService: SourceService,
    private memberService: MemberService,
  ) {}

  /**
   * Get balances for a source (by sourceId)
   */
  @Get(':sourceId')
  @UseGuards(AuthGuard)
  async getBalancesBySourceId(
    @Param('sourceId') sourceId: string,
    @Query('currency') currency?: string,
  ) {
    const ledger = currencyToLedger(currency || 'THB');

    // Get optimized debts (who owes whom)
    const debts = await this.balanceService.getDebts(sourceId, ledger);

    // Get all member balances
    const balances = await this.balanceService.getGroupBalances(sourceId, ledger);

    // Get member details
    const members = await this.memberService.getActiveMembers(sourceId);
    const memberDetails = members.map((m) => {
      const balance = balances.get(m.userId);
      return {
        userId: m.userId,
        name: (m as any).user?.name || m.nickname,
        nickname: m.nickname,
        net: balance?.net.toNumber() || 0,
      };
    });

    return {
      balances: debts.map((d) => ({
        from: d.from,
        to: d.to,
        amount: d.amount.toNumber(),
        currency: currency || 'THB',
      })),
      members: memberDetails,
    };
  }

  /**
   * Get balances by channel context (for skill calls)
   */
  @Get()
  @UseGuards(AuthGuard)
  async getBalances(
    @Query('channel') channel: string,
    @Query('sourceChannelId') sourceChannelId: string,
    @Query('currency') currency?: string,
  ) {
    if (!channel || !sourceChannelId) {
      return { error: 'channel and sourceChannelId are required' };
    }

    const source = await this.sourceService.findByChannel(
      channel as Channel,
      sourceChannelId,
    );

    if (!source) {
      return { balances: [], members: [] };
    }

    return this.getBalancesBySourceId(source.id, currency);
  }

  /**
   * Get balance for a specific user
   */
  @Get(':sourceId/user/:userId')
  @UseGuards(AuthGuard)
  async getUserBalance(
    @Param('sourceId') sourceId: string,
    @Param('userId') userId: string,
    @Query('currency') currency?: string,
  ) {
    const ledger = currencyToLedger(currency || 'THB');
    const balance = await this.balanceService.getUserBalance(userId, sourceId, ledger);

    return {
      userId: balance.userId,
      name: balance.userName,
      asset: balance.asset.toNumber(),
      liability: balance.liability.toNumber(),
      net: balance.net.toNumber(),
      currency: currency || 'THB',
    };
  }
}
