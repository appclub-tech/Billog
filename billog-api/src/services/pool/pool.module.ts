import { Module } from '@nestjs/common';
import { PoolService } from './pool.service.js';

@Module({
  providers: [PoolService],
  exports: [PoolService],
})
export class PoolModule {}
