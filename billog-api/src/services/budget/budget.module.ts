import { Module } from '@nestjs/common';
import { BudgetService } from './budget.service.js';

@Module({
  providers: [BudgetService],
  exports: [BudgetService],
})
export class BudgetModule {}
