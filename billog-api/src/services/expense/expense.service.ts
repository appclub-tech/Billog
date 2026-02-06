import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime/library';
import { Prisma } from '@prisma/client';

export interface CreateExpenseParams {
  sourceId: string;
  paidById: string;
  description: string;
  amount: number | Decimal;
  currency?: string;
  categoryId?: string;
  poolId?: string;
  date?: Date;
  notes?: string;
  metadata?: Prisma.InputJsonValue;
}

export interface CreateExpenseItemParams {
  name: string; // English name (default)
  nameLocalized?: string; // Original language (Thai, Japanese, etc.)
  quantity?: number;
  unitPrice: number;
  ingredientType?: string;
  assignedTo?: string;
  metadata?: Prisma.InputJsonValue;
}

@Injectable()
export class ExpenseService {
  private readonly logger = new Logger(ExpenseService.name);

  constructor(private prisma: PrismaService) {}

  async createExpense(params: CreateExpenseParams) {
    const expense = await this.prisma.expense.create({
      data: {
        sourceId: params.sourceId,
        paidById: params.paidById,
        description: params.description,
        amount: new Decimal(params.amount.toString()),
        currency: params.currency || 'THB',
        categoryId: params.categoryId,
        poolId: params.poolId,
        date: params.date || new Date(),
        notes: params.notes,
        metadata: params.metadata,
      },
      include: {
        paidBy: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, nameLocalized: true, icon: true } },
      },
    });

    this.logger.log(`Created expense ${expense.id}: ${params.description} ${params.amount}`);
    return expense;
  }

  async createExpenseWithItems(
    params: CreateExpenseParams,
    items: CreateExpenseItemParams[],
  ) {
    // Calculate total from items if not provided
    const itemsTotal = items.reduce(
      (sum, item) => sum + (item.unitPrice * (item.quantity || 1)),
      0,
    );
    const amount = params.amount || itemsTotal;

    const expense = await this.prisma.expense.create({
      data: {
        sourceId: params.sourceId,
        paidById: params.paidById,
        description: params.description,
        amount: new Decimal(amount.toString()),
        currency: params.currency || 'THB',
        categoryId: params.categoryId,
        poolId: params.poolId,
        date: params.date || new Date(),
        notes: params.notes,
        metadata: params.metadata,
        items: {
          create: items.map((item) => ({
            name: item.name,
            nameLocalized: item.nameLocalized,
            quantity: new Decimal((item.quantity || 1).toString()),
            unitPrice: new Decimal(item.unitPrice.toString()),
            totalPrice: new Decimal((item.unitPrice * (item.quantity || 1)).toString()),
            ingredientType: item.ingredientType,
            assignedTo: item.assignedTo,
            metadata: item.metadata,
          })),
        },
      },
      include: {
        paidBy: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, nameLocalized: true, icon: true } },
        items: true,
      },
    });

    this.logger.log(`Created expense ${expense.id} with ${items.length} items`);
    return expense;
  }

  async getExpenseById(id: string) {
    return this.prisma.expense.findUnique({
      where: { id },
      include: {
        paidBy: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, nameLocalized: true, icon: true, color: true } },
        items: true,
        receipt: true,
        transfers: true,
      },
    });
  }

  async getRecentExpenses(sourceId: string, limit = 10) {
    return this.prisma.expense.findMany({
      where: { sourceId },
      include: {
        paidBy: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, nameLocalized: true, icon: true } },
      },
      orderBy: { date: 'desc' },
      take: limit,
    });
  }

  async getExpenseSummary(sourceId: string, startDate: Date, endDate: Date) {
    const result = await this.prisma.expense.aggregate({
      where: {
        sourceId,
        date: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true },
      _count: true,
    });

    return {
      total: result._sum.amount?.toNumber() || 0,
      count: result._count,
    };
  }

  async updateExpense(
    id: string,
    data: {
      description?: string;
      amount?: number | Decimal;
      currency?: string;
      categoryId?: string;
      poolId?: string;
      date?: Date;
      notes?: string;
    },
  ) {
    return this.prisma.expense.update({
      where: { id },
      data: {
        ...data,
        amount: data.amount ? new Decimal(data.amount.toString()) : undefined,
      },
      include: {
        paidBy: { select: { id: true, name: true } },
        category: true,
        items: true,
      },
    });
  }

  async deleteExpense(id: string) {
    return this.prisma.expense.delete({
      where: { id },
    });
  }
}
