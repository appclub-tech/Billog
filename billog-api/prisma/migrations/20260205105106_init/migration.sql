-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('LINE', 'WHATSAPP', 'TELEGRAM', 'DISCORD', 'WEB');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('DM', 'GROUP');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SummaryPeriod" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'PROMPTPAY', 'EWALLET', 'OTHER');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "avatarUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Bangkok',
    "language" TEXT NOT NULL DEFAULT 'th',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_identities" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "channelId" TEXT NOT NULL,
    "displayName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sources" (
    "id" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "channelId" TEXT NOT NULL,
    "type" "SourceType" NOT NULL DEFAULT 'GROUP',
    "name" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_members" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nickname" TEXT,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "source_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameLocalized" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "parentId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "paidById" TEXT NOT NULL,
    "categoryId" TEXT,
    "poolId" TEXT,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_items" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameLocalized" TEXT,
    "quantity" DECIMAL(10,3) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(15,2) NOT NULL,
    "totalPrice" DECIMAL(15,2) NOT NULL,
    "ingredientType" TEXT,
    "assignedTo" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account" (
    "id" TEXT NOT NULL,
    "debits_pending" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "debits_posted" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "credits_pending" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "credits_posted" DECIMAL(38,0) NOT NULL DEFAULT 0,
    "userId" TEXT,
    "sourceId" TEXT,
    "user_data_128" TEXT,
    "user_data_64" BIGINT,
    "user_data_32" INTEGER,
    "ledger" INTEGER NOT NULL,
    "code" INTEGER NOT NULL,
    "flags" INTEGER NOT NULL DEFAULT 0,
    "timestamp" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer" (
    "id" TEXT NOT NULL,
    "debit_account_id" TEXT NOT NULL,
    "credit_account_id" TEXT NOT NULL,
    "amount" DECIMAL(38,0) NOT NULL,
    "pending_id" TEXT,
    "timeout" INTEGER NOT NULL DEFAULT 0,
    "expenseId" TEXT,
    "user_data_128" TEXT,
    "user_data_64" BIGINT,
    "user_data_32" INTEGER,
    "ledger" INTEGER NOT NULL,
    "code" INTEGER NOT NULL,
    "flags" INTEGER NOT NULL DEFAULT 0,
    "timestamp" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "userId" TEXT,
    "categoryId" TEXT,
    "amount" DECIMAL(15,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "period" "BudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "alertThreshold" DECIMAL(5,2) DEFAULT 80,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pools" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetAmount" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "imageUrl" TEXT,
    "storeName" TEXT,
    "storeAddress" TEXT,
    "receiptDate" TIMESTAMP(3),
    "subtotal" DECIMAL(15,2),
    "tax" DECIMAL(15,2),
    "total" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "rawOcrData" JSONB,
    "confidence" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "last4" TEXT,
    "bankName" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_payment_methods" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "paymentMethodId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameLocalized" TEXT,
    "description" TEXT,
    "deductible" BOOLEAN NOT NULL DEFAULT false,
    "maxDeduction" DECIMAL(15,2),
    "taxYear" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_tax_mappings" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "taxCategoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "category_tax_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_tax_classifications" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "taxCategoryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_tax_classifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookkeeping_reports" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT,
    "reportType" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER,
    "data" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookkeeping_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_summaries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT,
    "period" "SummaryPeriod" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'THB',
    "totalSpent" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalReceived" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalOwed" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalOwing" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "categoryBreakdown" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "user_identities_userId_idx" ON "user_identities"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "user_identities_channel_channelId_key" ON "user_identities"("channel", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "sources_channel_channelId_key" ON "sources"("channel", "channelId");

-- CreateIndex
CREATE INDEX "source_members_sourceId_idx" ON "source_members"("sourceId");

-- CreateIndex
CREATE INDEX "source_members_userId_idx" ON "source_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "source_members_sourceId_userId_key" ON "source_members"("sourceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key" ON "categories"("name");

-- CreateIndex
CREATE INDEX "expenses_sourceId_idx" ON "expenses"("sourceId");

-- CreateIndex
CREATE INDEX "expenses_paidById_idx" ON "expenses"("paidById");

-- CreateIndex
CREATE INDEX "expenses_categoryId_idx" ON "expenses"("categoryId");

-- CreateIndex
CREATE INDEX "expenses_date_idx" ON "expenses"("date");

-- CreateIndex
CREATE INDEX "expense_items_expenseId_idx" ON "expense_items"("expenseId");

-- CreateIndex
CREATE INDEX "expense_items_name_idx" ON "expense_items"("name");

-- CreateIndex
CREATE INDEX "expense_items_assignedTo_idx" ON "expense_items"("assignedTo");

-- CreateIndex
CREATE INDEX "account_ledger_idx" ON "account"("ledger");

-- CreateIndex
CREATE INDEX "account_code_idx" ON "account"("code");

-- CreateIndex
CREATE INDEX "account_userId_idx" ON "account"("userId");

-- CreateIndex
CREATE INDEX "account_sourceId_idx" ON "account"("sourceId");

-- CreateIndex
CREATE INDEX "account_user_data_128_idx" ON "account"("user_data_128");

-- CreateIndex
CREATE UNIQUE INDEX "account_ledger_userId_sourceId_code_key" ON "account"("ledger", "userId", "sourceId", "code");

-- CreateIndex
CREATE INDEX "transfer_debit_account_id_idx" ON "transfer"("debit_account_id");

-- CreateIndex
CREATE INDEX "transfer_credit_account_id_idx" ON "transfer"("credit_account_id");

-- CreateIndex
CREATE INDEX "transfer_expenseId_idx" ON "transfer"("expenseId");

-- CreateIndex
CREATE INDEX "transfer_ledger_idx" ON "transfer"("ledger");

-- CreateIndex
CREATE INDEX "transfer_code_idx" ON "transfer"("code");

-- CreateIndex
CREATE INDEX "transfer_timestamp_idx" ON "transfer"("timestamp");

-- CreateIndex
CREATE INDEX "transfer_user_data_128_idx" ON "transfer"("user_data_128");

-- CreateIndex
CREATE INDEX "budgets_sourceId_idx" ON "budgets"("sourceId");

-- CreateIndex
CREATE INDEX "budgets_userId_idx" ON "budgets"("userId");

-- CreateIndex
CREATE INDEX "budgets_categoryId_idx" ON "budgets"("categoryId");

-- CreateIndex
CREATE INDEX "pools_sourceId_idx" ON "pools"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_expenseId_key" ON "receipts"("expenseId");

-- CreateIndex
CREATE INDEX "receipts_sourceId_idx" ON "receipts"("sourceId");

-- CreateIndex
CREATE INDEX "payment_methods_userId_idx" ON "payment_methods"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_payment_methods_expenseId_paymentMethodId_key" ON "expense_payment_methods"("expenseId", "paymentMethodId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_categories_name_key" ON "tax_categories"("name");

-- CreateIndex
CREATE UNIQUE INDEX "category_tax_mappings_categoryId_taxCategoryId_key" ON "category_tax_mappings"("categoryId", "taxCategoryId");

-- CreateIndex
CREATE INDEX "expense_tax_classifications_userId_idx" ON "expense_tax_classifications"("userId");

-- CreateIndex
CREATE INDEX "expense_tax_classifications_taxCategoryId_idx" ON "expense_tax_classifications"("taxCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "expense_tax_classifications_expenseId_taxCategoryId_userId_key" ON "expense_tax_classifications"("expenseId", "taxCategoryId", "userId");

-- CreateIndex
CREATE INDEX "bookkeeping_reports_userId_idx" ON "bookkeeping_reports"("userId");

-- CreateIndex
CREATE INDEX "bookkeeping_reports_reportType_idx" ON "bookkeeping_reports"("reportType");

-- CreateIndex
CREATE INDEX "user_summaries_userId_idx" ON "user_summaries"("userId");

-- CreateIndex
CREATE INDEX "user_summaries_periodStart_idx" ON "user_summaries"("periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "user_summaries_userId_sourceId_period_periodStart_currency_key" ON "user_summaries"("userId", "sourceId", "period", "periodStart", "currency");

-- AddForeignKey
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_members" ADD CONSTRAINT "source_members_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_members" ADD CONSTRAINT "source_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_poolId_fkey" FOREIGN KEY ("poolId") REFERENCES "pools"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_items" ADD CONSTRAINT "expense_items_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account" ADD CONSTRAINT "account_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_debit_account_id_fkey" FOREIGN KEY ("debit_account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_credit_account_id_fkey" FOREIGN KEY ("credit_account_id") REFERENCES "account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer" ADD CONSTRAINT "transfer_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pools" ADD CONSTRAINT "pools_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment_methods" ADD CONSTRAINT "expense_payment_methods_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payment_methods" ADD CONSTRAINT "expense_payment_methods_paymentMethodId_fkey" FOREIGN KEY ("paymentMethodId") REFERENCES "payment_methods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_tax_mappings" ADD CONSTRAINT "category_tax_mappings_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_tax_mappings" ADD CONSTRAINT "category_tax_mappings_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_tax_classifications" ADD CONSTRAINT "expense_tax_classifications_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_tax_classifications" ADD CONSTRAINT "expense_tax_classifications_taxCategoryId_fkey" FOREIGN KEY ("taxCategoryId") REFERENCES "tax_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_tax_classifications" ADD CONSTRAINT "expense_tax_classifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_summaries" ADD CONSTRAINT "user_summaries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
