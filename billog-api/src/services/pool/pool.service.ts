import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class PoolService {
  private readonly logger = new Logger(PoolService.name);

  constructor(private prisma: PrismaService) {}

  async createPool(params: {
    sourceId: string;
    name: string;
    description?: string;
    targetAmount?: number;
    currency?: string;
    startDate?: Date;
    endDate?: Date;
  }) {
    return this.prisma.pool.create({
      data: {
        sourceId: params.sourceId,
        name: params.name,
        description: params.description,
        targetAmount: params.targetAmount
          ? new Decimal(params.targetAmount.toString())
          : null,
        currency: params.currency || 'THB',
        startDate: params.startDate || new Date(),
        endDate: params.endDate,
      },
    });
  }

  async getPoolById(id: string) {
    return this.prisma.pool.findUnique({
      where: { id },
      include: {
        expenses: {
          include: {
            paidBy: { select: { id: true, name: true } },
          },
          orderBy: { date: 'desc' },
        },
      },
    });
  }

  async getSourcePools(sourceId: string) {
    return this.prisma.pool.findMany({
      where: { sourceId, isActive: true },
      include: {
        _count: { select: { expenses: true } },
      },
    });
  }

  async getPoolSummary(poolId: string) {
    const pool = await this.getPoolById(poolId);
    if (!pool) return null;

    const totalSpent = pool.expenses.reduce(
      (sum, e) => sum + e.amount.toNumber(),
      0,
    );

    return {
      pool,
      totalSpent,
      expenseCount: pool.expenses.length,
      remaining: pool.targetAmount
        ? pool.targetAmount.toNumber() - totalSpent
        : null,
    };
  }
}
