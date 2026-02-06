import { Module } from '@nestjs/common';
import { ExpenseController } from './controllers/expense.controller.js';
import { BalanceController } from './controllers/balance.controller.js';
import { SettlementController } from './controllers/settlement.controller.js';
import { SourceController } from './controllers/source.controller.js';
import { CategoryController } from './controllers/category.controller.js';
import { BudgetController } from './controllers/budget.controller.js';
import { UserController } from './controllers/user.controller.js';
import { InsightsController } from './controllers/insights.controller.js';
import { ReceiptController } from './controllers/receipt.controller.js';
import { AuthGuard } from './guards/auth.guard.js';
import { ExpenseModule } from '../services/expense/expense.module.js';
import { LedgerModule } from '../services/ledger/ledger.module.js';
import { SourceModule } from '../services/source/source.module.js';
import { UserModule } from '../services/user/user.module.js';
import { CategoryModule } from '../services/category/category.module.js';
import { BudgetModule } from '../services/budget/budget.module.js';

@Module({
  imports: [
    ExpenseModule,
    LedgerModule,
    SourceModule,
    UserModule,
    CategoryModule,
    BudgetModule,
  ],
  controllers: [
    ExpenseController,
    BalanceController,
    SettlementController,
    SourceController,
    CategoryController,
    BudgetController,
    UserController,
    InsightsController,
    ReceiptController,
  ],
  providers: [AuthGuard],
})
export class ApiModule {}
