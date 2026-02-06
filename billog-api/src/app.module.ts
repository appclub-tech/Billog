import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';

// Core modules
import { PrismaModule } from './prisma/prisma.module.js';
import { RedisModule } from './redis/redis.module.js';
import { CommonModule } from './common/common.module.js';
import { UploadModule } from './uploads/upload.module.js';

// Feature modules
import { HealthModule } from './health/health.module.js';
import { MetricsModule } from './metrics/metrics.module.js';

// Service modules
import { ExpenseModule } from './services/expense/expense.module.js';
import { LedgerModule } from './services/ledger/ledger.module.js';
import { BudgetModule } from './services/budget/budget.module.js';
import { PoolModule } from './services/pool/pool.module.js';
import { UserModule } from './services/user/user.module.js';
import { CategoryModule } from './services/category/category.module.js';
import { ReportModule } from './services/report/report.module.js';
import { SourceModule } from './services/source/source.module.js';

// API modules
import { ApiModule } from './api/api.module.js';

// Configuration
import configuration from './config/configuration.js';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '.env.local'],
    }),

    // Static files (for uploaded images)
    ServeStaticModule.forRoot({
      rootPath: path.resolve(process.cwd(), 'data', 'uploads'),
      serveRoot: '/static/uploads',
      serveStaticOptions: {
        index: false,
        maxAge: '1d',
      },
    }),

    // Scheduling
    ScheduleModule.forRoot(),

    // Core modules
    CommonModule,
    PrismaModule,
    RedisModule,
    UploadModule,

    // Feature modules
    HealthModule,
    MetricsModule,

    // Service modules
    ExpenseModule,
    LedgerModule,
    BudgetModule,
    PoolModule,
    UserModule,
    CategoryModule,
    ReportModule,
    SourceModule,

    // API
    ApiModule,
  ],
})
export class AppModule {}
