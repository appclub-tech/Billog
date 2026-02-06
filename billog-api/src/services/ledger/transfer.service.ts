import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime/library';
import {
  LedgerCode,
  TransferCode,
  TRANSFER_FLAGS,
  getNanoTimestamp,
} from './constants.js';

export interface CreateTransferParams {
  debitAccountId: string;
  creditAccountId: string;
  amount: Decimal | number;
  ledger: LedgerCode;
  code: TransferCode;
  expenseId?: string;
  userData128?: string;
  userData64?: bigint;
  userData32?: number;
  flags?: number;
  pendingId?: string;
  timeout?: number;
}

@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create a transfer - atomic double-entry with account balance updates
   */
  async createTransfer(params: CreateTransferParams) {
    const amount = new Decimal(params.amount.toString());

    return this.prisma.$transaction(async (tx) => {
      // 1. Create transfer record
      const transfer = await tx.transfer.create({
        data: {
          debit_account_id: params.debitAccountId,
          credit_account_id: params.creditAccountId,
          amount,
          ledger: params.ledger,
          code: params.code,
          expenseId: params.expenseId,
          user_data_128: params.userData128,
          user_data_64: params.userData64,
          user_data_32: params.userData32,
          flags: params.flags ?? TRANSFER_FLAGS.NONE,
          pending_id: params.pendingId,
          timeout: params.timeout ?? 0,
          timestamp: getNanoTimestamp(),
        },
      });

      // 2. Update debit account (increase debits_posted)
      await tx.account.update({
        where: { id: params.debitAccountId },
        data: { debits_posted: { increment: amount } },
      });

      // 3. Update credit account (increase credits_posted)
      await tx.account.update({
        where: { id: params.creditAccountId },
        data: { credits_posted: { increment: amount } },
      });

      return transfer;
    });
  }

  /**
   * Create multiple linked transfers - all succeed or all fail
   */
  async createLinkedTransfers(transfers: CreateTransferParams[]) {
    return this.prisma.$transaction(async (tx) => {
      const results = [];

      for (const params of transfers) {
        const amount = new Decimal(params.amount.toString());

        // Create transfer with LINKED flag
        const transfer = await tx.transfer.create({
          data: {
            debit_account_id: params.debitAccountId,
            credit_account_id: params.creditAccountId,
            amount,
            ledger: params.ledger,
            code: params.code,
            expenseId: params.expenseId,
            user_data_128: params.userData128,
            user_data_64: params.userData64,
            user_data_32: params.userData32,
            flags: (params.flags ?? 0) | TRANSFER_FLAGS.LINKED,
            pending_id: params.pendingId,
            timeout: params.timeout ?? 0,
            timestamp: getNanoTimestamp(),
          },
        });

        // Update account balances
        await tx.account.update({
          where: { id: params.debitAccountId },
          data: { debits_posted: { increment: amount } },
        });

        await tx.account.update({
          where: { id: params.creditAccountId },
          data: { credits_posted: { increment: amount } },
        });

        results.push(transfer);
      }

      return results;
    });
  }

  /**
   * Get transfers for an expense
   */
  async getExpenseTransfers(expenseId: string) {
    return this.prisma.transfer.findMany({
      where: { expenseId },
      include: {
        debitAccount: true,
        creditAccount: true,
      },
    });
  }

  /**
   * Get transfers by account
   */
  async getAccountTransfers(
    accountId: string,
    options?: { limit?: number; offset?: number },
  ) {
    return this.prisma.transfer.findMany({
      where: {
        OR: [
          { debit_account_id: accountId },
          { credit_account_id: accountId },
        ],
      },
      orderBy: { timestamp: 'desc' },
      take: options?.limit ?? 50,
      skip: options?.offset ?? 0,
      include: {
        debitAccount: true,
        creditAccount: true,
        expense: true,
      },
    });
  }

  /**
   * Create pending transfer (two-phase commit - phase 1)
   */
  async createPendingTransfer(params: CreateTransferParams) {
    const amount = new Decimal(params.amount.toString());

    return this.prisma.$transaction(async (tx) => {
      const transfer = await tx.transfer.create({
        data: {
          debit_account_id: params.debitAccountId,
          credit_account_id: params.creditAccountId,
          amount,
          ledger: params.ledger,
          code: params.code,
          expenseId: params.expenseId,
          user_data_128: params.userData128,
          user_data_64: params.userData64,
          user_data_32: params.userData32,
          flags: (params.flags ?? 0) | TRANSFER_FLAGS.PENDING,
          timeout: params.timeout ?? 0,
          timestamp: getNanoTimestamp(),
        },
      });

      // Update pending balances
      await tx.account.update({
        where: { id: params.debitAccountId },
        data: { debits_pending: { increment: amount } },
      });

      await tx.account.update({
        where: { id: params.creditAccountId },
        data: { credits_pending: { increment: amount } },
      });

      return transfer;
    });
  }

  /**
   * Post pending transfer (two-phase commit - phase 2: commit)
   */
  async postPendingTransfer(pendingId: string) {
    const pending = await this.prisma.transfer.findUnique({
      where: { id: pendingId },
    });

    if (!pending || !(pending.flags & TRANSFER_FLAGS.PENDING)) {
      throw new Error('Pending transfer not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // Create the posted transfer
      const posted = await tx.transfer.create({
        data: {
          debit_account_id: pending.debit_account_id,
          credit_account_id: pending.credit_account_id,
          amount: pending.amount,
          ledger: pending.ledger,
          code: pending.code,
          expenseId: pending.expenseId,
          user_data_128: pending.user_data_128,
          user_data_64: pending.user_data_64,
          user_data_32: pending.user_data_32,
          flags: TRANSFER_FLAGS.POST_PENDING_TRANSFER,
          pending_id: pendingId,
          timestamp: getNanoTimestamp(),
        },
      });

      // Move from pending to posted
      await tx.account.update({
        where: { id: pending.debit_account_id },
        data: {
          debits_pending: { decrement: pending.amount },
          debits_posted: { increment: pending.amount },
        },
      });

      await tx.account.update({
        where: { id: pending.credit_account_id },
        data: {
          credits_pending: { decrement: pending.amount },
          credits_posted: { increment: pending.amount },
        },
      });

      return posted;
    });
  }

  /**
   * Void pending transfer (two-phase commit - phase 2: rollback)
   */
  async voidPendingTransfer(pendingId: string) {
    const pending = await this.prisma.transfer.findUnique({
      where: { id: pendingId },
    });

    if (!pending || !(pending.flags & TRANSFER_FLAGS.PENDING)) {
      throw new Error('Pending transfer not found');
    }

    return this.prisma.$transaction(async (tx) => {
      // Create the void record
      const voided = await tx.transfer.create({
        data: {
          debit_account_id: pending.debit_account_id,
          credit_account_id: pending.credit_account_id,
          amount: pending.amount,
          ledger: pending.ledger,
          code: pending.code,
          flags: TRANSFER_FLAGS.VOID_PENDING_TRANSFER,
          pending_id: pendingId,
          timestamp: getNanoTimestamp(),
        },
      });

      // Remove from pending
      await tx.account.update({
        where: { id: pending.debit_account_id },
        data: { debits_pending: { decrement: pending.amount } },
      });

      await tx.account.update({
        where: { id: pending.credit_account_id },
        data: { credits_pending: { decrement: pending.amount } },
      });

      return voided;
    });
  }
}
