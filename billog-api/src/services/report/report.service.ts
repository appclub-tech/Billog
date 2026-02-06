import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';

@Injectable()
export class ReportService {
  private readonly logger = new Logger(ReportService.name);

  constructor(private prisma: PrismaService) {}

  async generateReport(params: {
    userId: string;
    sourceId?: string;
    reportType: string;
    year: number;
    month?: number;
  }) {
    const data = await this.collectReportData(params);

    return this.prisma.bookkeepingReport.create({
      data: {
        userId: params.userId,
        sourceId: params.sourceId,
        reportType: params.reportType,
        year: params.year,
        month: params.month,
        data,
      },
    });
  }

  private async collectReportData(params: {
    userId: string;
    sourceId?: string;
    reportType: string;
    year: number;
    month?: number;
  }) {
    const startDate = new Date(params.year, (params.month ?? 1) - 1, 1);
    const endDate = params.month
      ? new Date(params.year, params.month, 0)
      : new Date(params.year, 11, 31);

    const expenses = await this.prisma.expense.findMany({
      where: {
        paidById: params.userId,
        ...(params.sourceId && { sourceId: params.sourceId }),
        date: { gte: startDate, lte: endDate },
      },
      include: {
        category: true,
        items: true,
      },
    });

    const categoryTotals: Record<string, number> = {};
    let total = 0;

    for (const expense of expenses) {
      const categoryName = expense.category?.name || 'Uncategorized';
      const amount = expense.amount.toNumber();
      categoryTotals[categoryName] = (categoryTotals[categoryName] || 0) + amount;
      total += amount;
    }

    return {
      period: { year: params.year, month: params.month },
      total,
      expenseCount: expenses.length,
      categoryBreakdown: categoryTotals,
      generatedAt: new Date().toISOString(),
    };
  }

  async getReports(userId: string, reportType?: string) {
    return this.prisma.bookkeepingReport.findMany({
      where: {
        userId,
        ...(reportType && { reportType }),
      },
      orderBy: { generatedAt: 'desc' },
    });
  }
}
