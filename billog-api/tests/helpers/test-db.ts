import { PrismaClient } from '@prisma/client';

/**
 * Singleton Prisma client for tests
 */
let prisma: PrismaClient | null = null;

/**
 * Get or create Prisma client
 */
export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.DEBUG_PRISMA ? ['query', 'error'] : ['error'],
    });
  }
  return prisma;
}

/**
 * Clean up test data
 * Deletes data in correct order to avoid FK constraints
 */
export async function cleanupTestData(prismaClient?: PrismaClient): Promise<void> {
  const db = prismaClient || getPrisma();

  // Delete in reverse dependency order
  await db.expenseTaxClassification.deleteMany({});
  await db.categoryTaxMapping.deleteMany({});
  await db.taxCategory.deleteMany({});
  await db.bookkeepingReport.deleteMany({});
  await db.expensePaymentMethod.deleteMany({});
  await db.paymentMethod.deleteMany({});
  await db.userSummary.deleteMany({});
  await db.receipt.deleteMany({});
  await db.transfer.deleteMany({});
  await db.account.deleteMany({});
  await db.expenseItem.deleteMany({});
  await db.expense.deleteMany({});
  await db.budget.deleteMany({});
  await db.pool.deleteMany({});
  await db.sourceMember.deleteMany({});
  await db.userIdentity.deleteMany({});
  await db.source.deleteMany({});
  await db.user.deleteMany({});
  // Keep categories (seeded)
}

/**
 * Disconnect Prisma client
 */
export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
}

/**
 * Create test user
 */
export async function createTestUser(
  prismaClient: PrismaClient,
  data: {
    name?: string;
    email?: string;
    channel?: 'LINE' | 'WHATSAPP' | 'TELEGRAM';
    channelId?: string;
  } = {}
) {
  const user = await prismaClient.user.create({
    data: {
      name: data.name || 'Test User',
      email: data.email,
    },
  });

  // Create identity if channel info provided
  if (data.channel && data.channelId) {
    await prismaClient.userIdentity.create({
      data: {
        userId: user.id,
        channel: data.channel,
        channelId: data.channelId,
      },
    });
  }

  return user;
}

/**
 * Create test source (group or DM)
 */
export async function createTestSource(
  prismaClient: PrismaClient,
  data: {
    channel?: 'LINE' | 'WHATSAPP' | 'TELEGRAM';
    channelId?: string;
    type?: 'GROUP' | 'DM';
    name?: string;
  } = {}
) {
  return prismaClient.source.create({
    data: {
      channel: data.channel || 'LINE',
      channelId: data.channelId || `test-source-${Date.now()}`,
      type: data.type || 'GROUP',
      name: data.name || 'Test Group',
    },
  });
}

/**
 * Ensure "Other" category exists (needed for expense creation)
 */
export async function ensureOtherCategory(prismaClient: PrismaClient) {
  const existing = await prismaClient.category.findUnique({
    where: { name: 'Other' },
  });

  if (!existing) {
    return prismaClient.category.create({
      data: {
        name: 'Other',
        icon: '📦',
        isSystem: true,
      },
    });
  }

  return existing;
}
