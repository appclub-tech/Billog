import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountService } from './account.service.js';
import { LedgerCode, ACCOUNT_CODE } from './constants.js';

export interface UserBalance {
  userId: string;
  userName: string | null;
  asset: Decimal;
  liability: Decimal;
  net: Decimal;
}

export interface BalanceEntry {
  from: { userId: string; name: string | null };
  to: { userId: string; name: string | null };
  amount: Decimal;
}

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);

  constructor(
    private prisma: PrismaService,
    private accountService: AccountService,
  ) {}

  /**
   * Get user's balance in a source
   */
  async getUserBalance(
    userId: string,
    sourceId: string,
    ledger: LedgerCode,
  ): Promise<UserBalance> {
    const accounts = await this.accountService.getUserAccounts(
      userId,
      sourceId,
      ledger,
    );

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    const assetAccount = accounts.find((a) => a.code === ACCOUNT_CODE.ASSET);
    const liabilityAccount = accounts.find(
      (a) => a.code === ACCOUNT_CODE.LIABILITY,
    );

    const asset = assetAccount
      ? this.accountService.getAccountBalance(assetAccount, ACCOUNT_CODE.ASSET)
      : new Decimal(0);
    const liability = liabilityAccount
      ? this.accountService.getAccountBalance(
          liabilityAccount,
          ACCOUNT_CODE.LIABILITY,
        )
      : new Decimal(0);

    return {
      userId,
      userName: user?.name ?? null,
      asset,
      liability,
      net: asset.minus(liability),
    };
  }

  /**
   * Get all balances in a source
   */
  async getGroupBalances(
    sourceId: string,
    ledger: LedgerCode,
  ): Promise<Map<string, UserBalance>> {
    const accounts = await this.accountService.getSourceAccounts(
      sourceId,
      ledger,
    );

    // Group accounts by userId
    const userAccountMap = new Map<
      string,
      { asset?: typeof accounts[0]; liability?: typeof accounts[0] }
    >();

    for (const account of accounts) {
      if (!account.userId) continue;

      if (!userAccountMap.has(account.userId)) {
        userAccountMap.set(account.userId, {});
      }

      const userAccounts = userAccountMap.get(account.userId)!;
      if (account.code === ACCOUNT_CODE.ASSET) {
        userAccounts.asset = account;
      } else if (account.code === ACCOUNT_CODE.LIABILITY) {
        userAccounts.liability = account;
      }
    }

    // Get user names
    const userIds = Array.from(userAccountMap.keys());
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    const userNameMap = new Map(users.map((u) => [u.id, u.name]));

    // Calculate balances
    const balances = new Map<string, UserBalance>();

    for (const [userId, accounts] of userAccountMap) {
      const asset = accounts.asset
        ? this.accountService.getAccountBalance(
            accounts.asset,
            ACCOUNT_CODE.ASSET,
          )
        : new Decimal(0);
      const liability = accounts.liability
        ? this.accountService.getAccountBalance(
            accounts.liability,
            ACCOUNT_CODE.LIABILITY,
          )
        : new Decimal(0);

      balances.set(userId, {
        userId,
        userName: userNameMap.get(userId) ?? null,
        asset,
        liability,
        net: asset.minus(liability),
      });
    }

    return balances;
  }

  /**
   * Calculate optimized debts (who owes whom)
   * Uses a greedy algorithm to minimize number of transactions
   */
  async getDebts(sourceId: string, ledger: LedgerCode): Promise<BalanceEntry[]> {
    const balances = await this.getGroupBalances(sourceId, ledger);

    // Separate into creditors (positive net) and debtors (negative net)
    const creditors: { userId: string; name: string | null; amount: Decimal }[] =
      [];
    const debtors: { userId: string; name: string | null; amount: Decimal }[] =
      [];

    for (const balance of balances.values()) {
      if (balance.net.greaterThan(0)) {
        creditors.push({
          userId: balance.userId,
          name: balance.userName,
          amount: balance.net,
        });
      } else if (balance.net.lessThan(0)) {
        debtors.push({
          userId: balance.userId,
          name: balance.userName,
          amount: balance.net.abs(),
        });
      }
    }

    // Sort by amount (largest first) for optimal matching
    creditors.sort((a, b) => b.amount.minus(a.amount).toNumber());
    debtors.sort((a, b) => b.amount.minus(a.amount).toNumber());

    // Match debtors to creditors
    const debts: BalanceEntry[] = [];
    let i = 0;
    let j = 0;

    while (i < debtors.length && j < creditors.length) {
      const debtor = debtors[i];
      const creditor = creditors[j];

      const amount = Decimal.min(debtor.amount, creditor.amount);

      if (amount.greaterThan(0)) {
        debts.push({
          from: { userId: debtor.userId, name: debtor.name },
          to: { userId: creditor.userId, name: creditor.name },
          amount,
        });
      }

      debtor.amount = debtor.amount.minus(amount);
      creditor.amount = creditor.amount.minus(amount);

      if (debtor.amount.isZero()) i++;
      if (creditor.amount.isZero()) j++;
    }

    return debts;
  }

  /**
   * Check if an expense is fully settled
   */
  async isExpenseSettled(expenseId: string): Promise<boolean> {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      include: { transfers: true },
    });

    if (!expense) return false;

    // Get all splits and settlements for this expense
    const splits = expense.transfers.filter((t) => t.code === 1); // EXPENSE_SPLIT
    const settlements = expense.transfers.filter((t) => t.code === 2); // SETTLEMENT

    // Sum up split amounts
    const totalSplit = splits.reduce(
      (sum, t) => sum.plus(t.amount),
      new Decimal(0),
    );

    // Sum up settlement amounts
    const totalSettled = settlements.reduce(
      (sum, t) => sum.plus(t.amount),
      new Decimal(0),
    );

    return totalSettled.greaterThanOrEqualTo(totalSplit);
  }
}
