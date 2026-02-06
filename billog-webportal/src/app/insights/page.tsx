"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  getCategoryInsights,
  getFrequentItems,
  getWeeklyTrend,
  type CategoryInsight,
  type FrequentItem,
  type WeeklyTrendItem,
} from "@/lib/api";

// Color palette for categories
const categoryColors = [
  "#ef4444", // red
  "#3b82f6", // blue
  "#8b5cf6", // purple
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ec4899", // pink
  "#6366f1", // indigo
  "#14b8a6", // teal
];

export default function InsightsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [period, setPeriod] = useState<"week" | "month">("month");
  const [categories, setCategories] = useState<CategoryInsight[]>([]);
  const [frequentItems, setFrequentItems] = useState<FrequentItem[]>([]);
  const [weeklyTrend, setWeeklyTrend] = useState<WeeklyTrendItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login");
    }
  }, [status, router]);

  useEffect(() => {
    async function loadData() {
      if (!session?.user) return;

      setLoading(true);
      try {
        const { userId } = session.user as { userId?: number };
        if (!userId) {
          setLoading(false);
          return;
        }
        const [categoryData, itemsData, trendData] = await Promise.all([
          getCategoryInsights(userId, period),
          getFrequentItems(userId, 10),
          getWeeklyTrend(userId),
        ]);
        setCategories(categoryData.categories);
        setTotal(categoryData.total);
        setFrequentItems(itemsData.items);
        setWeeklyTrend(trendData.trend);
      } catch (err) {
        console.error("Failed to load insights:", err);
      } finally {
        setLoading(false);
      }
    }

    if (status === "authenticated") {
      loadData();
    }
  }, [session, status, period]);

  const maxWeekly = Math.max(...weeklyTrend.map((d) => d.amount), 1);

  if (status === "loading" || loading) {
    return (
      <div className="px-4 pt-6 pb-24 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">วิเคราะห์</h1>
          <div className="flex bg-[var(--card)] rounded-lg p-1">
            <button
              onClick={() => setPeriod("week")}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                period === "week"
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--secondary)]"
              }`}
            >
              สัปดาห์
            </button>
            <button
              onClick={() => setPeriod("month")}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                period === "month"
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--secondary)]"
              }`}
            >
              เดือน
            </button>
          </div>
        </header>
        <div className="text-center py-12 text-[var(--secondary)]">
          กำลังโหลด...
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return null;
  }

  return (
    <div className="px-4 pt-6 pb-24 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">วิเคราะห์</h1>
        <div className="flex bg-[var(--card)] rounded-lg p-1">
          <button
            onClick={() => setPeriod("week")}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              period === "week"
                ? "bg-[var(--primary)] text-white"
                : "text-[var(--secondary)]"
            }`}
          >
            สัปดาห์
          </button>
          <button
            onClick={() => setPeriod("month")}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              period === "month"
                ? "bg-[var(--primary)] text-white"
                : "text-[var(--secondary)]"
            }`}
          >
            เดือน
          </button>
        </div>
      </header>

      {/* Total Spending */}
      <section className="card p-6 text-center">
        <p className="text-sm text-[var(--secondary)]">ใช้จ่ายทั้งหมด</p>
        <p className="text-4xl font-bold mt-2">฿{total.toLocaleString()}</p>
        <p className="text-sm text-[var(--secondary)] mt-1">
          {period === "week" ? "สัปดาห์นี้" : "เดือนนี้"}
        </p>
      </section>

      {/* Weekly Trend Chart */}
      {weeklyTrend.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-4">แนวโน้มรายสัปดาห์</h2>
          <div className="flex items-end justify-between h-32 gap-2">
            {weeklyTrend.map((day, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div
                  className="w-full bg-[var(--primary)] rounded-t-lg transition-all duration-300"
                  style={{
                    height: `${(day.amount / maxWeekly) * 100}%`,
                    minHeight: "8px",
                  }}
                />
                <span className="text-xs text-[var(--secondary)]">{day.day}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Category Breakdown */}
      {categories.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-4">แยกตามหมวดหมู่</h2>
          <div className="space-y-4">
            {categories.map((cat, idx) => (
              <div key={cat.name} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span>{cat.icon}</span>
                    <span className="font-medium">{cat.nameLocalized || cat.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold">฿{cat.amount.toLocaleString()}</span>
                    <span className="text-sm text-[var(--secondary)] ml-2">
                      {cat.percentage}%
                    </span>
                  </div>
                </div>
                <div className="h-2 bg-[var(--border)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${cat.percentage}%`,
                      backgroundColor: categoryColors[idx % categoryColors.length],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Frequent Items */}
      {frequentItems.length > 0 && (
        <section className="card p-4">
          <h2 className="font-semibold mb-4">สินค้าที่ซื้อบ่อย</h2>
          <div className="space-y-3">
            {frequentItems.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0"
              >
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-[var(--secondary)]">
                    {item.count} ครั้ง • เฉลี่ย ฿{Math.round(item.avgPrice)}
                  </p>
                </div>
                <span className="text-sm font-medium">
                  ฿{item.totalSpent.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Empty State */}
      {categories.length === 0 && frequentItems.length === 0 && (
        <section className="card p-6 text-center">
          <p className="text-[var(--secondary)]">ยังไม่มีข้อมูลเพียงพอสำหรับการวิเคราะห์</p>
        </section>
      )}

      {/* Insights Tips */}
      {categories.length > 0 && categories[0] && (
        <section className="card p-4 bg-[var(--primary)]/10 border border-[var(--primary)]/20">
          <h2 className="font-semibold text-[var(--primary)] mb-2">💡 เคล็ดลับ</h2>
          <p className="text-sm">
            คุณใช้จ่ายกับ{categories[0].nameLocalized || categories[0].name}มากที่สุด ({categories[0].percentage}% ของการใช้จ่ายทั้งหมด)
          </p>
        </section>
      )}
    </div>
  );
}
