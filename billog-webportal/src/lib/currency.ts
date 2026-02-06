/**
 * Currency utility functions
 */

const CURRENCY_SYMBOLS: Record<string, string> = {
  THB: "฿",
  USD: "$",
  AUD: "A$",
  EUR: "€",
  GBP: "£",
  SGD: "S$",
  JPY: "¥",
  NZD: "NZ$",
  HKD: "HK$",
};

/**
 * Get currency symbol from currency code
 */
export function getCurrencySymbol(currency?: string): string {
  if (!currency) return "฿"; // Default to THB
  return CURRENCY_SYMBOLS[currency.toUpperCase()] || currency;
}

/**
 * Format amount with currency symbol
 */
export function formatCurrency(amount: number, currency?: string): string {
  const symbol = getCurrencySymbol(currency);
  return `${symbol}${amount.toLocaleString()}`;
}
