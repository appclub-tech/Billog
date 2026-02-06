// ============================================
// TIGERBEETLE-COMPATIBLE LEDGER CONSTANTS
// ============================================

// Ledger codes (currency partitions) - TigerBeetle pattern
export const LEDGER = {
  THB: 1,
  USD: 2,
  AUD: 3,
  EUR: 4,
  JPY: 5,
} as const;

export type LedgerCode = (typeof LEDGER)[keyof typeof LEDGER];

// Currency string to ledger code mapping
export const CURRENCY_TO_LEDGER: Record<string, LedgerCode> = {
  THB: LEDGER.THB,
  USD: LEDGER.USD,
  AUD: LEDGER.AUD,
  EUR: LEDGER.EUR,
  JPY: LEDGER.JPY,
};

// Ledger code to currency string mapping
export const LEDGER_TO_CURRENCY: Record<LedgerCode, string> = {
  [LEDGER.THB]: 'THB',
  [LEDGER.USD]: 'USD',
  [LEDGER.AUD]: 'AUD',
  [LEDGER.EUR]: 'EUR',
  [LEDGER.JPY]: 'JPY',
};

// Account codes (standard accounting) - TigerBeetle pattern
export const ACCOUNT_CODE = {
  ASSET: 100, // Money owed TO user (receivables)
  LIABILITY: 200, // Money user OWES (payables)
  EXPENSE: 300, // Spending tracking
  INCOME: 400, // Income tracking
  EQUITY: 500, // Balancing entries
} as const;

export type AccountCode = (typeof ACCOUNT_CODE)[keyof typeof ACCOUNT_CODE];

// Transfer codes - TigerBeetle pattern
export const TRANSFER_CODE = {
  EXPENSE_SPLIT: 1, // Expense creates debt
  SETTLEMENT: 2, // Payment clears debt
  ADJUSTMENT: 3, // Manual correction
  REVERSAL: 4, // Undo a transfer
  POOL_CONTRIBUTION: 5, // Pool payment
  POOL_WITHDRAWAL: 6, // Pool expense
} as const;

export type TransferCode = (typeof TRANSFER_CODE)[keyof typeof TRANSFER_CODE];

// Account flags (bitmask) - EXACT TigerBeetle flags
export const ACCOUNT_FLAGS = {
  NONE: 0,
  LINKED: 1 << 0, // 0x0001
  DEBITS_MUST_NOT_EXCEED_CREDITS: 1 << 1, // 0x0002
  CREDITS_MUST_NOT_EXCEED_DEBITS: 1 << 2, // 0x0004
  HISTORY: 1 << 3, // 0x0008
  IMPORTED: 1 << 4, // 0x0010
  CLOSED: 1 << 5, // 0x0020
} as const;

// Transfer flags (bitmask) - EXACT TigerBeetle flags
export const TRANSFER_FLAGS = {
  NONE: 0,
  LINKED: 1 << 0, // 0x0001
  PENDING: 1 << 1, // 0x0002
  POST_PENDING_TRANSFER: 1 << 2, // 0x0004
  VOID_PENDING_TRANSFER: 1 << 3, // 0x0008
  BALANCING_DEBIT: 1 << 4, // 0x0010
  BALANCING_CREDIT: 1 << 5, // 0x0020
  CLOSING_DEBIT: 1 << 6, // 0x0040
  CLOSING_CREDIT: 1 << 7, // 0x0080
  IMPORTED: 1 << 8, // 0x0100
} as const;

// Payment method codes (for settlement user_data_32)
export const PAYMENT_METHOD = {
  CASH: 1,
  BANK_TRANSFER: 2,
  PROMPTPAY: 3,
  CREDIT_CARD: 4,
  EWALLET: 5,
  OTHER: 99,
} as const;

// Helper to convert currency string to ledger code
export function currencyToLedger(currency: string): LedgerCode {
  const ledger = CURRENCY_TO_LEDGER[currency.toUpperCase()];
  if (!ledger) {
    throw new Error(`Unknown currency: ${currency}`);
  }
  return ledger;
}

// Helper to convert ledger code to currency string
export function ledgerToCurrency(ledger: LedgerCode): string {
  const currency = LEDGER_TO_CURRENCY[ledger];
  if (!currency) {
    throw new Error(`Unknown ledger code: ${ledger}`);
  }
  return currency;
}

// Helper to format user_data_128 (userId:sourceId)
export function formatUserData128(userId: string, sourceId: string): string {
  return `${userId}:${sourceId}`;
}

// Helper to parse user_data_128
export function parseUserData128(data: string): { userId: string; sourceId: string } {
  const [userId, sourceId] = data.split(':');
  if (!userId || !sourceId) {
    throw new Error(`Invalid user_data_128 format: ${data}`);
  }
  return { userId, sourceId };
}

// Helper to get current timestamp in nanoseconds
export function getNanoTimestamp(): bigint {
  return BigInt(Date.now()) * BigInt(1_000_000);
}
