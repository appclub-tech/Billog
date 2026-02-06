import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppModule } from '../../src/app.module.js';
import { TEST_JWT_SECRET } from './test-jwt.js';

/**
 * Test configuration override
 */
const testConfig = () => ({
  port: 0, // Random port for tests
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/billog_test',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    host: 'localhost',
    port: 6379,
  },
  jwt: {
    secret: TEST_JWT_SECRET,
    expiresIn: '1h',
  },
  upload: {
    maxFileSize: 10485760,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
  },
});

/**
 * Create test NestJS application
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider('CONFIG_OPTIONS')
    .useValue(testConfig())
    .compile();

  const app = moduleFixture.createNestApplication();

  // Apply global pipes (matching main.ts)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );

  await app.init();

  return app;
}

/**
 * Close test application
 */
export async function closeTestApp(app: INestApplication): Promise<void> {
  if (app) {
    await app.close();
  }
}
