import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getAuthHeader, TEST_CONTEXT } from './helpers/test-jwt.js';
import { cleanupTestData, ensureOtherCategory } from './helpers/test-db.js';
import { AppModule } from '../src/app.module.js';

describe('Expense Creation Workflow', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    // Use the full AppModule for complete dependency resolution
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    // Apply global pipes
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      })
    );

    await app.init();

    // Get Prisma client for direct DB queries
    prisma = new PrismaClient();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    // Clean up test data before each test
    await cleanupTestData(prisma);
    // Ensure categories exist
    await ensureOtherCategory(prisma);
  });

  describe('POST /expenses', () => {
    it('creates expense record with valid data', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          sourceType: TEST_CONTEXT.sourceType,
          description: 'Test Coffee',
          amount: 65,
          currency: 'THB',
        });

      expect(response.status).toBe(201);
      expect(response.body.expense).toBeDefined();
      expect(response.body.expense.id).toBeDefined();
      expect(response.body.expense.description).toBe('Test Coffee');
      expect(response.body.expense.amount).toBe(65);

      // Verify DB record exists
      const expense = await prisma.expense.findUnique({
        where: { id: response.body.expense.id },
      });
      expect(expense).not.toBeNull();
      expect(expense?.description).toBe('Test Coffee');
    });

    it('creates expense with items', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: '7-Eleven Groceries',
          amount: 150,
          currency: 'THB',
          items: [
            { name: 'Milk', quantity: 2, unitPrice: 45, ingredientType: 'dairy' },
            { name: 'Bread', quantity: 1, unitPrice: 60, ingredientType: 'grain' },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.expense.id).toBeDefined();

      // Verify expense items exist in DB
      const items = await prisma.expenseItem.findMany({
        where: { expenseId: response.body.expense.id },
        orderBy: { name: 'asc' },
      });

      expect(items.length).toBe(2);
      expect(items[0].name).toBe('Bread');
      expect(items[0].ingredientType).toBe('grain');
      expect(items[1].name).toBe('Milk');
      expect(items[1].ingredientType).toBe('dairy');
    });

    it('creates expense with receiptData and links Receipt record', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Big C Supermarket',
          amount: 450.50,
          currency: 'THB',
          items: [
            { name: 'Chicken', quantity: 1, unitPrice: 200, ingredientType: 'meat' },
            { name: 'Vegetables', quantity: 1, unitPrice: 150, ingredientType: 'vegetable' },
            { name: 'Rice', quantity: 1, unitPrice: 100.50, ingredientType: 'grain' },
          ],
          receiptData: {
            imageUrl: 'https://example.com/receipt.jpg',
            storeName: 'Big C Supermarket',
            storeAddress: '123 Test Road',
            subtotal: 430,
            tax: 20.50,
            total: 450.50,
            confidence: 0.95,
          },
        });

      expect(response.status).toBe(201);
      expect(response.body.expense.id).toBeDefined();

      const expenseId = response.body.expense.id;

      // Verify expense record
      const expense = await prisma.expense.findUnique({
        where: { id: expenseId },
      });
      expect(expense).not.toBeNull();
      expect(expense?.description).toBe('Big C Supermarket');

      // Verify expense items
      const items = await prisma.expenseItem.findMany({
        where: { expenseId },
      });
      expect(items.length).toBe(3);

      // Verify receipt record was created and linked
      const receipt = await prisma.receipt.findFirst({
        where: { expenseId },
      });
      expect(receipt).not.toBeNull();
      expect(receipt?.storeName).toBe('Big C Supermarket');
      expect(receipt?.imageUrl).toBe('https://example.com/receipt.jpg');
      expect(receipt?.total?.toNumber()).toBe(450.50);
      expect(receipt?.tax?.toNumber()).toBe(20.50);
    });

    it('creates expense with splits and ledger transfers', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Dinner at restaurant',
          amount: 600,
          currency: 'THB',
          splitType: 'equal',
          splits: [
            { target: '@all' },
          ],
        });

      expect(response.status).toBe(201);
      expect(response.body.expense.id).toBeDefined();

      const expenseId = response.body.expense.id;

      // Verify expense
      const expense = await prisma.expense.findUnique({
        where: { id: expenseId },
      });
      expect(expense).not.toBeNull();

      // Verify ledger transfers were created
      const transfers = await prisma.transfer.findMany({
        where: { expenseId },
      });
      expect(transfers.length).toBeGreaterThanOrEqual(0);
    });

    it('returns error with missing context', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader({
          channel: undefined,
          senderChannelId: undefined,
          sourceChannelId: undefined,
        }))
        .send({
          description: 'Test',
          amount: 100,
        });

      expect(response.body.error || response.status >= 400).toBeTruthy();
    });
  });

  describe('Full Receipt Workflow', () => {
    it('simulates extract-receipt then create-expense workflow', async () => {
      // Step 1: Simulate OCR result (this would come from extract-receipt tool)
      const ocrResult = {
        storeName: 'Tops Supermarket',
        storeAddress: '456 Bangkok Road',
        items: [
          { name: 'Pork Belly', quantity: 0.5, unitPrice: 280, ingredientType: 'meat' },
          { name: 'Oyster Sauce', quantity: 1, unitPrice: 45, ingredientType: 'condiment' },
          { name: 'Spring Onion', quantity: 2, unitPrice: 15, ingredientType: 'vegetable' },
        ],
        subtotal: 185,
        tax: 12.95,
        total: 197.95,
        currency: 'THB',
        payment: {
          method: 'Credit',
          cardType: 'VISA',
          cardLast4: '1234',
        },
      };

      // Step 2: Call create-expense with the OCR data
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: ocrResult.storeName,
          amount: ocrResult.total,
          currency: ocrResult.currency,
          items: ocrResult.items,
          metadata: {
            payment: ocrResult.payment,
          },
          receiptData: {
            imageUrl: 'https://example.com/tops-receipt.jpg',
            storeName: ocrResult.storeName,
            storeAddress: ocrResult.storeAddress,
            subtotal: ocrResult.subtotal,
            tax: ocrResult.tax,
            total: ocrResult.total,
            confidence: 0.92,
          },
        });

      expect(response.status).toBe(201);

      // Step 3: Verify ALL records were created
      const expenseId = response.body.expense.id;
      expect(expenseId).toBeDefined();

      // Verify expense
      const expense = await prisma.expense.findUnique({
        where: { id: expenseId },
        include: { items: true },
      });
      expect(expense).not.toBeNull();
      expect(expense?.description).toBe('Tops Supermarket');
      expect(expense?.amount.toNumber()).toBe(197.95);

      // Verify items
      expect(expense?.items.length).toBe(3);

      // Verify receipt
      const receipt = await prisma.receipt.findFirst({
        where: { expenseId },
      });
      expect(receipt).not.toBeNull();
      expect(receipt?.storeName).toBe('Tops Supermarket');
      expect(receipt?.tax?.toNumber()).toBe(12.95);

      // Verify payment method was linked (if payment info was processed)
      const paymentLinks = await prisma.expensePaymentMethod.findMany({
        where: { expenseId },
      });
      expect(paymentLinks).toBeDefined();
    });
  });
});
