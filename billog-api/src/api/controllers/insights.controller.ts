import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { SourceService } from '../../services/source/source.service.js';
import { AuthGuard } from '../guards/auth.guard.js';
import { Channel } from '@prisma/client';

@Controller('insights')
export class InsightsController {
  constructor(
    private prisma: PrismaService,
    private sourceService: SourceService,
  ) {}

  @Get('summary')
  @UseGuards(AuthGuard)
  async getSummary(
    @Query('channel') channel: string,
    @Query('sourceChannelId') sourceChannelId: string,
    @Query('period') period?: string, // 'day' | 'week' | 'month' | 'year'
  ) {
    if (!channel || !sourceChannelId) {
      return { error: 'channel and sourceChannelId are required' };
    }

    const source = await this.sourceService.findByChannel(
      channel as Channel,
      sourceChannelId,
    );

    if (!source) {
      return { error: 'Source not found' };
    }

    // Calculate date range
    const now = new Date();
    let startDate: Date;

    switch (period) {
      case 'day':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'week':
        const dayOfWeek = now.getDay();
        startDate = new Date(now);
        startDate.setDate(now.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'year':
        startDate = new Date(now.getFullYear(), 0, 1);
        break;
      case 'month':
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Get expenses in period
    const expenses = await this.prisma.expense.findMany({
      where: {
        sourceId: source.id,
        date: { gte: startDate, lte: now },
      },
      include: {
        category: true,
        paidBy: { select: { id: true, name: true } },
      },
    });

    // Calculate totals
    let total = 0;
    const byCategory: Record<string, number> = {};
    const byPayer: Record<string, { name: string; total: number }> = {};

    for (const expense of expenses) {
      const amount = expense.amount.toNumber();
      total += amount;

      const categoryName = expense.category?.name || 'Uncategorized';
      byCategory[categoryName] = (byCategory[categoryName] || 0) + amount;

      const payerId = expense.paidById;
      if (!byPayer[payerId]) {
        byPayer[payerId] = { name: expense.paidBy.name || 'Unknown', total: 0 };
      }
      byPayer[payerId].total += amount;
    }

    return {
      period: period || 'month',
      startDate: startDate.toISOString(),
      endDate: now.toISOString(),
      total,
      count: expenses.length,
      byCategory,
      byPayer: Object.entries(byPayer).map(([id, data]) => ({
        userId: id,
        name: data.name,
        total: data.total,
      })),
    };
  }
}
