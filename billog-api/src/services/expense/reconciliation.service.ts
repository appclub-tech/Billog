import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SplitService, SplitType, ItemSplit } from '../ledger/split.service.js';
import { MemberService } from '../source/member.service.js';
import { Decimal } from '@prisma/client/runtime/library';
import { Channel } from '@prisma/client';

export type AdjustmentType =
  | 'reassign_item'
  | 'update_item'
  | 'add_item'
  | 'remove_item'
  | 'remove_from_split'
  | 'add_to_split'
  | 'update_amount'
  | 'update_category'
  | 'update_description';

export interface Adjustment {
  type: AdjustmentType;
  itemId?: string;
  name?: string;
  quantity?: number;
  unitPrice?: number;
  assignedTo?: string;
  target?: string;
  amount?: number;
  categoryId?: string;
  description?: string;
}

export interface ReconcileParams {
  expenseId: string;
  channel: Channel;
  sourceChannelId: string;
  adjustments: Adjustment[];
  reason?: string;
}

export interface SplitDelta {
  userId: string;
  name: string | null;
  oldAmount: Decimal;
  newAmount: Decimal;
  delta: Decimal;
}

@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private prisma: PrismaService,
    private splitService: SplitService,
    private memberService: MemberService,
  ) {}

  async reconcileExpense(params: ReconcileParams) {
    const { expenseId, channel, adjustments, reason } = params;

    // 1. Get current expense with items and transfers
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: {
        items: true,
        paidBy: { select: { id: true, name: true } },
        source: true,
        transfers: {
          include: {
            debitAccount: { select: { userId: true } },
            creditAccount: { select: { userId: true } },
          },
        },
      },
    });

    if (!expense) {
      throw new Error('Expense not found');
    }

    // 2. Calculate current splits from existing transfers
    const oldSplits = this.calculateCurrentSplits(expense);

    // 3. Apply adjustments to items
    const updatedItems = await this.applyItemAdjustments(
      expense.id,
      expense.items,
      adjustments,
    );

    // 4. Apply expense-level adjustments
    await this.applyExpenseAdjustments(expense.id, adjustments);

    // 5. Recalculate new splits based on updated items
    const newSplits = await this.calculateNewSplits(
      expense.sourceId,
      channel,
      updatedItems,
      expense.paidById,
      adjustments,
    );

    // 6. Compute delta between old and new splits
    const deltas = this.computeSplitDeltas(oldSplits, newSplits);

    // 7. Create adjustment transfers for non-zero deltas
    const adjustmentTransfers = await this.createAdjustmentTransfers(
      expense.id,
      expense.sourceId,
      expense.paidById,
      deltas,
      expense.currency,
      reason,
    );

    // 8. Update expense total if needed
    const newTotal = updatedItems.reduce(
      (sum, item) => sum.add(new Decimal(item.totalPrice.toString())),
      new Decimal(0),
    );

    await this.prisma.expense.update({
      where: { id: expense.id },
      data: { amount: newTotal },
    });

    // 9. Get updated expense
    const updatedExpense = await this.prisma.expense.findUnique({
      where: { id: expense.id },
      include: {
        items: true,
        paidBy: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, nameLocalized: true } },
      },
    });

    // 10. Get user names for deltas
    const userIds = deltas.map((d) => d.userId);
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u.name]));

    return {
      expense: updatedExpense,
      adjustments: deltas
        .filter((d) => !d.delta.isZero())
        .map((d) => ({
          userId: d.userId,
          name: userMap.get(d.userId) || d.name,
          oldAmount: d.oldAmount.toNumber(),
          newAmount: d.newAmount.toNumber(),
          delta: d.delta.toNumber(),
        })),
      transfers: adjustmentTransfers.map((t) => ({
        id: t.id,
        type: 'ADJUSTMENT',
        amount: t.amount.toNumber(),
      })),
    };
  }

  private calculateCurrentSplits(expense: any): Map<string, Decimal> {
    const splits = new Map<string, Decimal>();

    // Calculate from expense split transfers
    for (const transfer of expense.transfers) {
      if (transfer.code === 1) {
        // EXPENSE_SPLIT
        const userId = transfer.creditAccount?.userId;
        if (userId && userId !== expense.paidById) {
          const current = splits.get(userId) || new Decimal(0);
          splits.set(userId, current.add(transfer.amount));
        }
      }
    }

    return splits;
  }

  private async applyItemAdjustments(
    expenseId: string,
    currentItems: any[],
    adjustments: Adjustment[],
  ): Promise<any[]> {
    const items = [...currentItems];

    for (const adj of adjustments) {
      switch (adj.type) {
        case 'reassign_item': {
          if (!adj.itemId) continue;
          await this.prisma.expenseItem.update({
            where: { id: adj.itemId },
            data: { assignedTo: adj.assignedTo },
          });
          const idx = items.findIndex((i) => i.id === adj.itemId);
          if (idx >= 0) items[idx].assignedTo = adj.assignedTo;
          break;
        }

        case 'update_item': {
          if (!adj.itemId) continue;
          const quantity = adj.quantity ?? 1;
          const unitPrice = adj.unitPrice ?? 0;
          const totalPrice = quantity * unitPrice;

          await this.prisma.expenseItem.update({
            where: { id: adj.itemId },
            data: {
              quantity: new Decimal(quantity.toString()),
              unitPrice: new Decimal(unitPrice.toString()),
              totalPrice: new Decimal(totalPrice.toString()),
            },
          });

          const idx = items.findIndex((i) => i.id === adj.itemId);
          if (idx >= 0) {
            items[idx].quantity = new Decimal(quantity.toString());
            items[idx].unitPrice = new Decimal(unitPrice.toString());
            items[idx].totalPrice = new Decimal(totalPrice.toString());
          }
          break;
        }

        case 'add_item': {
          if (!adj.name) continue;
          const quantity = adj.quantity ?? 1;
          const unitPrice = adj.unitPrice ?? 0;
          const totalPrice = quantity * unitPrice;

          const newItem = await this.prisma.expenseItem.create({
            data: {
              expenseId,
              name: adj.name,
              quantity: new Decimal(quantity.toString()),
              unitPrice: new Decimal(unitPrice.toString()),
              totalPrice: new Decimal(totalPrice.toString()),
              assignedTo: adj.assignedTo,
            },
          });
          items.push(newItem);
          break;
        }

        case 'remove_item': {
          if (!adj.itemId) continue;
          await this.prisma.expenseItem.delete({
            where: { id: adj.itemId },
          });
          const idx = items.findIndex((i) => i.id === adj.itemId);
          if (idx >= 0) items.splice(idx, 1);
          break;
        }
      }
    }

    return items;
  }

  private async applyExpenseAdjustments(
    expenseId: string,
    adjustments: Adjustment[],
  ) {
    for (const adj of adjustments) {
      switch (adj.type) {
        case 'update_category':
          if (adj.categoryId) {
            await this.prisma.expense.update({
              where: { id: expenseId },
              data: { categoryId: adj.categoryId },
            });
          }
          break;

        case 'update_description':
          if (adj.description) {
            await this.prisma.expense.update({
              where: { id: expenseId },
              data: { description: adj.description },
            });
          }
          break;
      }
    }
  }

  private async calculateNewSplits(
    sourceId: string,
    channel: Channel,
    items: any[],
    paidByUserId: string,
    adjustments: Adjustment[],
  ): Promise<Map<string, Decimal>> {
    // Convert items to ItemSplit format
    const itemSplits: ItemSplit[] = items.map((item) => ({
      name: item.name,
      quantity: item.quantity?.toNumber?.() ?? item.quantity ?? 1,
      unitPrice: item.unitPrice?.toNumber?.() ?? item.unitPrice ?? 0,
      assignedTo: item.assignedTo,
    }));

    // Check for split membership adjustments
    const excludeTargets: string[] = [];
    const includeTargets: string[] = [];

    for (const adj of adjustments) {
      if (adj.type === 'remove_from_split' && adj.target) {
        excludeTargets.push(adj.target);
      }
      if (adj.type === 'add_to_split' && adj.target) {
        includeTargets.push(adj.target);
      }
    }

    // Calculate total
    const total = items.reduce(
      (sum, item) => sum + (item.totalPrice?.toNumber?.() ?? item.totalPrice ?? 0),
      0,
    );

    // Use split service to calculate
    return this.splitService.calculateSplits(
      sourceId,
      channel,
      total,
      'item',
      paidByUserId,
      undefined,
      itemSplits,
    );
  }

  private computeSplitDeltas(
    oldSplits: Map<string, Decimal>,
    newSplits: Map<string, Decimal>,
  ): SplitDelta[] {
    const allUserIds = new Set([...oldSplits.keys(), ...newSplits.keys()]);
    const deltas: SplitDelta[] = [];

    for (const userId of allUserIds) {
      const oldAmount = oldSplits.get(userId) || new Decimal(0);
      const newAmount = newSplits.get(userId) || new Decimal(0);
      const delta = newAmount.sub(oldAmount);

      deltas.push({
        userId,
        name: null,
        oldAmount,
        newAmount,
        delta,
      });
    }

    return deltas;
  }

  private async createAdjustmentTransfers(
    expenseId: string,
    sourceId: string,
    paidByUserId: string,
    deltas: SplitDelta[],
    currency: string,
    reason?: string,
  ) {
    const transfers: any[] = [];

    for (const delta of deltas) {
      if (delta.delta.isZero()) continue;

      // Create adjustment transfer
      // Positive delta means user owes more → transfer from user to payer
      // Negative delta means user owes less → transfer from payer to user
      const transfer = await this.splitService.createAdjustmentTransfer(
        expenseId,
        sourceId,
        delta.userId,
        paidByUserId,
        delta.delta.abs(),
        currency,
        delta.delta.isPositive() ? 'increase' : 'decrease',
        reason,
      );

      if (transfer) {
        transfers.push(transfer);
      }
    }

    return transfers;
  }
}
