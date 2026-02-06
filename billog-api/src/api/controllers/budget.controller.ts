import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { BudgetService } from '../../services/budget/budget.service.js';
import { AuthGuard } from '../guards/auth.guard.js';

@Controller('budgets')
export class BudgetController {
  constructor(private budgetService: BudgetService) {}

  @Get()
  @UseGuards(AuthGuard)
  async getBudgets(
    @Query('userId') userId?: string,
    @Query('sourceId') sourceId?: string,
  ) {
    const budgets = await this.budgetService.getBudgets(userId, sourceId);
    return {
      budgets: budgets.map((b) => ({
        id: b.id,
        amount: b.amount.toNumber(),
        currency: b.currency,
        period: b.period,
        category: b.category,
      })),
    };
  }

  @Get(':id/progress')
  @UseGuards(AuthGuard)
  async getBudgetProgress(@Param('id') id: string) {
    const progress = await this.budgetService.getBudgetProgress(id);
    if (!progress) {
      return { error: 'Budget not found' };
    }
    return {
      budget: {
        id: progress.budget.id,
        amount: progress.budget.amount.toNumber(),
        currency: progress.budget.currency,
        period: progress.budget.period,
      },
      spent: progress.spent,
      remaining: progress.remaining,
      percentage: progress.percentage,
      isOverBudget: progress.isOverBudget,
    };
  }
}
