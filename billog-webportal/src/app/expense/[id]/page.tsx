"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getExpenseDetail, type ExpenseDetail } from "@/lib/api";
import { formatCurrency } from "@/lib/currency";

export default function ExpenseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const expenseId = parseInt(params.id as string, 10);

  const [data, setData] = useState<ExpenseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadExpense() {
      try {
        const result = await getExpenseDetail(expenseId);
        setData(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load expense");
      } finally {
        setLoading(false);
      }
    }

    if (expenseId) {
      loadExpense();
    }
  }, [expenseId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--background)] p-4">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => router.back()} className="mb-4 text-[var(--primary)]">
            ← กลับ
          </button>
          <div className="text-center py-12 text-[var(--secondary)]">
            กำลังโหลด...
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[var(--background)] p-4">
        <div className="max-w-2xl mx-auto">
          <button onClick={() => router.back()} className="mb-4 text-[var(--primary)]">
            ← กลับ
          </button>
          <div className="text-center py-12 text-[var(--danger)]">
            {error || "ไม่พบรายการ"}
          </div>
        </div>
      </div>
    );
  }

  const { expense, items, splits } = data;
  const expenseDate = expense.expenseDate
    ? new Date(expense.expenseDate).toLocaleDateString("th-TH", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "-";

  return (
    <div className="min-h-screen bg-[var(--background)] p-4 pb-24">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button onClick={() => router.back()} className="text-[var(--primary)]">
            ← กลับ
          </button>
          <h1 className="text-xl font-bold">รายละเอียดรายจ่าย</h1>
          <div className="w-12" /> {/* Spacer */}
        </div>

        {/* Expense Summary */}
        <div className="card p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-[var(--background)] flex items-center justify-center text-2xl">
                {expense.categoryIcon || "📦"}
              </div>
              <div>
                <h2 className="text-lg font-semibold">{expense.description}</h2>
                <p className="text-sm text-[var(--secondary)]">
                  {expense.categoryName || "อื่นๆ"}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-[var(--danger)]">
                {formatCurrency(expense.amount, expense.currency)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-[var(--border)]">
            <div>
              <p className="text-xs text-[var(--secondary)]">จ่ายโดย</p>
              <p className="font-medium">{expense.paidByName || `User ${expense.paidByUserId}`}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--secondary)]">วันที่</p>
              <p className="font-medium">{expenseDate}</p>
            </div>
            {expense.currency && expense.currency !== "THB" && (
              <div>
                <p className="text-xs text-[var(--secondary)]">สกุลเงิน</p>
                <p className="font-medium">{expense.currency}</p>
              </div>
            )}
          </div>

          {expense.notes && (
            <div className="pt-4 border-t border-[var(--border)]">
              <p className="text-xs text-[var(--secondary)]">หมายเหตุ</p>
              <p className="mt-1">{expense.notes}</p>
            </div>
          )}
        </div>

        {/* Items Table */}
        {items.length > 0 && (
          <div className="card">
            <div className="p-4 border-b border-[var(--border)]">
              <h3 className="font-semibold">รายการสินค้า ({items.length} รายการ)</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[var(--background)] text-sm text-[var(--secondary)]">
                  <tr>
                    <th className="text-left p-3">สินค้า</th>
                    <th className="text-center p-3">จำนวน</th>
                    <th className="text-right p-3">ราคา/หน่วย</th>
                    <th className="text-right p-3">รวม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {items.map((item) => (
                    <tr key={item.id} className="hover:bg-[var(--border)]/30">
                      <td className="p-3">
                        <div>
                          <p className="font-medium">{item.nameEn || item.name}</p>
                          {item.ingredientType && (
                            <span className="text-xs text-[var(--secondary)] bg-[var(--background)] px-2 py-0.5 rounded-full mt-1 inline-block">
                              {item.ingredientType}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center">{item.quantity}</td>
                      <td className="p-3 text-right">
                        {formatCurrency(item.unitPrice, expense.currency)}
                      </td>
                      <td className="p-3 text-right font-semibold">
                        {formatCurrency(item.totalPrice, expense.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-[var(--background)] font-semibold">
                  <tr>
                    <td colSpan={3} className="p-3 text-right">
                      รวมทั้งหมด
                    </td>
                    <td className="p-3 text-right text-[var(--danger)]">
                      {formatCurrency(expense.amount, expense.currency)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Splits */}
        {splits.length > 0 && (
          <div className="card">
            <div className="p-4 border-b border-[var(--border)]">
              <h3 className="font-semibold">การแบ่งจ่าย</h3>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {splits.map((split) => (
                <div key={split.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium">{split.userName || `User ${split.userId}`}</p>
                    {split.percentage && (
                      <p className="text-sm text-[var(--secondary)]">{split.percentage}%</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {formatCurrency(split.amount, expense.currency)}
                    </p>
                    {split.isSettled && (
                      <span className="text-xs text-[var(--success)] bg-[var(--success)]/10 px-2 py-0.5 rounded-full">
                        ✓ ชำระแล้ว
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
