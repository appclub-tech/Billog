import { Module } from '@nestjs/common';
import { ExpenseService } from './expense.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { SourceModule } from '../source/source.module.js';

@Module({
  imports: [LedgerModule, SourceModule],
  providers: [ExpenseService, ReconciliationService],
  exports: [ExpenseService, ReconciliationService],
})
export class ExpenseModule {}
