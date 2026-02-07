const TEMPLATES = {
  // Expense creation
  expenseCreated: (data) => `${data.description} | ${data.amount}
Category: ${data.category}
EX:${data.id}`,
  // Expense with items (receipt)
  expenseWithItems: (data) => `${data.description} | ${data.amount}
Category: ${data.category}${data.date ? `
${data.date}` : ""}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.items}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${data.payment ? `
Paid: ${data.payment}` : ""}
EX:${data.id}`,
  // Expense with split
  expenseWithSplit: (data) => `${data.description} | ${data.amount}
Category: ${data.category}
Split ${data.splitCount} ways (${data.eachAmount} each)
${data.splits}EX:${data.id}`,
  // Split line
  splitLine: (data) => `   \u2192 @${data.name} owes ${data.amount}`,
  // Item line (no translation needed - item names kept as-is)
  itemLine: (data) => `- ${data.name} x${data.qty} @ ${data.unitPrice} = ${data.total}
`,
  // Balance check
  balances: (data) => `Outstanding balances:
${data.balances}`,
  balanceLine: (data) => `- @${data.name} owes ${data.amount}`,
  noBalances: () => "No outstanding balances. Everyone is settled up!",
  // Settlement
  settlementRecorded: (data) => `Settlement recorded: @${data.from} paid @${data.to} ${data.amount}`,
  // Expense deleted
  expenseDeleted: (data) => `Deleted EX:${data.id}`,
  // Expense history
  expenseHistory: (data) => `Recent Expenses (${data.count} items)
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.expenses}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Total: ${data.total}`,
  expenseHistoryLine: (data) => `- ${data.description} | ${data.amount} | ${data.category} | ${data.date}
`,
  noExpenses: () => "No expenses found for this period.",
  // Spending summary
  spendingSummary: (data) => `Spending Summary ${data.period}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.breakdown}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Total: ${data.total}`,
  // Errors
  error: (data) => `Error: ${data.reason}`,
  notReceipt: () => "This doesn't look like a receipt. Please send a photo of your bill/receipt.",
  // General
  success: () => "Success",
  // Payment method formatting
  paymentMethod: (data) => {
    let str = data.method;
    if (data.cardType && data.last4) str += ` (${data.cardType} **${data.last4})`;
    else if (data.last4) str += ` (**${data.last4})`;
    if (data.bank) str += ` - ${data.bank}`;
    return str;
  }
};
class ResponseBuilder {
  /**
   * Build expense created response
   */
  expenseCreated(data) {
    if (!data.items?.length && !data.splits?.length) {
      return TEMPLATES.expenseCreated(data);
    }
    if (data.items?.length) {
      const itemsStr = data.items.map((item) => TEMPLATES.itemLine(item)).join("");
      const paymentStr = data.payment ? TEMPLATES.paymentMethod(data.payment) : void 0;
      let response = TEMPLATES.expenseWithItems({
        description: data.description,
        amount: data.amount,
        category: data.category,
        date: data.date,
        items: itemsStr,
        payment: paymentStr,
        id: data.id
      });
      if (data.splits?.length) {
        const splitsStr = data.splits.map((s) => TEMPLATES.splitLine(s)).join("\n");
        response = response.replace(`EX:${data.id}`, `${splitsStr}
EX:${data.id}`);
      }
      return response;
    }
    if (data.splits?.length) {
      const splitsStr = data.splits.map((s) => TEMPLATES.splitLine(s)).join("\n") + "\n";
      const totalAmount = parseFloat(data.amount.replace(/[^0-9.]/g, ""));
      const eachAmount = (totalAmount / data.splits.length).toFixed(2);
      const currency = data.amount.match(/[^\d.,\s]+/)?.[0] || "";
      return TEMPLATES.expenseWithSplit({
        description: data.description,
        amount: data.amount,
        category: data.category,
        splitCount: data.splits.length,
        eachAmount: `${currency}${eachAmount}`,
        splits: splitsStr,
        id: data.id
      });
    }
    return TEMPLATES.expenseCreated(data);
  }
}
const responses = new ResponseBuilder();

export { ResponseBuilder, TEMPLATES, responses };
