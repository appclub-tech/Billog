"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { getRecentExpenses, type Expense } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const expenseDate = new Date(date);
  expenseDate.setHours(0, 0, 0, 0);

  if (expenseDate.getTime() === today.getTime()) return "วันนี้";
  if (expenseDate.getTime() === yesterday.getTime()) return "เมื่อวาน";

  const diffDays = Math.floor(
    (today.getTime() - expenseDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays < 7) return `${diffDays} วันที่แล้ว`;

  return date.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
  });
}

export function RecentTransactions() {
  const { data: session } = useSession();
  const [transactions, setTransactions] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      if (!session?.user) return;

      try {
        const { userId } = session.user as { userId?: number };
        if (!userId) {
          setLoading(false);
          return;
        }
        const data = await getRecentExpenses(userId, 5);
        setTransactions(data.expenses);
      } catch (err) {
        console.error("Failed to load recent transactions:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [session]);

  if (loading) {
    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">รายการล่าสุด</h2>
          <Link
            href="/history"
            className="text-sm text-[var(--primary)] font-medium"
          >
            ดูทั้งหมด
          </Link>
        </div>
        <div className="card p-4 text-center text-[var(--secondary)]">
          กำลังโหลด...
        </div>
      </section>
    );
  }

  if (transactions.length === 0) {
    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">รายการล่าสุด</h2>
          <Link
            href="/history"
            className="text-sm text-[var(--primary)] font-medium"
          >
            ดูทั้งหมด
          </Link>
        </div>
        <div className="card p-4 text-center text-[var(--secondary)]">
          ยังไม่มีรายการ
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">รายการล่าสุด</h2>
        <Link
          href="/history"
          className="text-sm text-[var(--primary)] font-medium"
        >
          ดูทั้งหมด
        </Link>
      </div>
      <div className="card divide-y divide-[var(--border)]">
        {transactions.map((tx) => (
          <Link
            key={tx.id}
            href={`/expense/${tx.id}`}
            className="flex items-center gap-3 p-4 active:bg-[var(--border)]/50 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-[var(--background)] flex items-center justify-center text-xl">
              {tx.categoryIcon || "📦"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">
                {tx.description}
              </p>
              <p className="text-xs text-[var(--secondary)]">
                {tx.categoryName || "อื่นๆ"} • {formatRelativeDate(tx.expenseDate || tx.createdAt?.toString() || "")}
              </p>
            </div>
            <p className="font-semibold text-[var(--danger)]">
              -{formatCurrency(tx.amount, tx.currency)}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}
