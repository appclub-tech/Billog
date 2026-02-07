import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { formatAmount, apiRequest, detectCategory } from './5aaadd57-6742-4f80-91d8-d525c91493b6.mjs';
import { i as isVectorStoreConfigured, a as saveExpenseItemEmbeddings } from '../expense-item-vector.mjs';
import 'jsonwebtoken';
import '@upstash/vector';

function parseExpenseText(text) {
  let description = null;
  let amount = null;
  let currency = "THB";
  const splitTargets = [];
  const amountPatterns = [
    { pattern: /\$(\d+(?:\.\d{2})?)/, currency: "USD" },
    { pattern: /฿(\d+(?:\.\d{2})?)/, currency: "THB" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:THB|บาท)/i, currency: "THB" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:USD|ดอลลาร์)/i, currency: "USD" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:EUR|ยูโร)/i, currency: "EUR" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:AUD)/i, currency: "AUD" },
    { pattern: /(?:THB)\s*(\d+(?:\.\d{2})?)/i, currency: "THB" },
    { pattern: /(?:USD)\s*(\d+(?:\.\d{2})?)/i, currency: "USD" },
    { pattern: /(\d+(?:\.\d{2})?)/, currency: "THB" }
    // Default to THB
  ];
  for (const { pattern, currency: curr } of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      amount = parseFloat(match[1]);
      currency = curr;
      break;
    }
  }
  const splitMatches = text.match(/@(\w+)/g);
  if (splitMatches) {
    for (const m of splitMatches) {
      splitTargets.push(m.slice(1));
    }
  }
  let descText = text.replace(/@\w+/g, "").replace(/[฿$€]\d+(?:\.\d{2})?/g, "").replace(/\d+(?:\.\d{2})?\s*(?:THB|USD|EUR|AUD|บาท|ดอลลาร์|ยูโร)/gi, "").replace(/(?:THB|USD|EUR|AUD)\s*\d+(?:\.\d{2})?/gi, "").replace(/\b\d+(?:\.\d{2})?\b/g, "").replace(/\s+/g, " ").trim();
  descText = descText.replace(/\b(today|yesterday|วันนี้|เมื่อวาน)\b/gi, "").trim();
  if (descText) {
    description = descText;
  }
  const category = description ? detectCategory(description) : "Other";
  let date = null;
  if (/today|วันนี้/i.test(text)) {
    date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
  } else if (/yesterday|เมื่อวาน/i.test(text)) {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() - 1);
    date = d.toISOString().split("T")[0];
  }
  return {
    description,
    amount,
    currency,
    category,
    splitType: splitTargets.length > 0 ? "equal" : null,
    splitTargets,
    date
  };
}
const processTextExpenseTool = createTool({
  id: "process-text-expense",
  description: `Process a text message and create an expense record.
Parses natural language like "coffee 65", "fuel $80 today", "lunch 500 @all".
Handles validation and creates the expense.

Use this for TEXT-based expense messages (not receipts).
For receipts/images, use process-receipt instead.

Returns: expenseId confirming the record was saved, or error with missing fields.`,
  inputSchema: z.object({
    text: z.string().describe("The user message text to parse")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    expenseId: z.string().optional(),
    message: z.string(),
    parsed: z.object({
      description: z.string().nullable(),
      amount: z.number().nullable(),
      currency: z.string(),
      category: z.string()
    }).optional(),
    missingFields: z.array(z.string()).optional()
  }),
  execute: async (input, ctx) => {
    const reqCtx = ctx?.requestContext;
    const channel = reqCtx?.get("channel");
    const senderChannelId = reqCtx?.get("senderChannelId");
    const sourceChannelId = reqCtx?.get("sourceChannelId");
    const isGroup = reqCtx?.get("isGroup");
    console.log(`
${"=".repeat(60)}`);
    console.log(`[TOOL] \u{1F4DD} process-text-expense CALLED`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Text:    "${input.text}"`);
    console.log(`  Context: ${channel}/${senderChannelId}/${sourceChannelId}`);
    console.log(`${"=".repeat(60)}
`);
    if (!channel || !senderChannelId || !sourceChannelId) {
      console.error(`[TextExpense] \u274C FAILED: Missing context`);
      return {
        success: false,
        message: "ERROR: Cannot process expense - missing chat context."
      };
    }
    const parsed = parseExpenseText(input.text);
    console.log(`[TextExpense] Parsed: ${JSON.stringify(parsed)}`);
    const missingFields = [];
    if (!parsed.amount) missingFields.push("amount");
    if (!parsed.description) missingFields.push("description");
    if (missingFields.length > 0) {
      console.log(`[TextExpense] Missing fields: ${missingFields.join(", ")}`);
      let msg = "";
      if (missingFields.includes("amount") && missingFields.includes("description")) {
        msg = 'Please provide what you bought and how much. Example: "coffee 65"';
      } else if (missingFields.includes("amount")) {
        msg = `How much was "${parsed.description}"?`;
      } else if (missingFields.includes("description")) {
        msg = `What did you spend ${formatAmount(parsed.amount, parsed.currency)} on?`;
      }
      return {
        success: false,
        message: msg,
        parsed: {
          description: parsed.description,
          amount: parsed.amount,
          currency: parsed.currency,
          category: parsed.category
        },
        missingFields
      };
    }
    const context = {
      channel,
      senderChannelId,
      sourceChannelId,
      sourceType: isGroup ? "GROUP" : "DM"
    };
    const expenseItem = {
      name: parsed.description,
      quantity: 1,
      unitPrice: parsed.amount
    };
    try {
      const response = await apiRequest("POST", "/expenses", context, {
        channel,
        senderChannelId,
        sourceChannelId,
        sourceType: isGroup ? "GROUP" : "DM",
        description: parsed.description,
        amount: parsed.amount,
        currency: parsed.currency,
        date: parsed.date,
        splitType: parsed.splitType,
        splits: parsed.splitTargets.map((target) => ({ target })),
        // Always include items - even single item purchases
        items: [expenseItem]
      });
      if (!response.expense?.id) {
        console.error(`[TextExpense] \u274C FAILED: No expenseId in response`);
        return {
          success: false,
          message: "ERROR: Expense was not saved. Please try again."
        };
      }
      console.log(`[TextExpense] \u2705 SUCCESS: EX:${response.expense.id}`);
      if (isVectorStoreConfigured()) {
        const expenseDate = response.expense.date || (/* @__PURE__ */ new Date()).toISOString();
        saveExpenseItemEmbeddings(
          response.expense.id,
          [expenseItem],
          sourceChannelId,
          expenseDate,
          senderChannelId
          // Who paid
        ).catch((err) => console.error("[Vector] Embedding save error:", err));
      }
      const formattedAmount = formatAmount(response.expense.amount, response.expense.currency);
      let message = `${response.expense.description} | ${formattedAmount}`;
      message += `
Category: ${parsed.category}`;
      if (parsed.date) {
        const dateObj = new Date(parsed.date);
        const today = /* @__PURE__ */ new Date();
        if (dateObj.toDateString() !== today.toDateString()) {
          message += `
Date: ${dateObj.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
        }
      }
      message += `
EX:${response.expense.id}`;
      if (response.splits?.length > 0) {
        message += "\n" + response.splits.map(
          (s) => `   \u2192 @${s.name || "Unknown"} owes ${formatAmount(s.amount, response.expense.currency)}`
        ).join("\n");
      }
      return {
        success: true,
        expenseId: response.expense.id,
        message,
        parsed: {
          description: parsed.description,
          amount: parsed.amount,
          currency: parsed.currency,
          category: parsed.category
        }
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[TextExpense] \u274C FAILED: ${errorMsg}`);
      return {
        success: false,
        message: `Failed to create expense: ${errorMsg}`
      };
    }
  }
});

export { processTextExpenseTool };
