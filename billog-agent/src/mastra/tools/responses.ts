/**
 * Response Templates (English only)
 * Agent uses interpreter skill to translate to user's language
 * Item names, store names, and nicknames are NOT translated
 */

/**
 * Response templates for different actions
 */
export const TEMPLATES = {
  // Expense creation
  expenseCreated: (data: { description: string; amount: string; category: string; id: string }) =>
    `${data.description} | ${data.amount}\nCategory: ${data.category}\nEX:${data.id}`,

  // Expense with items (receipt)
  expenseWithItems: (data: {
    description: string;
    amount: string;
    category: string;
    date?: string;
    items: string;
    payment?: string;
    id: string;
  }) =>
    `${data.description} | ${data.amount}\nCategory: ${data.category}${data.date ? `\n${data.date}` : ''}\n───────────\n${data.items}───────────${data.payment ? `\nPaid: ${data.payment}` : ''}\nEX:${data.id}`,

  // Expense with split
  expenseWithSplit: (data: {
    description: string;
    amount: string;
    category: string;
    splitCount: number;
    eachAmount: string;
    splits: string;
    id: string;
  }) =>
    `${data.description} | ${data.amount}\nCategory: ${data.category}\nSplit ${data.splitCount} ways (${data.eachAmount} each)\n${data.splits}EX:${data.id}`,

  // Split line
  splitLine: (data: { name: string; amount: string }) => `   → @${data.name} owes ${data.amount}`,

  // Item line (no translation needed - item names kept as-is)
  itemLine: (data: { name: string; qty: number; unitPrice: string; total: string }) =>
    `- ${data.name} x${data.qty} @ ${data.unitPrice} = ${data.total}\n`,

  // Balance check
  balances: (data: { balances: string }) => `Outstanding balances:\n${data.balances}`,

  balanceLine: (data: { name: string; amount: string }) => `- @${data.name} owes ${data.amount}`,

  noBalances: () => 'No outstanding balances. Everyone is settled up!',

  // Settlement
  settlementRecorded: (data: { from: string; to: string; amount: string }) =>
    `Settlement recorded: @${data.from} paid @${data.to} ${data.amount}`,

  // Expense deleted
  expenseDeleted: (data: { id: string }) => `Deleted EX:${data.id}`,

  // Expense history
  expenseHistory: (data: { count: number; expenses: string; total: string }) =>
    `Recent Expenses (${data.count} items)\n───────────\n${data.expenses}───────────\nTotal: ${data.total}`,

  expenseHistoryLine: (data: { description: string; amount: string; category: string; date: string }) =>
    `- ${data.description} | ${data.amount} | ${data.category} | ${data.date}\n`,

  noExpenses: () => 'No expenses found for this period.',

  // Spending summary
  spendingSummary: (data: { period: string; total: string; breakdown: string }) =>
    `Spending Summary ${data.period}\n───────────\n${data.breakdown}───────────\nTotal: ${data.total}`,

  // Errors
  error: (data: { reason: string }) => `Error: ${data.reason}`,

  notReceipt: () => "This doesn't look like a receipt. Please send a photo of your bill/receipt.",

  // General
  success: () => 'Success',

  // Payment method formatting
  paymentMethod: (data: { method: string; cardType?: string; last4?: string; bank?: string }) => {
    let str = data.method;
    if (data.cardType && data.last4) str += ` (${data.cardType} **${data.last4})`;
    else if (data.last4) str += ` (**${data.last4})`;
    if (data.bank) str += ` - ${data.bank}`;
    return str;
  },
} as const;

/**
 * Response builder class for complex responses
 */
export class ResponseBuilder {
  /**
   * Build expense created response
   */
  expenseCreated(data: {
    description: string;
    amount: string;
    category: string;
    id: string;
    date?: string;
    items?: Array<{ name: string; qty: number; unitPrice: string; total: string }>;
    payment?: { method: string; cardType?: string; last4?: string; bank?: string };
    splits?: Array<{ name: string; amount: string }>;
  }): string {
    // Simple expense (no items, no split)
    if (!data.items?.length && !data.splits?.length) {
      return TEMPLATES.expenseCreated(data);
    }

    // With items (receipt)
    if (data.items?.length) {
      const itemsStr = data.items.map(item => TEMPLATES.itemLine(item)).join('');
      const paymentStr = data.payment ? TEMPLATES.paymentMethod(data.payment) : undefined;

      let response = TEMPLATES.expenseWithItems({
        description: data.description,
        amount: data.amount,
        category: data.category,
        date: data.date,
        items: itemsStr,
        payment: paymentStr,
        id: data.id,
      });

      // Add splits if present
      if (data.splits?.length) {
        const splitsStr = data.splits.map(s => TEMPLATES.splitLine(s)).join('\n');
        response = response.replace(`EX:${data.id}`, `${splitsStr}\nEX:${data.id}`);
      }

      return response;
    }

    // With split (no items)
    if (data.splits?.length) {
      const splitsStr = data.splits.map(s => TEMPLATES.splitLine(s)).join('\n') + '\n';
      const totalAmount = parseFloat(data.amount.replace(/[^0-9.]/g, ''));
      const eachAmount = (totalAmount / data.splits.length).toFixed(2);
      const currency = data.amount.match(/[^\d.,\s]+/)?.[0] || '';

      return TEMPLATES.expenseWithSplit({
        description: data.description,
        amount: data.amount,
        category: data.category,
        splitCount: data.splits.length,
        eachAmount: `${currency}${eachAmount}`,
        splits: splitsStr,
        id: data.id,
      });
    }

    return TEMPLATES.expenseCreated(data);
  }
}

/**
 * Default response builder
 */
export const responses = new ResponseBuilder();
