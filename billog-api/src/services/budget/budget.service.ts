import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { BudgetPeriod } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class BudgetService {
  private readonly logger = new Logger(BudgetService.name);

  constructor(private prisma: PrismaService) {}

  async createBudget(params: {
    sourceId?: string;
    userId?: string;
    categoryId?: string;
    amount: number;
    currency?: string;
    period?: BudgetPeriod;
    startDate: Date;
    endDate?: Date;
    alertThreshold?: number;
  }) {
    return this.prisma.budget.create({
      data: {
        sourceId: params.sourceId,
        userId: params.userId,
        categoryId: params.categoryId,
        amount: new Decimal(params.amount.toString()),
        currency: params.currency || 'THB',
        period: params.period || 'MONTHLY',
        startDate: params.startDate,
        endDate: params.endDate,
        alertThreshold: params.alertThreshold
          ? new Decimal(params.alertThreshold.toString())
          : undefined,
      },
    });
  }

  async getBudgets(userId?: string, sourceId?: string) {
    return this.prisma.budget.findMany({
      where: {
        ...(userId && { userId }),
        ...(sourceId && { sourceId }),
        isActive: true,
      },
      include: {
        category: { select: { id: true, name: true, nameLocalized: true, icon: true } },
      },
    });
  }

  async getBudgetProgress(budgetId: string) {
    const budget = await this.prisma.budget.findUnique({
      where: { id: budgetId },
    });

    if (!budget) return null;

    const expenses = await this.prisma.expense.aggregate({
      where: {
        sourceId: budget.sourceId ?? undefined,
        categoryId: budget.categoryId ?? undefined,
        date: {
          gte: budget.startDate,
          lte: budget.endDate || new Date(),
        },
      },
      _sum: { amount: true },
    });

    const spent = expenses._sum.amount?.toNumber() || 0;
    const budgetAmount = budget.amount.toNumber();
    const percentage = (spent / budgetAmount) * 100;

    return {
      budget,
      spent,
      remaining: budgetAmount - spent,
      percentage,
      isOverBudget: spent > budgetAmount,
    };
  }
}
