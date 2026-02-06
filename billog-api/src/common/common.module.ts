import { Module, Global } from '@nestjs/common';
import { LogContextService } from './services/log-context.service.js';

@Global()
@Module({
  providers: [LogContextService],
  exports: [LogContextService],
})
export class CommonModule {}
