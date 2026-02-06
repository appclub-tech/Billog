import { Module, forwardRef } from '@nestjs/common';
import { AccountService } from './account.service.js';
import { TransferService } from './transfer.service.js';
import { BalanceService } from './balance.service.js';
import { SplitService } from './split.service.js';
import { SourceModule } from '../source/source.module.js';

@Module({
  imports: [forwardRef(() => SourceModule)], // Circular dependency with SourceModule
  providers: [AccountService, TransferService, BalanceService, SplitService],
  exports: [AccountService, TransferService, BalanceService, SplitService],
})
export class LedgerModule {}
