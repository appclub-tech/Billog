import {
  Controller,
  Post,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { SourceService } from '../../services/source/source.service.js';
import { IdentityService } from '../../services/user/identity.service.js';
import { SplitService } from '../../services/ledger/split.service.js';
import { BalanceService } from '../../services/ledger/balance.service.js';
import { AuthGuard, GetUser, JwtPayload } from '../guards/auth.guard.js';
import { CreateSettlementDto } from '../dto/create-settlement.dto.js';
import { currencyToLedger } from '../../services/ledger/constants.js';

@Controller('settlements')
export class SettlementController {
  private readonly logger = new Logger(SettlementController.name);

  constructor(
    private sourceService: SourceService,
    private identityService: IdentityService,
    private splitService: SplitService,
    private balanceService: BalanceService,
  ) {}

  /**
   * Record a payment/settlement between users
   */
  @Post()
  @UseGuards(AuthGuard)
  async createSettlement(
    @Body() dto: CreateSettlementDto,
    @GetUser() user: JwtPayload,
  ) {
    this.logger.log(`Creating settlement: ${dto.fromChannelId} -> ${dto.toChannelId} ${dto.amount}`);

    // Use context from JWT if not provided
    const channel = dto.channel || user.channel;
    const sourceChannelId = dto.sourceChannelId || user.sourceChannelId;

    if (!sourceChannelId) {
      return { error: 'sourceChannelId is required' };
    }

    // 1. Get source
    const source = await this.sourceService.findByChannel(channel, sourceChannelId);
    if (!source) {
      return { error: 'Source not found' };
    }

    // 2. Resolve from/to users
    const fromUser = await this.identityService.findUserByIdentity(
      channel,
      dto.fromChannelId,
    );
    if (!fromUser) {
      return { error: 'From user not found' };
    }

    const toUser = await this.identityService.findUserByIdentity(
      channel,
      dto.toChannelId,
    );
    if (!toUser) {
      return { error: 'To user not found' };
    }

    // 3. Create settlement transfer
    const currency = dto.currency || 'THB';
    const transfer = await this.splitService.createSettlementTransfer(
      source.id,
      fromUser.id,
      toUser.id,
      dto.amount,
      currency,
      dto.paymentMethod,
    );

    // 4. Get remaining balance between these users
    const ledger = currencyToLedger(currency);
    const fromBalance = await this.balanceService.getUserBalance(
      fromUser.id,
      source.id,
      ledger,
    );

    return {
      settlement: {
        id: transfer.id,
        amount: dto.amount,
        currency,
        from: { userId: fromUser.id, name: fromUser.name },
        to: { userId: toUser.id, name: toUser.name },
        paymentMethod: dto.paymentMethod,
      },
      remainingBalance: fromBalance.net.toNumber(),
    };
  }
}
