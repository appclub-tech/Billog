/**
 * API client for Yimmy dashboard
 * All endpoints use userId for queries (not groupId)
 */

// In Docker, the web container talks to app container via internal network
// But browser needs to talk via the exposed port or ngrok
function getApiBase(): string {
  // Server-side: use internal Docker network
  if (typeof window === "undefined") {
    return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
  }
  // Client-side: use same origin or explicit URL
  // When running in Docker, nginx can proxy /api to the app container
  // For now, use the host's exposed port
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
}

interface Expense {
  id: number;
  description: string;
  amount: number;
  currency?: string;
  categoryId?: number;
  categoryName?: string;
  categoryIcon?: string;
  paidByUserId: number;
  paidByName?: string;
  expenseDate?: string;
  createdAt?: Date;
  notes?: string;
}

interface ExpenseSummary {
  today: {
    total: number;
    count: number;
  };
  thisMonth: {
    total: number;
    count: number;
    trend: "up" | "down";
    trendValue: number;
  };
  lastMonth: {
    total: number;
    count: number;
  };
}

interface Budget {
  id: number;
  userId: number;
  categoryId?: number;
  categoryName?: string;
  amount: number;
  spent?: number;
  remaining?: number;
  percentageUsed?: number;
  period: string;
}

interface CategoryInsight {
  name: string;
  nameTh: string;
  icon: string;
  amount: number;
  percentage: number;
}

interface FrequentItem {
  name: string;
  count: number;
  avgPrice: number;
  totalSpent: number;
}

interface WeeklyTrendItem {
  date: string;
  day: string;
  amount: number;
}

interface Category {
  id: number;
  name: string;
  nameTh: string;
  icon: string;
}

interface Source {
  id: number;
  type: string;
  channel: string;
  name: string;
}

interface ExpenseItem {
  id: number;
  name: string;
  nameEn?: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  ingredientType?: string;
}

interface ExpenseSplit {
  id: number;
  userId: number;
  userName?: string;
  amount: number;
  percentage?: number;
  isSettled: boolean;
}

interface ExpenseDetail {
  expense: Expense & { categoryName?: string; categoryIcon?: string };
  items: ExpenseItem[];
  splits: ExpenseSplit[];
}

async function fetchAPI<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const apiBase = getApiBase();
  const res = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

/**
 * Get expenses for a user
 */
export async function getExpenses(params: {
  userId: number;
  startDate?: string;
  endDate?: string;
  categoryId?: number;
  sourceId?: number;
  limit?: number;
}): Promise<{ expenses: Expense[]; total: number; count: number }> {
  const query = new URLSearchParams();
  query.set("userId", String(params.userId));
  if (params.startDate) query.set("startDate", params.startDate);
  if (params.endDate) query.set("endDate", params.endDate);
  if (params.categoryId) query.set("categoryId", String(params.categoryId));
  if (params.sourceId) query.set("sourceId", String(params.sourceId));
  if (params.limit) query.set("limit", String(params.limit));

  return fetchAPI(`/api/expenses?${query}`);
}

/**
 * Get recent expenses for a user
 */
export async function getRecentExpenses(
  userId: number,
  limit = 10
): Promise<{ expenses: Expense[] }> {
  const query = new URLSearchParams({ userId: String(userId), limit: String(limit) });
  return fetchAPI(`/api/expenses/recent?${query}`);
}

/**
 * Get expense summary for a user
 */
export async function getExpenseSummary(
  userId: number
): Promise<ExpenseSummary> {
  const query = new URLSearchParams({ userId: String(userId) });
  return fetchAPI(`/api/expenses/summary?${query}`);
}

/**
 * Get budgets for a user
 */
export async function getBudgets(
  userId: number
): Promise<{ budgets: Budget[] }> {
  const query = new URLSearchParams({ userId: String(userId) });
  return fetchAPI(`/api/budgets?${query}`);
}

/**
 * Get category spending insights for a user
 */
export async function getCategoryInsights(
  userId: number,
  period: "week" | "month" = "month"
): Promise<{ categories: CategoryInsight[]; total: number; period: string }> {
  const query = new URLSearchParams({ userId: String(userId), period });
  return fetchAPI(`/api/insights/categories?${query}`);
}

/**
 * Get frequently purchased items for a user
 */
export async function getFrequentItems(
  userId: number,
  limit = 20
): Promise<{ items: FrequentItem[] }> {
  const query = new URLSearchParams({ userId: String(userId), limit: String(limit) });
  return fetchAPI(`/api/insights/frequent-items?${query}`);
}

/**
 * Get weekly spending trend for a user
 */
export async function getWeeklyTrend(
  userId: number
): Promise<{ trend: WeeklyTrendItem[] }> {
  const query = new URLSearchParams({ userId: String(userId) });
  return fetchAPI(`/api/insights/weekly-trend?${query}`);
}

/**
 * Get all expense categories
 */
export async function getCategories(): Promise<{ categories: Category[] }> {
  return fetchAPI("/api/categories");
}

/**
 * Get sources (DMs and groups) for a user
 */
export async function getUserSources(
  userId: number
): Promise<{ sources: Source[] }> {
  return fetchAPI(`/api/users/${userId}/sources`);
}

/**
 * Get balances for a user
 */
export async function getBalances(
  userId: number,
  sourceId?: number
): Promise<{ balances: Array<{ fromUserName: string; toUserName: string; amount: number }> }> {
  const query = new URLSearchParams({ userId: String(userId) });
  if (sourceId) query.set("sourceId", String(sourceId));
  return fetchAPI(`/api/balances?${query}`);
}

/**
 * Get expense detail with items and splits
 */
export async function getExpenseDetail(expenseId: number): Promise<ExpenseDetail> {
  return fetchAPI(`/api/expenses/${expenseId}`);
}

export type {
  Expense,
  ExpenseSummary,
  Budget,
  CategoryInsight,
  FrequentItem,
  WeeklyTrendItem,
  Category,
  Source,
  ExpenseItem,
  ExpenseSplit,
  ExpenseDetail,
};
