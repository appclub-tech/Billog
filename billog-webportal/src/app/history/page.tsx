"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getExpenses, getCategories, type Expense, type Category } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const expenseDate = new Date(date);
  expenseDate.setHours(0, 0, 0, 0);

  if (expenseDate.getTime() === today.getTime()) return "วันนี้";
  if (expenseDate.getTime() === yesterday.getTime()) return "เมื่อวาน";

  return date.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

function groupByDate(expenses: Expense[]) {
  const grouped: Record<string, Expense[]> = {};
  for (const expense of expenses) {
    const dateStr = expense.expenseDate || expense.createdAt?.toString() || new Date().toISOString();
    const dateKey = dateStr.split("T")[0]!;
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(expense);
  }
  return Object.entries(grouped).sort((a, b) => b[0].localeCompare(a[0]));
}

export default function HistoryPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    async function loadData() {
      if (!session?.user) return;

      try {
        const { userId } = session.user as { userId?: number };
        if (!userId) {
          setLoading(false);
          return;
        }
        const [expenseData, categoryData] = await Promise.all([
          getExpenses({ userId, limit: 100 }),
          getCategories(),
        ]);
        setExpenses(expenseData.expenses);
        setCategories(categoryData.categories);
      } catch (err) {
        console.error("Failed to load history:", err);
      } finally {
        setLoading(false);
      }
    }

    if (status === "authenticated") {
      loadData();
    }
  }, [session, status]);

  const filteredExpenses = expenses.filter((expense) => {
    const matchesFilter =
      activeFilter === null || expense.categoryId === activeFilter;
    const matchesSearch =
      searchQuery === "" ||
      expense.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  const grouped = groupByDate(filteredExpenses);

  if (status === "loading" || loading) {
    return (
      <div className="flex flex-col h-screen">
        <header className="sticky top-0 bg-[var(--background)] z-10 px-4 pt-6 pb-4">
          <h1 className="text-2xl font-bold">ประวัติรายจ่าย</h1>
        </header>
        <div className="flex-1 flex items-center justify-center text-[var(--secondary)]">
          กำลังโหลด...
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Header */}
      <header className="sticky top-0 bg-[var(--background)] z-10 px-4 pt-6 pb-4 space-y-4">
        <h1 className="text-2xl font-bold">ประวัติรายจ่าย</h1>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="ค้นหา..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-10 pr-4 rounded-xl bg-[var(--card)] border border-[var(--border)] focus:outline-none focus:border-[var(--primary)]"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[var(--secondary)]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {/* Filter Chips */}
        <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
          <button
            onClick={() => setActiveFilter(null)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              activeFilter === null
                ? "bg-[var(--primary)] text-white"
                : "bg-[var(--card)] text-[var(--foreground)]"
            }`}
          >
            ทั้งหมด
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => setActiveFilter(cat.id)}
              className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                activeFilter === cat.id
                  ? "bg-[var(--primary)] text-white"
                  : "bg-[var(--card)] text-[var(--foreground)]"
              }`}
            >
              {cat.icon} {cat.nameLocalized || cat.name}
            </button>
          ))}
        </div>

        {/* Summary */}
        <div className="text-sm text-[var(--secondary)]">
          {filteredExpenses.length} รายการ
        </div>
      </header>

      {/* Transaction List */}
      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {grouped.map(([date, dayExpenses]) => (
          <div key={date} className="mb-6">
            <h3 className="text-sm font-medium text-[var(--secondary)] mb-2 sticky top-0 bg-[var(--background)] py-1">
              {formatDate(date)}
            </h3>
            <div className="card divide-y divide-[var(--border)]">
              {dayExpenses.map((expense) => (
                <Link
                  key={expense.id}
                  href={`/expense/${expense.id}`}
                  className="flex items-center gap-3 p-4 active:bg-[var(--border)]/50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-[var(--background)] flex items-center justify-center text-xl">
                    {expense.categoryIcon || "📦"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {expense.description}
                    </p>
                    <p className="text-xs text-[var(--secondary)]">
                      {expense.categoryName || "อื่นๆ"}
                    </p>
                  </div>
                  <p className="font-semibold text-[var(--danger)]">
                    -{formatCurrency(expense.amount, expense.currency)}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        ))}

        {filteredExpenses.length === 0 && (
          <div className="text-center py-12">
            <p className="text-[var(--secondary)]">ไม่พบรายการ</p>
          </div>
        )}
      </div>
    </div>
  );
}
