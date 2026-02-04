"use client";

import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SummaryCard } from "@/components/SummaryCard";
import { RecentTransactions } from "@/components/RecentTransactions";
import { getExpenseSummary, getBudgets, type ExpenseSummary, type Budget } from "@/lib/api";

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [summary, setSummary] = useState<ExpenseSummary | null>(null);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    async function loadData() {
      if (!session?.user) return;

      try {
        // Use userId from session (internal user ID)
        const { userId } = session.user as { userId?: number };
        if (!userId) {
          setError("User ID not found in session");
          setLoading(false);
          return;
        }

        const [summaryData, budgetData] = await Promise.all([
          getExpenseSummary(userId),
          getBudgets(userId),
        ]);
        setSummary(summaryData);
        setBudgets(budgetData.budgets);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    }

    if (status === "authenticated") {
      loadData();
    }
  }, [session, status]);

  // Calculate total budget
  const totalBudget = budgets.reduce((sum, b) => sum + b.amount, 0);
  const totalSpent = summary?.thisMonth.total || 0;
  const budgetRemaining = totalBudget - totalSpent;
  const budgetPercentUsed = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

  if (status === "loading" || loading) {
    return (
      <div className="px-4 pt-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[var(--secondary)] text-sm">สวัสดี</p>
            <h1 className="text-2xl font-bold">Yimmy</h1>
          </div>
          <div className="w-10 h-10 rounded-full bg-[var(--primary)] flex items-center justify-center text-white font-bold">
            Y
          </div>
        </header>
        <div className="text-center py-12 text-[var(--secondary)]">
          กำลังโหลด...
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null; // Will redirect
  }

  if (error) {
    return (
      <div className="px-4 pt-6 space-y-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-[var(--secondary)] text-sm">สวัสดี</p>
            <h1 className="text-2xl font-bold">{session?.user?.name || "Yimmy"}</h1>
          </div>
          <UserAvatar session={session} />
        </header>
        <div className="text-center py-12 text-[var(--danger)]">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pt-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[var(--secondary)] text-sm">สวัสดี</p>
          <h1 className="text-2xl font-bold">{session?.user?.name || "Yimmy"}</h1>
        </div>
        <UserAvatar session={session} />
      </header>

      {/* Summary Cards */}
      <section className="grid grid-cols-2 gap-3">
        <SummaryCard
          title="เดือนนี้"
          amount={summary?.thisMonth.total || 0}
          subtitle={`${summary?.thisMonth.count || 0} รายการ`}
          trend={summary?.thisMonth.trend}
          trendValue={summary?.thisMonth.trendValue}
        />
        <SummaryCard
          title="วันนี้"
          amount={summary?.today.total || 0}
          subtitle={`${summary?.today.count || 0} รายการ`}
        />
      </section>

      {/* Budget Progress */}
      {totalBudget > 0 && (
        <section className="card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">งบประมาณเดือนนี้</h2>
            <span className="text-sm text-[var(--secondary)]">
              ฿{totalSpent.toLocaleString()} / ฿{totalBudget.toLocaleString()}
            </span>
          </div>
          <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                budgetPercentUsed > 90
                  ? "bg-[var(--danger)]"
                  : budgetPercentUsed > 70
                  ? "bg-[var(--warning)]"
                  : "bg-[var(--primary)]"
              }`}
              style={{ width: `${Math.min(budgetPercentUsed, 100)}%` }}
            />
          </div>
          <p className="text-sm text-[var(--secondary)] mt-2">
            {budgetRemaining >= 0
              ? `เหลืออีก ฿${budgetRemaining.toLocaleString()} (${(100 - budgetPercentUsed).toFixed(1)}%)`
              : `เกินงบ ฿${Math.abs(budgetRemaining).toLocaleString()}`}
          </p>
        </section>
      )}

      {/* Recent Transactions */}
      <RecentTransactions />
    </div>
  );
}

// User avatar component with logout on click
function UserAvatar({ session }: { session: ReturnType<typeof useSession>["data"] }) {
  const [showMenu, setShowMenu] = useState(false);

  if (!session?.user) {
    return (
      <div className="w-10 h-10 rounded-full bg-[var(--primary)] flex items-center justify-center text-white font-bold">
        Y
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="w-10 h-10 rounded-full overflow-hidden bg-[var(--primary)] flex items-center justify-center"
      >
        {session.user.image ? (
          <img
            src={session.user.image}
            alt={session.user.name || "User"}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-white font-bold">
            {session.user.name?.charAt(0) || "U"}
          </span>
        )}
      </button>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute right-0 top-12 z-20 bg-[var(--card)] rounded-xl shadow-lg border border-[var(--border)] overflow-hidden min-w-[150px]">
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <p className="font-medium text-sm">{session.user.name}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full px-4 py-3 text-left text-sm text-[var(--danger)] hover:bg-[var(--border)]/50"
            >
              ออกจากระบบ
            </button>
          </div>
        </>
      )}
    </div>
  );
}
