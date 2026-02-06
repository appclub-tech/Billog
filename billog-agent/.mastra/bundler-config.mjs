import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

const BILLOG_API_URL = process.env.BILLOG_API_URL || "http://localhost:3000";
function generateJwt(context) {
  const payload = {
    channel: context.channel,
    senderChannelId: context.senderChannelId,
    sourceChannelId: context.sourceChannelId,
    sourceType: context.sourceType || "GROUP",
    exp: Math.floor(Date.now() / 1e3) + 3600
    // 1 hour
  };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}
async function apiRequest(method, path, context, body) {
  const url = `${BILLOG_API_URL}/api${path}`;
  const jwt = generateJwt(context);
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`
    },
    body: body ? JSON.stringify(body) : void 0
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API Error ${response.status}: ${error}`);
  }
  return response.json();
}
const CATEGORIES = {
  Food: { nameTh: "\u0E2D\u0E32\u0E2B\u0E32\u0E23", icon: "\u{1F354}", keywords: ["lunch", "dinner", "breakfast", "restaurant", "meal", "snack", "coffee"] },
  Transport: { nameTh: "\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07", icon: "\u{1F697}", keywords: ["taxi", "grab", "bts", "mrt", "gas", "fuel", "uber"] },
  Groceries: { nameTh: "\u0E02\u0E2D\u0E07\u0E43\u0E0A\u0E49", icon: "\u{1F6D2}", keywords: ["7-11", "big c", "lotus", "supermarket", "mart"] },
  Utilities: { nameTh: "\u0E2A\u0E32\u0E18\u0E32\u0E23\u0E13\u0E39\u0E1B\u0E42\u0E20\u0E04", icon: "\u{1F4A1}", keywords: ["electric", "water", "internet", "phone", "bill"] },
  Entertainment: { nameTh: "\u0E1A\u0E31\u0E19\u0E40\u0E17\u0E34\u0E07", icon: "\u{1F3AC}", keywords: ["movie", "cinema", "game", "netflix", "concert"] },
  Shopping: { nameTh: "\u0E0A\u0E49\u0E2D\u0E1B\u0E1B\u0E34\u0E49\u0E07", icon: "\u{1F6CD}\uFE0F", keywords: ["clothes", "electronics", "online", "lazada", "shopee"] },
  Health: { nameTh: "\u0E2A\u0E38\u0E02\u0E20\u0E32\u0E1E", icon: "\u{1F48A}", keywords: ["medicine", "hospital", "clinic", "gym", "pharmacy"] },
  Education: { nameTh: "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", icon: "\u{1F4DA}", keywords: ["course", "book", "tutor", "school"] },
  Travel: { nameTh: "\u0E17\u0E48\u0E2D\u0E07\u0E40\u0E17\u0E35\u0E48\u0E22\u0E27", icon: "\u2708\uFE0F", keywords: ["hotel", "flight", "tour", "agoda", "booking"] },
  Housing: { nameTh: "\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E2D\u0E32\u0E28\u0E31\u0E22", icon: "\u{1F3E0}", keywords: ["rent", "repair", "furniture"] },
  Personal: { nameTh: "\u0E2A\u0E48\u0E27\u0E19\u0E15\u0E31\u0E27", icon: "\u{1F464}", keywords: ["haircut", "salon", "personal"] },
  Gift: { nameTh: "\u0E02\u0E2D\u0E07\u0E02\u0E27\u0E31\u0E0D", icon: "\u{1F381}", keywords: ["gift", "present", "donation"] },
  Other: { nameTh: "\u0E2D\u0E37\u0E48\u0E19\u0E46", icon: "\u{1F4E6}", keywords: [] }
};
function detectCategory(description) {
  const lower = description.toLowerCase();
  for (const [category, data] of Object.entries(CATEGORIES)) {
    if (data.keywords.some((keyword) => lower.includes(keyword))) {
      return category;
    }
  }
  return "Other";
}
function formatAmount(amount, currency = "THB") {
  const symbols = {
    THB: "\u0E3F",
    USD: "$",
    EUR: "\u20AC",
    JPY: "\xA5",
    AUD: "A$"
  };
  return `${symbols[currency] || currency}${amount.toLocaleString()}`;
}

const ExpenseItemSchema = z.object({
  name: z.string().describe("Item name"),
  nameEn: z.string().optional().describe("English translation of item name"),
  quantity: z.number().min(0).default(1).describe("Quantity purchased"),
  unitPrice: z.number().min(0).describe("Price per unit"),
  ingredientType: z.string().optional().describe("Type: meat, dairy, fruit, vegetable, grain, pet, etc"),
  assignedTo: z.string().optional().describe("Who this item is for: @nickname or @all")
});
const SplitTargetSchema = z.object({
  target: z.string().describe("Split target: @all, @nickname, or channel ID"),
  amount: z.number().optional().describe("Exact amount for this person"),
  percentage: z.number().min(0).max(100).optional().describe("Percentage for this person")
});
const createExpenseTool = createTool({
  id: "create-expense",
  description: `Create a new expense record. Use this when the user reports spending money.
Examples: "bought coffee 65", "lunch 500 @all", "grab home 120"
For receipts, extract items with prices and ingredient types for tracking.`,
  inputSchema: z.object({
    description: z.string().describe('What was purchased (e.g., "lunch at MK", "coffee", "7-Eleven groceries")'),
    amount: z.number().min(0).describe("Total amount spent"),
    currency: z.string().default("THB").describe("Currency code: THB, USD, EUR, JPY, AUD"),
    category: z.enum(["Food", "Transport", "Groceries", "Utilities", "Entertainment", "Shopping", "Health", "Education", "Travel", "Housing", "Personal", "Gift", "Other"]).optional().describe("Expense category - auto-detected if not provided"),
    items: z.array(ExpenseItemSchema).optional().describe("Line items from receipt"),
    splitType: z.enum(["equal", "exact", "percentage", "item"]).optional().describe("How to split: equal (divide equally), exact (specific amounts), percentage, item (by item assignment)"),
    splits: z.array(SplitTargetSchema).optional().describe("Who to split with"),
    notes: z.string().optional().describe("Additional notes"),
    // Context fields
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID"),
    sourceType: z.enum(["GROUP", "DM"]).default("GROUP").describe("Source type")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    expenseId: z.string().optional(),
    message: z.string(),
    splits: z.array(z.object({
      name: z.string(),
      amount: z.number()
    })).optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId,
      sourceType: input.sourceType
    };
    const category = input.category || detectCategory(input.description);
    const categoryData = CATEGORIES[category];
    try {
      const response = await apiRequest("POST", "/expenses", context, {
        channel: input.channel,
        senderChannelId: input.senderChannelId,
        sourceChannelId: input.sourceChannelId,
        sourceType: input.sourceType,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        categoryId: category,
        // API will resolve this
        splitType: input.splitType,
        splits: input.splits,
        items: input.items,
        notes: input.notes
      });
      const formattedAmount = formatAmount(response.expense.amount, response.expense.currency);
      let message = `\u2705 ${response.expense.description} | ${formattedAmount} | ${categoryData.icon} ${category}`;
      if (input.items?.length) {
        message += ` | ${input.items.length} items`;
      }
      message += `
   EX:${response.expense.id}`;
      const splitInfo = response.splits?.map((s) => ({
        name: s.name || "Unknown",
        amount: s.amount
      })) || [];
      if (splitInfo.length > 0) {
        message += "\n" + splitInfo.map(
          (s) => `   \u2192 @${s.name} owes ${formatAmount(s.amount, response.expense.currency)}`
        ).join("\n");
      }
      return {
        success: true,
        expenseId: response.expense.id,
        message,
        splits: splitInfo
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to record expense: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getExpensesTool = createTool({
  id: "get-expenses",
  description: `Query expense history. Use this when user asks "what did I spend", "show expenses", etc.`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID"),
    limit: z.number().min(1).max(50).default(10).describe("Number of expenses to return"),
    startDate: z.string().optional().describe("Filter from date (ISO format)"),
    endDate: z.string().optional().describe("Filter to date (ISO format)"),
    categoryId: z.string().optional().describe("Filter by category")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    expenses: z.array(z.object({
      id: z.string(),
      description: z.string(),
      amount: z.number(),
      currency: z.string(),
      date: z.string(),
      category: z.string().optional()
    })).optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      const params = new URLSearchParams();
      params.set("channel", input.channel);
      params.set("sourceChannelId", input.sourceChannelId);
      params.set("limit", (input.limit ?? 10).toString());
      if (input.startDate) params.set("startDate", input.startDate);
      if (input.endDate) params.set("endDate", input.endDate);
      if (input.categoryId) params.set("categoryId", input.categoryId);
      const response = await apiRequest("GET", `/expenses?${params}`, context);
      if (response.expenses.length === 0) {
        return {
          success: true,
          message: "No expenses found for this period.",
          expenses: []
        };
      }
      const total = response.expenses.reduce((sum, e) => sum + e.amount, 0);
      const currency = response.expenses[0]?.currency || "THB";
      let message = `\u{1F4CA} Recent Expenses (${response.expenses.length} items)
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      for (const expense of response.expenses) {
        const icon = expense.category?.icon || "\u{1F4E6}";
        const date = new Date(expense.date).toLocaleDateString("th-TH", { month: "short", day: "numeric" });
        message += `${icon} ${expense.description} | ${formatAmount(expense.amount, expense.currency)} | ${date}
`;
      }
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Total: ${formatAmount(total, currency)}`;
      return {
        success: true,
        message,
        expenses: response.expenses.map((e) => ({
          id: e.id,
          description: e.description,
          amount: e.amount,
          currency: e.currency,
          date: e.date,
          category: e.category?.name
        }))
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get expenses: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const deleteExpenseTool = createTool({
  id: "delete-expense",
  description: 'Delete an expense by ID. Use when user says "delete expense EX:xxx" or "remove that expense".',
  inputSchema: z.object({
    expenseId: z.string().describe("Expense ID (EX:xxx format, just the xxx part)"),
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      await apiRequest("DELETE", `/expenses/${input.expenseId}`, context);
      return {
        success: true,
        message: `\u2705 Expense EX:${input.expenseId} deleted`
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to delete expense: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

const getBalancesTool = createTool({
  id: "get-balances",
  description: `Get group balances showing who owes whom. Use when user asks:
- "who owes what"
- "show balances"
- "\u0E43\u0E04\u0E23\u0E40\u0E1B\u0E47\u0E19\u0E2B\u0E19\u0E35\u0E49\u0E43\u0E04\u0E23"
- "check debts"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID"),
    currency: z.string().default("THB").describe("Currency to show balances in")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    balances: z.array(z.object({
      from: z.string(),
      to: z.string(),
      amount: z.number()
    })).optional(),
    members: z.array(z.object({
      name: z.string(),
      net: z.number()
    })).optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      const params = new URLSearchParams();
      params.set("channel", input.channel);
      params.set("sourceChannelId", input.sourceChannelId);
      params.set("currency", input.currency ?? "THB");
      const response = await apiRequest("GET", `/balances?${params}`, context);
      if (response.balances.length === 0) {
        return {
          success: true,
          message: "\u2705 No outstanding balances - everyone is settled!",
          balances: [],
          members: []
        };
      }
      let message = `\u{1F4B0} Group Balances (${input.currency})
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      for (const balance of response.balances) {
        message += `@${balance.from.name} owes @${balance.to.name} ${formatAmount(balance.amount, balance.currency)}
`;
      }
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Net: `;
      message += response.members.map((m) => `${m.nickname || m.name} ${m.net >= 0 ? "+" : ""}${formatAmount(m.net, input.currency)}`).join(" | ");
      return {
        success: true,
        message,
        balances: response.balances.map((b) => ({
          from: b.from.name,
          to: b.to.name,
          amount: b.amount
        })),
        members: response.members.map((m) => ({
          name: m.nickname || m.name,
          net: m.net
        }))
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get balances: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getSpendingSummaryTool = createTool({
  id: "get-spending-summary",
  description: `Get spending summary for a period. Use when user asks:
- "how much did we spend this month"
- "spending summary"
- "what did tom spend"
- "\u0E2A\u0E23\u0E38\u0E1B\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID"),
    period: z.enum(["day", "week", "month", "year"]).default("month").describe("Time period")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    summary: z.object({
      total: z.number(),
      count: z.number(),
      byCategory: z.record(z.number()),
      byPayer: z.array(z.object({
        name: z.string(),
        total: z.number()
      }))
    }).optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      const period = input.period ?? "month";
      const params = new URLSearchParams();
      params.set("channel", input.channel);
      params.set("sourceChannelId", input.sourceChannelId);
      params.set("period", period);
      const response = await apiRequest("GET", `/insights/summary?${params}`, context);
      if (response.count === 0) {
        return {
          success: true,
          message: `\u{1F4CA} No spending recorded for this ${period}.`
        };
      }
      const periodLabels = {
        day: "Today's",
        week: "This Week's",
        month: "This Month's",
        year: "This Year's"
      };
      let message = `\u{1F4CA} ${periodLabels[period]} Spending
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Total: ${formatAmount(response.total, response.currency)} (${response.count} expenses)

`;
      if (Object.keys(response.byCategory).length > 0) {
        message += `By Category:
`;
        const sortedCategories = Object.entries(response.byCategory).sort(([, a], [, b]) => b - a);
        for (const [category, amount] of sortedCategories) {
          const percentage = Math.round(amount / response.total * 100);
          message += `\u2022 ${category}: ${formatAmount(amount, response.currency)} (${percentage}%)
`;
        }
      }
      if (response.byPayer.length > 0) {
        message += `
By Payer:
`;
        for (const payer of response.byPayer) {
          message += `\u2022 ${payer.name}: ${formatAmount(payer.total, response.currency)}
`;
        }
      }
      return {
        success: true,
        message,
        summary: {
          total: response.total,
          count: response.count,
          byCategory: response.byCategory,
          byPayer: response.byPayer.map((p) => ({ name: p.name, total: p.total }))
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get summary: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getMyBalanceTool = createTool({
  id: "get-my-balance",
  description: `Get user's personal balance across all sources. Use when user asks:
- "my balance"
- "what do I owe"
- "\u0E22\u0E2D\u0E14\u0E02\u0E2D\u0E07\u0E09\u0E31\u0E19"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      const response = await apiRequest("GET", "/users/me", context);
      if (response.sources.length === 0) {
        return {
          success: true,
          message: `\u{1F4B0} @${response.user.name} - No active sources yet.`
        };
      }
      let message = `\u{1F4B0} @${response.user.name}'s Balance
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      for (const source of response.sources) {
        const status = source.net >= 0 ? "owed to you" : "you owe";
        message += `\u2022 ${source.name}: ${formatAmount(Math.abs(source.net), source.currency)} ${status}
`;
      }
      const totalsByCurrency = response.sources.reduce((acc, s) => {
        acc[s.currency] = (acc[s.currency] || 0) + s.net;
        return acc;
      }, {});
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Net: `;
      message += Object.entries(totalsByCurrency).map(([currency, net]) => `${net >= 0 ? "+" : ""}${formatAmount(net, currency)}`).join(", ");
      return {
        success: true,
        message
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get balance: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

const PAYMENT_METHODS = {
  1: "Cash",
  2: "Bank Transfer",
  3: "PromptPay",
  4: "Credit Card",
  5: "E-Wallet",
  99: "Other"
};
const recordSettlementTool = createTool({
  id: "record-settlement",
  description: `Record a payment/settlement between users. Use when:
- "tom paid me 350"
- "paid jerry 200 via promptpay"
- "received 500 from wife"
- "@tom \u0E08\u0E48\u0E32\u0E22\u0E41\u0E25\u0E49\u0E27 350"

Direction:
- "X paid me" \u2192 from=X, to=me (I received)
- "I paid X" \u2192 from=me, to=X (I gave)
- "X paid Y" \u2192 from=X, to=Y (third-party)`,
  inputSchema: z.object({
    fromTarget: z.string().describe('Who paid: @nickname, channel ID, or "me"'),
    toTarget: z.string().describe('Who received: @nickname, channel ID, or "me"'),
    amount: z.number().min(0).describe("Amount paid"),
    currency: z.string().default("THB").describe("Currency code"),
    paymentMethod: z.number().optional().describe("Payment method: 1=Cash, 2=Bank, 3=PromptPay, 4=Card, 5=E-Wallet"),
    // Context
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe('User channel ID (used for "me")'),
    sourceChannelId: z.string().describe("Group/DM channel ID")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    remainingBalance: z.number().optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    const fromChannelId = input.fromTarget === "me" ? input.senderChannelId : input.fromTarget;
    const toChannelId = input.toTarget === "me" ? input.senderChannelId : input.toTarget;
    try {
      const response = await apiRequest("POST", "/settlements", context, {
        channel: input.channel,
        sourceChannelId: input.sourceChannelId,
        senderChannelId: input.senderChannelId,
        fromChannelId,
        toChannelId,
        amount: input.amount,
        currency: input.currency,
        paymentMethod: input.paymentMethod
      });
      const { settlement, remainingBalance } = response;
      const methodName = input.paymentMethod ? PAYMENT_METHODS[input.paymentMethod] || "Other" : null;
      let message = `\u2705 Settlement recorded
`;
      message += `@${settlement.from.name} paid @${settlement.to.name} ${formatAmount(settlement.amount, settlement.currency)}`;
      if (methodName) {
        message += ` via ${methodName}`;
      }
      message += "\n";
      if (remainingBalance === 0) {
        message += `Remaining: ${formatAmount(0, settlement.currency)} \u2713 All settled!`;
      } else if (remainingBalance > 0) {
        message += `Remaining: ${formatAmount(remainingBalance, settlement.currency)} still owed`;
      } else {
        message += `Remaining: ${formatAmount(Math.abs(remainingBalance), settlement.currency)} overpaid (credit)`;
      }
      return {
        success: true,
        message,
        remainingBalance
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to record settlement: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

const MemberInputSchema = z.object({
  channelId: z.string().describe("User channel ID"),
  displayName: z.string().optional().describe("Display name")
});
const initSourceTool = createTool({
  id: "init-source",
  description: `Initialize a source (group/DM) for expense tracking. Use when:
- First interaction in a new group
- Bot added to a group
- User explicitly asks to set up billog
This is usually called automatically on first expense.`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    sourceChannelId: z.string().describe("Group/DM channel ID"),
    sourceType: z.enum(["GROUP", "DM"]).default("GROUP").describe("Source type"),
    sourceName: z.string().optional().describe("Group name"),
    senderChannelId: z.string().describe("User channel ID"),
    senderDisplayName: z.string().optional().describe("User display name"),
    members: z.array(MemberInputSchema).optional().describe("Initial member list (for WhatsApp)"),
    currency: z.string().default("THB").describe("Default currency")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    isNewSource: z.boolean().optional(),
    isNewUser: z.boolean().optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId,
      sourceType: input.sourceType
    };
    try {
      const response = await apiRequest("POST", "/sources/init", context, {
        channel: input.channel,
        sourceChannelId: input.sourceChannelId,
        sourceType: input.sourceType,
        sourceName: input.sourceName,
        senderChannelId: input.senderChannelId,
        senderDisplayName: input.senderDisplayName,
        members: input.members,
        currency: input.currency
      });
      const { source, user, isNewSource, isNewUser } = response;
      let message;
      if (isNewSource) {
        message = `\u2705 \u0E01\u0E25\u0E38\u0E48\u0E21\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27!
`;
        message += `   Source: ${source.name}
`;
        message += `   \u0E2A\u0E21\u0E32\u0E0A\u0E34\u0E01: ${source.memberCount} \u0E04\u0E19

`;
        message += `   \u0E1E\u0E34\u0E21\u0E1E\u0E4C "\u0E0A\u0E48\u0E27\u0E22\u0E14\u0E49\u0E27\u0E22" \u0E2B\u0E23\u0E37\u0E2D "help" \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E14\u0E39\u0E04\u0E33\u0E2A\u0E31\u0E48\u0E07`;
      } else if (isNewUser) {
        message = `\u2705 \u0E25\u0E07\u0E17\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08!
`;
        message += `   \u0E0A\u0E37\u0E48\u0E2D: ${user.name}
`;
        if (user.nickname) {
          message += `   \u0E23\u0E2B\u0E31\u0E2A: @${user.nickname}
`;
        }
        message += `
   \u0E40\u0E23\u0E34\u0E48\u0E21\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22 \u0E40\u0E0A\u0E48\u0E19 "\u0E01\u0E32\u0E41\u0E1F 65"`;
      } else {
        message = `\u2705 \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27
`;
        message += `   Source: ${source.name} (${source.memberCount} \u0E04\u0E19)`;
      }
      return {
        success: true,
        message,
        isNewSource,
        isNewUser
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to initialize: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const syncMembersTool = createTool({
  id: "sync-members",
  description: `Sync group members with the API. Use for WhatsApp/Telegram groups to update @all targeting.`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group channel ID"),
    members: z.array(MemberInputSchema).describe("Current member list")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    summary: z.object({
      added: z.number(),
      updated: z.number(),
      deactivated: z.number(),
      total: z.number()
    }).optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      const sourceResponse = await apiRequest("GET", `/sources?channel=${input.channel}&channelId=${input.sourceChannelId}`, context);
      if (!sourceResponse.source) {
        return {
          success: false,
          message: "\u274C Source not found. Initialize first."
        };
      }
      const response = await apiRequest("POST", `/sources/${sourceResponse.source.id}/sync-members`, context, {
        channel: input.channel,
        members: input.members
      });
      const { summary } = response;
      let message = `\u2705 Members synced
`;
      message += `   Added: ${summary.added}
`;
      message += `   Updated: ${summary.updated}
`;
      message += `   Deactivated: ${summary.deactivated}
`;
      message += `   Total: ${summary.total}`;
      return {
        success: true,
        message,
        summary
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to sync members: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const setNicknameTool = createTool({
  id: "set-nickname",
  description: `Set a user's nickname for @mentions. Use when:
- "\u0E15\u0E31\u0E49\u0E07\u0E0A\u0E37\u0E48\u0E2D\u0E40\u0E25\u0E48\u0E19 boss"
- "call me boss"
- "set nickname tom"`,
  inputSchema: z.object({
    nickname: z.string().describe("New nickname (without @)"),
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      await apiRequest("PATCH", "/users/me", context, {
        nickname: input.nickname
      });
      return {
        success: true,
        message: `\u2705 \u0E15\u0E31\u0E49\u0E07\u0E0A\u0E37\u0E48\u0E2D\u0E40\u0E25\u0E48\u0E19\u0E41\u0E25\u0E49\u0E27: @${input.nickname}`
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to set nickname: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

const bundler = {};

export { CATEGORIES, bundler, createExpenseTool, deleteExpenseTool, detectCategory, formatAmount, getBalancesTool, getExpensesTool, getMyBalanceTool, getSpendingSummaryTool, initSourceTool, recordSettlementTool, setNicknameTool, syncMembersTool };
