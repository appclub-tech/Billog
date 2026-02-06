import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Channel } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountService } from './account.service.js';
import { TransferService, CreateTransferParams } from './transfer.service.js';
import { MemberService } from '../source/member.service.js';
import {
  LedgerCode,
  currencyToLedger,
  ACCOUNT_CODE,
  TRANSFER_CODE,
} from './constants.js';

export type SplitType = 'equal' | 'exact' | 'percentage' | 'item';

export interface SplitTarget {
  target: string; // '@all' | '@nickname' | channelId | userId
  amount?: number; // For exact splits
  percentage?: number; // For percentage splits
}

export interface ItemSplit {
  name: string;
  quantity: number;
  unitPrice: number;
  assignedTo?: string; // '@nickname' | channelId | userId
  ingredientType?: string;
}

export interface CalculatedSplit {
  userId: string;
  amount: Decimal;
}

export interface SplitResult {
  splits: CalculatedSplit[];
  transfers: Awaited<ReturnType<TransferService['createLinkedTransfers']>>;
}

@Injectable()
export class SplitService {
  private readonly logger = new Logger(SplitService.name);

  constructor(
    private prisma: PrismaService,
    private accountService: AccountService,
    private transferService: TransferService,
    private memberService: MemberService,
  ) {}

  /**
   * Calculate splits based on split type and targets
   */
  async calculateSplits(
    sourceId: string,
    channel: Channel,
    amount: number,
    splitType: SplitType,
    paidByUserId: string,
    splits?: SplitTarget[],
    items?: ItemSplit[],
  ): Promise<Map<string, Decimal>> {
    const result = new Map<string, Decimal>();

    switch (splitType) {
      case 'equal': {
        // Resolve all targets to user IDs
        const userIds = new Set<string>();

        if (!splits || splits.length === 0) {
          // Default to @all
          const members = await this.memberService.getActiveMembers(sourceId);
          for (const member of members) {
            userIds.add(member.userId);
          }
        } else {
          for (const split of splits) {
            const resolved = await this.memberService.resolveTarget(
              sourceId,
              channel,
              split.target,
            );
            for (const userId of resolved) {
              userIds.add(userId);
            }
          }
        }

        // Calculate equal split amount
        const splitCount = userIds.size;
        if (splitCount === 0) {
          throw new Error('No valid split targets found');
        }

        const perPerson = new Decimal(amount).dividedBy(splitCount);

        // Exclude payer from owing themselves
        for (const userId of userIds) {
          if (userId !== paidByUserId) {
            result.set(userId, perPerson);
          }
        }
        break;
      }

      case 'exact': {
        if (!splits) {
          throw new Error('Exact splits require split targets with amounts');
        }

        for (const split of splits) {
          if (split.amount === undefined) {
            throw new Error(`Missing amount for target: ${split.target}`);
          }

          const userIds = await this.memberService.resolveTarget(
            sourceId,
            channel,
            split.target,
          );

          for (const userId of userIds) {
            if (userId !== paidByUserId) {
              const existing = result.get(userId) || new Decimal(0);
              result.set(userId, existing.plus(split.amount));
            }
          }
        }
        break;
      }

      case 'percentage': {
        if (!splits) {
          throw new Error('Percentage splits require split targets with percentages');
        }

        for (const split of splits) {
          if (split.percentage === undefined) {
            throw new Error(`Missing percentage for target: ${split.target}`);
          }

          const userIds = await this.memberService.resolveTarget(
            sourceId,
            channel,
            split.target,
          );

          const splitAmount = new Decimal(amount)
            .times(split.percentage)
            .dividedBy(100);

          for (const userId of userIds) {
            if (userId !== paidByUserId) {
              const existing = result.get(userId) || new Decimal(0);
              result.set(userId, existing.plus(splitAmount));
            }
          }
        }
        break;
      }

      case 'item': {
        if (!items) {
          throw new Error('Item splits require items array');
        }

        // Group items by assigned user
        const itemsByUser = new Map<string, number>();

        for (const item of items) {
          const itemTotal = item.unitPrice * item.quantity;

          if (item.assignedTo) {
            const userIds = await this.memberService.resolveTarget(
              sourceId,
              channel,
              item.assignedTo,
            );

            // Split item cost among assigned users
            const perUser = itemTotal / userIds.length;
            for (const userId of userIds) {
              const existing = itemsByUser.get(userId) || 0;
              itemsByUser.set(userId, existing + perUser);
            }
          } else {
            // Unassigned items go to payer
            const existing = itemsByUser.get(paidByUserId) || 0;
            itemsByUser.set(paidByUserId, existing + itemTotal);
          }
        }

        // Convert to splits (excluding payer)
        for (const [userId, itemAmount] of itemsByUser) {
          if (userId !== paidByUserId) {
            result.set(userId, new Decimal(itemAmount));
          }
        }
        break;
      }
    }

    return result;
  }

  /**
   * Create expense splits and ledger transfers
   */
  async createExpenseSplitTransfers(
    expenseId: string,
    sourceId: string,
    paidByUserId: string,
    splits: Map<string, Decimal>,
    currency: string,
  ): Promise<SplitResult> {
    const ledger = currencyToLedger(currency);

    // Ensure payer has accounts
    await this.accountService.getOrCreateUserAccounts(
      paidByUserId,
      sourceId,
      ledger,
    );

    const transferParams: CreateTransferParams[] = [];
    const calculatedSplits: CalculatedSplit[] = [];

    for (const [userId, amount] of splits) {
      if (amount.isZero()) continue;

      // Ensure user has accounts
      const { liability: debtorLiability } =
        await this.accountService.getOrCreateUserAccounts(userId, sourceId, ledger);

      const { asset: creditorAsset } =
        await this.accountService.getOrCreateUserAccounts(
          paidByUserId,
          sourceId,
          ledger,
        );

      transferParams.push({
        debitAccountId: debtorLiability.id, // Debtor's liability increases
        creditAccountId: creditorAsset.id, // Creditor's asset increases
        amount,
        ledger,
        code: TRANSFER_CODE.EXPENSE_SPLIT,
        expenseId,
      });

      calculatedSplits.push({ userId, amount });
    }

    // Create all transfers atomically
    const transfers = await this.transferService.createLinkedTransfers(
      transferParams,
    );

    this.logger.log(
      `Created ${transfers.length} split transfers for expense ${expenseId}`,
    );

    return { splits: calculatedSplits, transfers };
  }

  /**
   * Create settlement transfer (payment between users)
   */
  async createSettlementTransfer(
    sourceId: string,
    fromUserId: string,
    toUserId: string,
    amount: number,
    currency: string,
    paymentMethod?: number,
  ) {
    const ledger = currencyToLedger(currency);

    // Get or create accounts for both users
    const { liability: fromLiability } =
      await this.accountService.getOrCreateUserAccounts(fromUserId, sourceId, ledger);
    const { asset: toAsset } =
      await this.accountService.getOrCreateUserAccounts(toUserId, sourceId, ledger);

    // Settlement: reduce debtor's liability, reduce creditor's asset
    const transfer = await this.transferService.createTransfer({
      debitAccountId: toAsset.id, // Creditor's asset decreases (they received payment)
      creditAccountId: fromLiability.id, // Debtor's liability decreases (they paid)
      amount: new Decimal(amount),
      ledger,
      code: TRANSFER_CODE.SETTLEMENT,
      userData32: paymentMethod,
    });

    this.logger.log(
      `Created settlement transfer: ${fromUserId} paid ${amount} ${currency} to ${toUserId}`,
    );

    return transfer;
  }

  /**
   * Create adjustment transfer (for reconciliation)
   * Used when modifying existing expense splits
   */
  async createAdjustmentTransfer(
    expenseId: string,
    sourceId: string,
    userId: string,
    paidByUserId: string,
    amount: Decimal,
    currency: string,
    direction: 'increase' | 'decrease',
    reason?: string,
  ) {
    if (amount.isZero()) return null;

    const ledger = currencyToLedger(currency);

    // Get accounts
    const { liability: userLiability } =
      await this.accountService.getOrCreateUserAccounts(userId, sourceId, ledger);
    const { asset: payerAsset } =
      await this.accountService.getOrCreateUserAccounts(paidByUserId, sourceId, ledger);

    let debitAccountId: string;
    let creditAccountId: string;

    if (direction === 'increase') {
      // User owes more: increase liability, increase payer's asset
      debitAccountId = userLiability.id;
      creditAccountId = payerAsset.id;
    } else {
      // User owes less: decrease liability, decrease payer's asset
      debitAccountId = payerAsset.id;
      creditAccountId = userLiability.id;
    }

    const transfer = await this.transferService.createTransfer({
      debitAccountId,
      creditAccountId,
      amount,
      ledger,
      code: TRANSFER_CODE.ADJUSTMENT,
      expenseId,
    });

    this.logger.log(
      `Created adjustment transfer: ${userId} ${direction} by ${amount} ${currency} (${reason || 'reconciliation'})`,
    );

    return transfer;
  }
}
