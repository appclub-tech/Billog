import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime/library';
import {
  AccountCode,
  LedgerCode,
  ACCOUNT_FLAGS,
  formatUserData128,
  getNanoTimestamp,
  ACCOUNT_CODE,
} from './constants.js';

export interface CreateAccountParams {
  ledger: LedgerCode;
  code: AccountCode;
  userId: string;
  sourceId: string;
  flags?: number;
  userData64?: bigint;
  userData32?: number;
}

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a new account - TigerBeetle compatible with Billog relations
   */
  async createAccount(params: CreateAccountParams) {
    // Keep user_data_128 for legacy compatibility
    const userData128 = formatUserData128(params.userId, params.sourceId);

    return this.prisma.account.create({
      data: {
        ledger: params.ledger,
        code: params.code,
        // Explicit FK relations
        userId: params.userId,
        sourceId: params.sourceId,
        // Legacy/compatibility field
        user_data_128: userData128,
        user_data_64: params.userData64,
        user_data_32: params.userData32,
        flags: params.flags ?? ACCOUNT_FLAGS.NONE,
        timestamp: getNanoTimestamp(),
      },
    });
  }

  /**
   * Get or create an account - ensures idempotent account creation
   * Uses upsert with retry to prevent race condition duplicates
   */
  async getOrCreateAccount(params: CreateAccountParams) {
    const userData128 = formatUserData128(params.userId, params.sourceId);

    try {
      return await this.prisma.account.upsert({
        where: {
          ledger_userId_sourceId_code: {
            ledger: params.ledger,
            userId: params.userId,
            sourceId: params.sourceId,
            code: params.code,
          },
        },
        update: {}, // No updates needed, just return existing
        create: {
          ledger: params.ledger,
          code: params.code,
          userId: params.userId,
          sourceId: params.sourceId,
          user_data_128: userData128,
          user_data_64: params.userData64,
          user_data_32: params.userData32,
          flags: params.flags ?? ACCOUNT_FLAGS.NONE,
          timestamp: getNanoTimestamp(),
        },
      });
    } catch (error) {
      // If upsert fails due to race condition, find the existing account
      const existing = await this.prisma.account.findFirst({
        where: {
          ledger: params.ledger,
          userId: params.userId,
          sourceId: params.sourceId,
          code: params.code,
        },
      });

      if (existing) {
        this.logger.log(`Found existing account after upsert conflict: ${existing.id}`);
        return existing;
      }

      // Re-throw if it wasn't a duplicate error
      throw error;
    }
  }

  /**
   * Get or create asset and liability accounts for a user in a source
   */
  async getOrCreateUserAccounts(userId: string, sourceId: string, ledger: LedgerCode) {
    const [asset, liability] = await Promise.all([
      this.getOrCreateAccount({
        ledger,
        code: ACCOUNT_CODE.ASSET,
        userId,
        sourceId,
      }),
      this.getOrCreateAccount({
        ledger,
        code: ACCOUNT_CODE.LIABILITY,
        userId,
        sourceId,
      }),
    ]);

    return { asset, liability };
  }

  /**
   * Lookup accounts by IDs - TigerBeetle compatible
   */
  async lookupAccounts(ids: string[]) {
    return this.prisma.account.findMany({
      where: { id: { in: ids } },
    });
  }

  /**
   * Get account by ID
   */
  async getAccount(id: string) {
    return this.prisma.account.findUnique({
      where: { id },
    });
  }

  /**
   * Get account by user and source
   */
  async getAccountByUserData(
    ledger: LedgerCode,
    userId: string,
    sourceId: string,
    code: AccountCode,
  ) {
    return this.prisma.account.findUnique({
      where: {
        ledger_userId_sourceId_code: {
          ledger,
          userId,
          sourceId,
          code,
        },
      },
    });
  }

  /**
   * Get all accounts for a user in a source
   */
  async getUserAccounts(userId: string, sourceId: string, ledger?: LedgerCode) {
    return this.prisma.account.findMany({
      where: {
        userId,
        sourceId,
        ...(ledger !== undefined && { ledger }),
      },
    });
  }

  /**
   * Get all accounts in a source
   */
  async getSourceAccounts(sourceId: string, ledger?: LedgerCode) {
    return this.prisma.account.findMany({
      where: {
        sourceId,
        ...(ledger !== undefined && { ledger }),
      },
    });
  }

  /**
   * Get all accounts for a user across all sources
   */
  async getAllUserAccounts(userId: string, ledger?: LedgerCode) {
    return this.prisma.account.findMany({
      where: {
        userId,
        ...(ledger !== undefined && { ledger }),
      },
      include: {
        source: true,
      },
    });
  }

  /**
   * Calculate balance for an account
   * ASSET: balance = credits_posted - debits_posted (positive = money owed TO user)
   * LIABILITY: balance = debits_posted - credits_posted (positive = money user OWES)
   */
  getAccountBalance(
    account: { credits_posted: Decimal; debits_posted: Decimal },
    code: AccountCode,
  ): Decimal {
    if (code === ACCOUNT_CODE.ASSET) {
      return account.credits_posted.minus(account.debits_posted);
    } else if (code === ACCOUNT_CODE.LIABILITY) {
      return account.debits_posted.minus(account.credits_posted);
    }
    // For other account types, return net
    return account.credits_posted.minus(account.debits_posted);
  }

  /**
   * Update account balances (internal use by TransferService)
   */
  async updateBalances(
    accountId: string,
    debitAmount: Decimal,
    creditAmount: Decimal,
    pending = false,
  ) {
    if (pending) {
      return this.prisma.account.update({
        where: { id: accountId },
        data: {
          debits_pending: { increment: debitAmount },
          credits_pending: { increment: creditAmount },
        },
      });
    }

    return this.prisma.account.update({
      where: { id: accountId },
      data: {
        debits_posted: { increment: debitAmount },
        credits_posted: { increment: creditAmount },
      },
    });
  }
}
