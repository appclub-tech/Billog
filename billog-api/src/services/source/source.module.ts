import { Module, forwardRef } from '@nestjs/common';
import { SourceService } from './source.service.js';
import { MemberService } from './member.service.js';
import { UserModule } from '../user/user.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';

@Module({
  imports: [
    UserModule,
    forwardRef(() => LedgerModule), // Circular dependency with LedgerModule
  ],
  providers: [SourceService, MemberService],
  exports: [SourceService, MemberService],
})
export class SourceModule {}
