interface SummaryCardProps {
  title: string;
  amount: number;
  subtitle?: string;
  trend?: "up" | "down";
  trendValue?: number;
}

export function SummaryCard({
  title,
  amount,
  subtitle,
  trend,
  trendValue,
}: SummaryCardProps) {
  return (
    <div className="card p-4">
      <p className="text-sm text-[var(--secondary)]">{title}</p>
      <p className="text-2xl font-bold mt-1">
        ฿{amount.toLocaleString()}
      </p>
      <div className="flex items-center gap-2 mt-1">
        {subtitle && (
          <span className="text-xs text-[var(--secondary)]">{subtitle}</span>
        )}
        {trend && trendValue && (
          <span
            className={`text-xs font-medium ${
              trend === "up" ? "text-[var(--danger)]" : "text-[var(--success)]"
            }`}
          >
            {trend === "up" ? "↑" : "↓"} {trendValue}%
          </span>
        )}
      </div>
    </div>
  );
}
