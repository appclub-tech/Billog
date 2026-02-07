import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { detectCategory, apiRequest, formatAmount } from './5aaadd57-6742-4f80-91d8-d525c91493b6.mjs';
import { i as isVectorStoreConfigured, a as saveExpenseItemEmbeddings } from '../expense-item-vector.mjs';
import 'jsonwebtoken';
import '@upstash/vector';

const ExpenseItemSchema = z.object({
  name: z.string().describe("Item name in English (default language)"),
  nameLocalized: z.string().optional().describe("Original language name (Thai, Japanese, etc.)"),
  quantity: z.number().min(0).default(1).describe("Quantity purchased"),
  unitPrice: z.number().min(0).describe("Price per unit"),
  ingredientType: z.string().optional().describe("Type: meat, seafood, dairy, fruit, vegetable, frozen, bakery, beverage, snack, grain, condiment, canned, household, baby, pet, health, other"),
  assignedTo: z.string().optional().describe("Who this item is for: @nickname or @all")
});
const SplitTargetSchema = z.object({
  target: z.string().describe("Split target: @all, @nickname, or channel ID"),
  amount: z.number().optional().describe("Exact amount for this person"),
  percentage: z.number().min(0).max(100).optional().describe("Percentage for this person")
});
const createExpenseTool = createTool({
  id: "create-expense",
  description: `Create a new expense record and SAVE it to the database.
IMPORTANT: This is the ONLY tool that saves expense data. Always call this after extract-receipt.
Returns: expenseId (required to confirm the record was saved)
Examples: "bought coffee 65", "lunch 500 @all", "grab home 120"
For receipts: pass receiptData from extract-receipt to link the receipt.`,
  inputSchema: z.object({
    description: z.string().describe('What was purchased (e.g., "lunch at MK", "coffee", "7-Eleven groceries")'),
    amount: z.number().min(0).describe("Total amount spent"),
    currency: z.string().default("THB").describe("Currency code: THB, USD, EUR, JPY, AUD"),
    category: z.enum(["Food", "Transport", "Groceries", "Utilities", "Entertainment", "Shopping", "Health", "Education", "Travel", "Housing", "Personal", "Gift", "Other"]).optional().describe("Expense category - auto-detected if not provided"),
    items: z.array(ExpenseItemSchema).optional().describe("Line items from receipt"),
    splitType: z.enum(["equal", "exact", "percentage", "item"]).optional().describe("How to split: equal (divide equally), exact (specific amounts), percentage, item (by item assignment)"),
    splits: z.array(SplitTargetSchema).optional().describe("Who to split with"),
    notes: z.string().optional().describe("Additional notes"),
    // Payment info from receipt
    payment: z.object({
      method: z.string().nullable().describe("Cash, Credit, Debit, QR, PromptPay, etc."),
      cardType: z.string().nullable().describe("VISA, Mastercard, JCB, etc."),
      cardLast4: z.string().nullable().describe("Last 4 digits"),
      bankName: z.string().nullable().describe("Bank name"),
      approvalCode: z.string().nullable().describe("Approval code")
    }).optional().describe("Payment method info from receipt"),
    // Receipt metadata
    metadata: z.object({
      receiptNo: z.string().nullable(),
      taxId: z.string().nullable(),
      branch: z.string().nullable(),
      cashier: z.string().nullable(),
      transactionTime: z.string().nullable(),
      transactionDate: z.string().nullable()
    }).optional().describe("Additional receipt metadata"),
    // Receipt data from OCR (creates Receipt record after expense)
    receiptData: z.object({
      imageUrl: z.string().optional().describe("Receipt image URL"),
      storeName: z.string().optional().describe("Store name"),
      storeAddress: z.string().optional().describe("Store address"),
      subtotal: z.number().optional().describe("Subtotal before tax"),
      tax: z.number().optional().describe("Tax amount"),
      total: z.number().optional().describe("Total amount"),
      rawOcrData: z.record(z.unknown()).optional().describe("Raw OCR data for debugging"),
      confidence: z.number().optional().describe("OCR confidence score")
    }).optional().describe("Receipt OCR data - creates Receipt record after expense"),
    // Transaction date (from receipt)
    date: z.string().optional().describe("Transaction date in YYYY-MM-DD format (from receipt, defaults to today)"),
    // User preferences
    userLanguage: z.enum(["th", "en"]).default("th").describe("User language preference for response formatting"),
    // Context fields (optional - auto-injected from RequestContext if not provided)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)"),
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
  execute: async (input, ctx) => {
    const reqCtx = ctx?.requestContext;
    const channel = input.channel || reqCtx?.get("channel");
    const senderChannelId = input.senderChannelId || reqCtx?.get("senderChannelId");
    const sourceChannelId = input.sourceChannelId || reqCtx?.get("sourceChannelId");
    const sourceType = input.sourceType || (reqCtx?.get("isGroup") ? "GROUP" : "DM");
    console.log(`
${"=".repeat(60)}`);
    console.log(`[TOOL] \u{1F527} create-expense CALLED`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Description: ${input.description}`);
    console.log(`  Amount:      ${input.amount} ${input.currency}`);
    console.log(`  Items:       ${input.items?.length || 0}`);
    console.log(`  Payment:     ${JSON.stringify(input.payment || null)}`);
    console.log(`  Context:     ${channel}/${senderChannelId}/${sourceChannelId}`);
    console.log(`${"=".repeat(60)}
`);
    if (!channel || !senderChannelId || !sourceChannelId) {
      console.error(`[TOOL] \u274C create-expense FAILED: Missing context`);
      return {
        success: false,
        message: "ERROR: Cannot save expense - missing chat context. Please try again."
      };
    }
    const context = {
      channel,
      senderChannelId,
      sourceChannelId,
      sourceType
    };
    const category = input.category || detectCategory(input.description);
    try {
      const expenseMetadata = {};
      if (input.payment) {
        expenseMetadata.payment = input.payment;
      }
      if (input.metadata) {
        Object.assign(expenseMetadata, input.metadata);
      }
      const expenseDate = input.date || input.metadata?.transactionDate || void 0;
      const expenseItems = input.items && input.items.length > 0 ? input.items : [{
        name: input.description,
        quantity: 1,
        unitPrice: input.amount
      }];
      const response = await apiRequest("POST", "/expenses", context, {
        channel,
        senderChannelId,
        sourceChannelId,
        sourceType,
        description: input.description,
        amount: input.amount,
        currency: input.currency,
        date: expenseDate,
        // categoryId omitted - API defaults to "Other"
        // TODO: implement category name-to-ID resolution
        splitType: input.splitType,
        splits: input.splits,
        items: expenseItems,
        notes: input.notes,
        metadata: Object.keys(expenseMetadata).length > 0 ? expenseMetadata : void 0,
        // Receipt data from OCR - creates Receipt record after expense
        receiptData: input.receiptData
      });
      if (!response.expense?.id) {
        console.error(`[TOOL] \u274C create-expense FAILED: No expenseId in response`);
        return {
          success: false,
          message: "ERROR: Expense was not saved. The server did not return an expense ID. Please try again."
        };
      }
      console.log(`[TOOL] \u2705 create-expense SUCCESS: EX:${response.expense.id}`);
      if (isVectorStoreConfigured()) {
        const vectorDate = response.expense.date || (/* @__PURE__ */ new Date()).toISOString();
        const paidBy = senderChannelId;
        saveExpenseItemEmbeddings(
          response.expense.id,
          expenseItems.map((item) => ({
            name: item.name,
            nameLocalized: item.nameLocalized,
            quantity: item.quantity || 1,
            unit: void 0,
            // Not in current schema
            unitPrice: item.unitPrice,
            totalPrice: (item.quantity || 1) * item.unitPrice
          })),
          sourceChannelId,
          vectorDate,
          paidBy
        ).catch((err) => console.error("[Vector] Embedding save error:", err));
      }
      const formattedAmount = formatAmount(response.expense.amount, response.expense.currency);
      let message = `${response.expense.description} | ${formattedAmount}`;
      message += `
Category: ${category}`;
      if (expenseDate) {
        const dateObj = new Date(expenseDate);
        const today = /* @__PURE__ */ new Date();
        const isToday = dateObj.toDateString() === today.toDateString();
        if (!isToday) {
          const formattedDate = dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
          message += `
Date: ${formattedDate}`;
        }
      }
      if (input.items?.length) {
        message += `
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;
        for (const item of input.items) {
          const qty = item.quantity || 1;
          const lineTotal = qty * item.unitPrice;
          message += `
- ${item.name} x${qty} @ ${formatAmount(item.unitPrice, response.expense.currency)} = ${formatAmount(lineTotal, response.expense.currency)}`;
        }
        message += `
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;
      }
      if (input.payment?.method) {
        let paymentStr = `Paid: ${input.payment.method}`;
        if (input.payment.cardType && input.payment.cardLast4) {
          paymentStr += ` (${input.payment.cardType} **${input.payment.cardLast4})`;
        } else if (input.payment.cardLast4) {
          paymentStr += ` (**${input.payment.cardLast4})`;
        }
        if (input.payment.bankName) {
          paymentStr += ` - ${input.payment.bankName}`;
        }
        message += `
${paymentStr}`;
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
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[TOOL] \u274C create-expense FAILED: ${errorMsg}`);
      return {
        success: false,
        message: `ERROR: Failed to save expense - ${errorMsg}. Please try again.`
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
      let message = `Recent Expenses (${response.expenses.length} items)
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      for (const expense of response.expenses) {
        const date = new Date(expense.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const cat = expense.category?.name || "Other";
        message += `- ${expense.description} | ${formatAmount(expense.amount, expense.currency)} | ${cat} | ${date}
`;
      }
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
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
        message: `Error: Failed to get expenses: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getExpenseByIdTool = createTool({
  id: "get-expense-by-id",
  description: `Get a specific expense by ID. Use when user asks about a specific expense (e.g., quotes a message with EX:xxx).`,
  inputSchema: z.object({
    expenseId: z.string().describe('Expense ID (just the ID part, not "EX:")'),
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    expense: z.object({
      id: z.string(),
      description: z.string(),
      amount: z.number(),
      currency: z.string(),
      date: z.string(),
      category: z.string().optional(),
      items: z.array(z.object({
        name: z.string(),
        quantity: z.number(),
        unitPrice: z.number(),
        totalPrice: z.number()
      })).optional()
    }).optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      const response = await apiRequest("GET", `/expenses/${input.expenseId}`, context);
      if (!response.expense) {
        return {
          success: false,
          message: "Expense not found"
        };
      }
      const e = response.expense;
      const formattedAmount = formatAmount(e.amount, e.currency);
      const date = new Date(e.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
      let message = `${e.description} | ${formattedAmount}
`;
      message += `Category: ${e.category?.name || "Other"}
`;
      message += `Date: ${date}
`;
      if (e.items && e.items.length > 0) {
        message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
        for (const item of e.items) {
          message += `- ${item.name} x${item.quantity} @ ${formatAmount(item.unitPrice, e.currency)} = ${formatAmount(item.totalPrice, e.currency)}
`;
        }
        message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      }
      message += `EX:${e.id}`;
      return {
        success: true,
        message,
        expense: {
          id: e.id,
          description: e.description,
          amount: e.amount,
          currency: e.currency,
          date: e.date,
          category: e.category?.name,
          items: e.items?.map((i) => ({
            name: i.name,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: i.totalPrice
          }))
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Failed to get expense"}`
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
        message: `Error: Failed to delete expense: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

export { createExpenseTool, deleteExpenseTool, getExpenseByIdTool, getExpensesTool };
