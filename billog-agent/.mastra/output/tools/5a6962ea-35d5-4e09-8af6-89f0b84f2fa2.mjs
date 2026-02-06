import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { detectCategory, apiRequest, formatAmount, CATEGORIES } from './68251daa-bc82-4965-8592-33499397cad4.mjs';

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

export { createExpenseTool, deleteExpenseTool, getExpensesTool };
