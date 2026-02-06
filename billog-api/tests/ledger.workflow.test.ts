import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { getAuthHeader, TEST_CONTEXT } from './helpers/test-jwt.js';
import { cleanupTestData, ensureOtherCategory } from './helpers/test-db.js';
import { AppModule } from '../src/app.module.js';

describe('Ledger Workflow Tests', () => {
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

  describe('Account creation on first interaction', () => {
    it('creates ASSET and LIABILITY accounts when user joins source', async () => {
      const response = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'First expense',
          amount: 100,
          currency: 'THB',
        });

      expect(response.status).toBe(201);

      // Get the user who created the expense
      const user = await prisma.user.findFirst({
        where: {
          identities: {
            some: {
              channel: TEST_CONTEXT.channel,
              channelId: TEST_CONTEXT.senderChannelId,
            },
          },
        },
      });
      expect(user).not.toBeNull();

      // Get the source
      const source = await prisma.source.findFirst({
        where: {
          channel: TEST_CONTEXT.channel,
          channelId: TEST_CONTEXT.sourceChannelId,
        },
      });
      expect(source).not.toBeNull();

      // Verify accounts were created
      const accounts = await prisma.account.findMany({
        where: {
          userId: user!.id,
          sourceId: source!.id,
        },
      });

      expect(accounts.length).toBe(2);

      const assetAccount = accounts.find((a) => a.code === 100);
      const liabilityAccount = accounts.find((a) => a.code === 200);

      expect(assetAccount).toBeDefined();
      expect(liabilityAccount).toBeDefined();
      expect(assetAccount?.ledger).toBe(1); // THB ledger
      expect(liabilityAccount?.ledger).toBe(1);
    });
  });

  describe('Split expense creates transfers', () => {
    it('creates ledger transfers when expense is split between multiple users', async () => {
      // First, add another member to the group by syncing members
      // We'll create a second user by making an expense from a different sender
      const secondUserChannelId = 'test-user-2';

      // Create first expense (creates first user + accounts)
      const response1 = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Setup expense',
          amount: 50,
          currency: 'THB',
        });
      expect(response1.status).toBe(201);

      // Create second expense from different user (creates second user + accounts)
      const response2 = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader({
          senderChannelId: secondUserChannelId,
        }))
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: secondUserChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Second user expense',
          amount: 50,
          currency: 'THB',
        });
      expect(response2.status).toBe(201);

      // Verify we have 2 users with accounts
      const source = await prisma.source.findFirst({
        where: {
          channel: TEST_CONTEXT.channel,
          channelId: TEST_CONTEXT.sourceChannelId,
        },
      });
      expect(source).not.toBeNull();

      const accountsBefore = await prisma.account.findMany({
        where: { sourceId: source!.id },
      });
      expect(accountsBefore.length).toBe(4); // 2 users x 2 accounts each

      // Now create an expense with split
      const splitResponse = await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: TEST_CONTEXT.senderChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'Dinner to split',
          amount: 200,
          currency: 'THB',
          splitType: 'equal',
          splits: [{ target: '@all' }],
        });

      expect(splitResponse.status).toBe(201);
      expect(splitResponse.body.expense.id).toBeDefined();

      const expenseId = splitResponse.body.expense.id;

      // Verify transfers were created
      const transfers = await prisma.transfer.findMany({
        where: { expenseId },
        include: {
          debitAccount: { include: { user: true } },
          creditAccount: { include: { user: true } },
        },
      });

      // Should have 1 transfer: user2 owes user1 (100 THB each, payer excluded)
      expect(transfers.length).toBe(1);

      const transfer = transfers[0];
      expect(transfer.amount.toNumber()).toBe(100); // 200 / 2 = 100 each
      expect(transfer.code).toBe(1); // EXPENSE_SPLIT
      expect(transfer.ledger).toBe(1); // THB

      // Debit account should be user2's LIABILITY (they owe)
      expect(transfer.debitAccount.code).toBe(200); // LIABILITY

      // Credit account should be user1's ASSET (they're owed)
      expect(transfer.creditAccount.code).toBe(100); // ASSET

      // Verify account balances updated
      const accountsAfter = await prisma.account.findMany({
        where: { sourceId: source!.id },
      });

      // Find user1's ASSET account
      const user1 = await prisma.user.findFirst({
        where: {
          identities: {
            some: {
              channel: TEST_CONTEXT.channel,
              channelId: TEST_CONTEXT.senderChannelId,
            },
          },
        },
      });

      const user1Asset = accountsAfter.find(
        (a) => a.userId === user1!.id && a.code === 100
      );
      expect(user1Asset).toBeDefined();
      // ASSET balance = credits_posted - debits_posted
      // User1 is owed 100, so credits_posted should be 100
      expect(user1Asset!.credits_posted.toNumber()).toBe(100);

      // Find user2's LIABILITY account
      const user2 = await prisma.user.findFirst({
        where: {
          identities: {
            some: {
              channel: TEST_CONTEXT.channel,
              channelId: secondUserChannelId,
            },
          },
        },
      });

      const user2Liability = accountsAfter.find(
        (a) => a.userId === user2!.id && a.code === 200
      );
      expect(user2Liability).toBeDefined();
      // LIABILITY balance = debits_posted - credits_posted
      // User2 owes 100, so debits_posted should be 100
      expect(user2Liability!.debits_posted.toNumber()).toBe(100);
    });
  });

  describe('Balance calculation', () => {
    it('correctly calculates who owes whom after multiple expenses', async () => {
      const user1ChannelId = TEST_CONTEXT.senderChannelId;
      const user2ChannelId = 'test-user-2';

      // User1 pays 300, split equally (user2 owes 150)
      await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader())
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: user1ChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'User1 pays lunch',
          amount: 300,
          currency: 'THB',
          splitType: 'equal',
          splits: [{ target: '@all' }],
          // Add user2 to members
          groupMembers: [
            { channelId: user1ChannelId, displayName: 'User1' },
            { channelId: user2ChannelId, displayName: 'User2' },
          ],
        });

      // User2 pays 100, split equally (user1 owes 50)
      await request(app.getHttpServer())
        .post('/expenses')
        .set(getAuthHeader({ senderChannelId: user2ChannelId }))
        .send({
          channel: TEST_CONTEXT.channel,
          senderChannelId: user2ChannelId,
          sourceChannelId: TEST_CONTEXT.sourceChannelId,
          description: 'User2 pays coffee',
          amount: 100,
          currency: 'THB',
          splitType: 'equal',
          splits: [{ target: '@all' }],
        });

      // Get source
      const source = await prisma.source.findFirst({
        where: {
          channel: TEST_CONTEXT.channel,
          channelId: TEST_CONTEXT.sourceChannelId,
        },
      });

      // Get users
      const user1 = await prisma.user.findFirst({
        where: {
          identities: {
            some: { channel: TEST_CONTEXT.channel, channelId: user1ChannelId },
          },
        },
      });
      const user2 = await prisma.user.findFirst({
        where: {
          identities: {
            some: { channel: TEST_CONTEXT.channel, channelId: user2ChannelId },
          },
        },
      });

      // Get accounts
      const accounts = await prisma.account.findMany({
        where: { sourceId: source!.id },
      });

      // User1's accounts
      const user1Asset = accounts.find(
        (a) => a.userId === user1!.id && a.code === 100
      );
      const user1Liability = accounts.find(
        (a) => a.userId === user1!.id && a.code === 200
      );

      // User1 ASSET balance: owed 150 from lunch
      const user1AssetBalance =
        user1Asset!.credits_posted.toNumber() - user1Asset!.debits_posted.toNumber();
      // User1 LIABILITY balance: owes 50 from coffee
      const user1LiabilityBalance =
        user1Liability!.debits_posted.toNumber() - user1Liability!.credits_posted.toNumber();
      // User1 NET = ASSET - LIABILITY = 150 - 50 = 100
      const user1Net = user1AssetBalance - user1LiabilityBalance;

      // User2's accounts
      const user2Asset = accounts.find(
        (a) => a.userId === user2!.id && a.code === 100
      );
      const user2Liability = accounts.find(
        (a) => a.userId === user2!.id && a.code === 200
      );

      // User2 ASSET balance: owed 50 from coffee
      const user2AssetBalance =
        user2Asset!.credits_posted.toNumber() - user2Asset!.debits_posted.toNumber();
      // User2 LIABILITY balance: owes 150 from lunch
      const user2LiabilityBalance =
        user2Liability!.debits_posted.toNumber() - user2Liability!.credits_posted.toNumber();
      // User2 NET = ASSET - LIABILITY = 50 - 150 = -100 (owes 100)
      const user2Net = user2AssetBalance - user2LiabilityBalance;

      // User1's net receivable (100) should equal User2's net payable (-100)
      expect(user1Net).toBe(100);
      expect(user2Net).toBe(-100);
      expect(user1Net + user2Net).toBe(0); // Zero-sum check

      // Verify transfers count (2 expenses with splits = 2 transfers)
      const transfers = await prisma.transfer.findMany({
        where: {
          OR: [
            { debitAccount: { sourceId: source!.id } },
            { creditAccount: { sourceId: source!.id } },
          ],
        },
      });
      expect(transfers.length).toBe(2);
    });
  });
});
