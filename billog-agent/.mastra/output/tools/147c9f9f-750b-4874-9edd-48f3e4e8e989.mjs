import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { detectCategory } from './c6e0983a-3be3-4b60-875a-a96a14c18c25.mjs';
import 'jsonwebtoken';

function parseExpenseText(text) {
  let description = null;
  let amount = null;
  let currency = "THB";
  const splitTargets = [];
  const amountPatterns = [
    { pattern: /\$(\d+(?:\.\d{2})?)/, currency: "USD" },
    { pattern: /฿(\d+(?:\.\d{2})?)/, currency: "THB" },
    { pattern: /¥(\d+(?:\.\d{2})?)/, currency: "JPY" },
    { pattern: /€(\d+(?:\.\d{2})?)/, currency: "EUR" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:THB|บาท)/i, currency: "THB" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:USD|ดอลลาร์)/i, currency: "USD" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:EUR|ยูโร)/i, currency: "EUR" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:JPY|เยน)/i, currency: "JPY" },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:AUD)/i, currency: "AUD" },
    { pattern: /(?:THB)\s*(\d+(?:\.\d{2})?)/i, currency: "THB" },
    { pattern: /(?:USD)\s*(\d+(?:\.\d{2})?)/i, currency: "USD" },
    { pattern: /(?:JPY)\s*(\d+(?:\.\d{2})?)/i, currency: "JPY" },
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
  if (/หารกัน|แบ่งกัน|ทุกคน/i.test(text) && !splitTargets.includes("all")) {
    splitTargets.push("all");
  }
  let descText = text.replace(/@\w+/g, "").replace(/[฿$€¥]\d+(?:\.\d{2})?/g, "").replace(/\d+(?:\.\d{2})?\s*(?:THB|USD|EUR|AUD|JPY|บาท|ดอลลาร์|ยูโร|เยน)/gi, "").replace(/(?:THB|USD|EUR|AUD|JPY)\s*\d+(?:\.\d{2})?/gi, "").replace(/\b\d+(?:\.\d{2})?\b/g, "").replace(/\s+/g, " ").trim();
  descText = descText.replace(/\b(today|yesterday|วันนี้|เมื่อวาน|หารกัน|แบ่งกัน|ทุกคน)\b/gi, "").trim();
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
function validateParsedExpense(parsed) {
  const missingFields = [];
  if (!parsed.amount) missingFields.push("amount");
  if (!parsed.description) missingFields.push("description");
  return {
    isValid: missingFields.length === 0,
    missingFields
  };
}
function generateMissingFieldsPrompt(parsed, missingFields, language = "th") {
  if (language === "th") {
    if (missingFields.includes("amount") && missingFields.includes("description")) {
      return '\u0E1A\u0E2D\u0E01\u0E27\u0E48\u0E32\u0E0B\u0E37\u0E49\u0E2D\u0E2D\u0E30\u0E44\u0E23 \u0E23\u0E32\u0E04\u0E32\u0E40\u0E17\u0E48\u0E32\u0E44\u0E2B\u0E23\u0E48? \u0E40\u0E0A\u0E48\u0E19 "\u0E01\u0E32\u0E41\u0E1F 65"';
    } else if (missingFields.includes("amount")) {
      return `"${parsed.description}" \u0E23\u0E32\u0E04\u0E32\u0E40\u0E17\u0E48\u0E32\u0E44\u0E2B\u0E23\u0E48?`;
    } else if (missingFields.includes("description")) {
      return `${parsed.amount} ${parsed.currency} - \u0E08\u0E48\u0E32\u0E22\u0E04\u0E48\u0E32\u0E2D\u0E30\u0E44\u0E23?`;
    }
  } else {
    if (missingFields.includes("amount") && missingFields.includes("description")) {
      return 'Please provide what you bought and how much. Example: "coffee 65"';
    } else if (missingFields.includes("amount")) {
      return `How much was "${parsed.description}"?`;
    } else if (missingFields.includes("description")) {
      return `What did you spend ${parsed.amount} ${parsed.currency} on?`;
    }
  }
  return "";
}
const ParseResultSchema = z.object({
  description: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  category: z.string(),
  splitType: z.enum(["equal", "exact", "percentage", "item"]).nullable(),
  splitTargets: z.array(z.string()),
  date: z.string().nullable()
});
const parseTextTool = createTool({
  id: "parse-text",
  description: `Parse natural language text into expense data.
This is a PURE parsing tool - it does NOT create expenses.
Returns: description, amount, currency, category, split info, date.

Use this to extract expense data from user messages.
The workflow will handle validation and expense creation separately.

Examples:
- "coffee 65" \u2192 description: coffee, amount: 65, currency: THB
- "lunch $25 @all" \u2192 description: lunch, amount: 25, currency: USD, splitTargets: [all]
- "dinner 1200 @tom @jerry" \u2192 splitTargets: [tom, jerry]`,
  inputSchema: z.object({
    text: z.string().describe("The user message text to parse")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: ParseResultSchema.optional(),
    isValid: z.boolean(),
    missingFields: z.array(z.string())
  }),
  execute: async (input) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[TOOL] \u{1F4DD} parse-text CALLED (pure parse)`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Text: "${input.text}"`);
    console.log(`${"=".repeat(60)}
`);
    const parsed = parseExpenseText(input.text);
    const { isValid, missingFields } = validateParsedExpense(parsed);
    console.log(`[Parse] Result: ${JSON.stringify(parsed)}`);
    console.log(`[Parse] Valid: ${isValid}, Missing: ${missingFields.join(", ") || "none"}`);
    return {
      success: true,
      data: parsed,
      isValid,
      missingFields
    };
  }
});

export { ParseResultSchema, generateMissingFieldsPrompt, parseExpenseText, parseTextTool, validateParsedExpense };
