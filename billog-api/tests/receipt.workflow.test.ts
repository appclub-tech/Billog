import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getAuthHeader, TEST_CONTEXT } from './helpers/test-jwt.js';
import { cleanupTestData, ensureOtherCategory } from './helpers/test-db.js';
import { AppModule } from '../src/app.module.js';

describe('Receipt Workflow Tests', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    );

    await app.init();

    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    await cleanupTestData(prisma);
    await ensureOtherCategory(prisma);
  });

  describe('Receipt linking scenarios', () => {
    it('expense without receiptData does NOT create Receipt record', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Manual expense entry',
          amount: 100,
          currency: 'THB',
        });

      expect(response.status).toBe(201);
      const expenseId = response.body.expense.id;

      // Verify NO receipt was created
      const receipt = await prisma.receipt.findFirst({
        where: { expenseId },
      });
      expect(receipt).toBeNull();
    });

    it('expense with receiptData DOES create Receipt record', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Receipt from OCR',
          amount: 250,
          currency: 'THB',
          receiptData: {
            imageUrl: 'https://example.com/ocr-receipt.jpg',
            storeName: 'Lotus Express',
            total: 250,
          },
        });

      expect(response.status).toBe(201);
      const expenseId = response.body.expense.id;

      // Verify Receipt WAS created
      const receipt = await prisma.receipt.findFirst({
        where: { expenseId },
      });
      expect(receipt).not.toBeNull();
      expect(receipt?.storeName).toBe('Lotus Express');
      expect(receipt?.imageUrl).toBe('https://example.com/ocr-receipt.jpg');
    });

    it('receipt is linked to correct expense', async () => {
      // Create first expense
      const response1 = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'First Receipt',
          amount: 100,
          receiptData: { storeName: 'Store A', total: 100 },
        });

      // Create second expense
      const response2 = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Second Receipt',
          amount: 200,
          receiptData: { storeName: 'Store B', total: 200 },
        });

      const expenseId1 = response1.body.expense.id;
      const expenseId2 = response2.body.expense.id;

      // Verify receipts are linked to correct expenses
      const receipt1 = await prisma.receipt.findFirst({
        where: { expenseId: expenseId1 },
      });
      const receipt2 = await prisma.receipt.findFirst({
        where: { expenseId: expenseId2 },
      });

      expect(receipt1?.storeName).toBe('Store A');
      expect(receipt2?.storeName).toBe('Store B');
    });
  });

  describe('Receipt data integrity', () => {
    it('stores all receipt metadata correctly', async () => {
      const receiptData = {
        imageUrl: 'https://cdn.example.com/receipts/abc123.jpg',
        storeName: 'Central Food Hall',
        storeAddress: 'Central World, 999/9 Rama I Road',
        subtotal: 1850.00,
        tax: 129.50,
        total: 1979.50,
        confidence: 0.98,
        rawOcrData: {
          raw_text: 'CENTRAL FOOD HALL\n999/9 Rama I...',
          detected_items: 5,
        },
      };

      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: receiptData.storeName,
          amount: receiptData.total,
          currency: 'THB',
          receiptData,
        });

      expect(response.status).toBe(201);
      const expenseId = response.body.expense.id;

      const receipt = await prisma.receipt.findFirst({
        where: { expenseId },
      });

      expect(receipt).not.toBeNull();
      expect(receipt?.imageUrl).toBe(receiptData.imageUrl);
      expect(receipt?.storeName).toBe(receiptData.storeName);
      expect(receipt?.storeAddress).toBe(receiptData.storeAddress);
      expect(receipt?.subtotal?.toNumber()).toBe(receiptData.subtotal);
      expect(receipt?.tax?.toNumber()).toBe(receiptData.tax);
      expect(receipt?.total?.toNumber()).toBe(receiptData.total);
      expect(receipt?.confidence?.toNumber()).toBe(receiptData.confidence);

      // Verify raw OCR data was stored
      const rawData = receipt?.rawOcrData as Record<string, unknown>;
      expect(rawData).toBeDefined();
      expect(rawData?.detected_items).toBe(5);
    });

    it('handles receipt with minimal data', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Unknown Store',
          amount: 99,
          receiptData: {
            total: 99,
          },
        });

      expect(response.status).toBe(201);
      const expenseId = response.body.expense.id;

      const receipt = await prisma.receipt.findFirst({
        where: { expenseId },
      });

      expect(receipt).not.toBeNull();
      expect(receipt?.total?.toNumber()).toBe(99);
      expect(receipt?.storeName).toBeNull();
      expect(receipt?.imageUrl).toBeNull();
    });
  });

  describe('Receipt with items correlation', () => {
    it('creates expense items that match receipt items', async () => {
      const items = [
        { name: 'Salmon Sashimi', quantity: 2, unitPrice: 180, ingredientType: 'seafood' },
        { name: 'Miso Soup', quantity: 2, unitPrice: 45, ingredientType: 'other' },
        { name: 'Green Tea', quantity: 2, unitPrice: 35, ingredientType: 'beverage' },
      ];

      const total = items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);

      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Sushi Restaurant',
          amount: total,
          items,
          receiptData: {
            storeName: 'Sushi Restaurant',
            total,
            confidence: 0.95,
          },
        });

      expect(response.status).toBe(201);
      const expenseId = response.body.expense.id;

      // Verify expense items
      const expenseItems = await prisma.expenseItem.findMany({
        where: { expenseId },
        orderBy: { name: 'asc' },
      });

      expect(expenseItems.length).toBe(3);
      expect(expenseItems[0].name).toBe('Green Tea');
      expect(expenseItems[0].ingredientType).toBe('beverage');
      expect(expenseItems[1].name).toBe('Miso Soup');
      expect(expenseItems[2].name).toBe('Salmon Sashimi');
      expect(expenseItems[2].ingredientType).toBe('seafood');

      // Verify receipt exists
      const receipt = await prisma.receipt.findFirst({
        where: { expenseId },
      });
      expect(receipt).not.toBeNull();
    });
  });
});
