/**
 * Parse Text Tool
 *
 * Pure text parsing - extracts expense data from natural language.
 * Does NOT create expenses - that's handled by the workflow.
 *
 * Examples:
 * - "coffee 65" → Food, 65 THB, no split
 * - "fuel $80 today" → Transport, 80 USD, today
 * - "lunch 500 @all" → Food, 500 THB, split with all
 * - "dinner 1200 @tom @jerry" → Food, 1200 THB, split with tom & jerry
 *
 * Output:
 * - description, amount, currency
 * - category (auto-detected)
 * - splitType, splitTargets
 * - date (if mentioned)
 * - validation status
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { detectCategory } from './api-client.js';

// ============================================
// Parsing Logic (exported for workflow reuse)
// ============================================

export interface ParsedExpense {
  description: string | null;
  amount: number | null;
  currency: string;
  category: string;
  splitType: 'equal' | 'exact' | 'percentage' | 'item' | null;
  splitTargets: string[];
  date: string | null;
}

/**
 * Parse expense text into structured data
 * Exported for direct use in workflow steps
 */
export function parseExpenseText(text: string): ParsedExpense {
  let description: string | null = null;
  let amount: number | null = null;
  let currency = 'THB';
  const splitTargets: string[] = [];

  // Extract amount with currency
  // Patterns: "65", "$80", "฿100", "100 THB", "USD 50", "¥3000", "€50"
  const amountPatterns = [
    { pattern: /\$(\d+(?:\.\d{2})?)/, currency: 'USD' },
    { pattern: /฿(\d+(?:\.\d{2})?)/, currency: 'THB' },
    { pattern: /¥(\d+(?:\.\d{2})?)/, currency: 'JPY' },
    { pattern: /€(\d+(?:\.\d{2})?)/, currency: 'EUR' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:THB|บาท)/i, currency: 'THB' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:USD|ดอลลาร์)/i, currency: 'USD' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:EUR|ยูโร)/i, currency: 'EUR' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:JPY|เยน)/i, currency: 'JPY' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:AUD)/i, currency: 'AUD' },
    { pattern: /(?:THB)\s*(\d+(?:\.\d{2})?)/i, currency: 'THB' },
    { pattern: /(?:USD)\s*(\d+(?:\.\d{2})?)/i, currency: 'USD' },
    { pattern: /(?:JPY)\s*(\d+(?:\.\d{2})?)/i, currency: 'JPY' },
    { pattern: /(\d+(?:\.\d{2})?)/, currency: 'THB' }, // Default to THB
  ];

  for (const { pattern, currency: curr } of amountPatterns) {
    const match = text.match(pattern);
    if (match) {
      amount = parseFloat(match[1]);
      currency = curr;
      break;
    }
  }

  // Extract split targets (@all, @name)
  const splitMatches = text.match(/@(\w+)/g);
  if (splitMatches) {
    for (const m of splitMatches) {
      splitTargets.push(m.slice(1)); // Remove @
    }
  }

  // Thai split keywords
  if (/หารกัน|แบ่งกัน|ทุกคน/i.test(text) && !splitTargets.includes('all')) {
    splitTargets.push('all');
  }

  // Extract description (everything except amount, currency, @mentions)
  let descText = text
    .replace(/@\w+/g, '') // Remove @mentions
    .replace(/[฿$€¥]\d+(?:\.\d{2})?/g, '') // Remove currency+amount
    .replace(/\d+(?:\.\d{2})?\s*(?:THB|USD|EUR|AUD|JPY|บาท|ดอลลาร์|ยูโร|เยน)/gi, '') // Remove amount+currency
    .replace(/(?:THB|USD|EUR|AUD|JPY)\s*\d+(?:\.\d{2})?/gi, '') // Remove currency+amount
    .replace(/\b\d+(?:\.\d{2})?\b/g, '') // Remove standalone numbers
    .replace(/\s+/g, ' ')
    .trim();

  // Remove common filler words (EN + TH)
  descText = descText
    .replace(/\b(today|yesterday|วันนี้|เมื่อวาน|หารกัน|แบ่งกัน|ทุกคน)\b/gi, '')
    .trim();

  if (descText) {
    description = descText;
  }

  // Auto-detect category from description
  const category = description ? detectCategory(description) : 'Other';

  // Detect date references
  let date: string | null = null;
  if (/today|วันนี้/i.test(text)) {
    date = new Date().toISOString().split('T')[0];
  } else if (/yesterday|เมื่อวาน/i.test(text)) {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    date = d.toISOString().split('T')[0];
  }

  return {
    description,
    amount,
    currency,
    category,
    splitType: splitTargets.length > 0 ? 'equal' : null,
    splitTargets,
    date,
  };
}

/**
 * Validate parsed expense and return missing fields
 */
export function validateParsedExpense(parsed: ParsedExpense): {
  isValid: boolean;
  missingFields: string[];
} {
  const missingFields: string[] = [];
  if (!parsed.amount) missingFields.push('amount');
  if (!parsed.description) missingFields.push('description');

  return {
    isValid: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Generate user-friendly prompt for missing fields
 */
export function generateMissingFieldsPrompt(
  parsed: ParsedExpense,
  missingFields: string[],
  language: 'th' | 'en' = 'th'
): string {
  if (language === 'th') {
    if (missingFields.includes('amount') && missingFields.includes('description')) {
      return 'บอกว่าซื้ออะไร ราคาเท่าไหร่? เช่น "กาแฟ 65"';
    } else if (missingFields.includes('amount')) {
      return `"${parsed.description}" ราคาเท่าไหร่?`;
    } else if (missingFields.includes('description')) {
      return `${parsed.amount} ${parsed.currency} - จ่ายค่าอะไร?`;
    }
  } else {
    if (missingFields.includes('amount') && missingFields.includes('description')) {
      return 'Please provide what you bought and how much. Example: "coffee 65"';
    } else if (missingFields.includes('amount')) {
      return `How much was "${parsed.description}"?`;
    } else if (missingFields.includes('description')) {
      return `What did you spend ${parsed.amount} ${parsed.currency} on?`;
    }
  }
  return '';
}

// ============================================
// Output Schema (shared with workflow)
// ============================================

export const ParseResultSchema = z.object({
  description: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string(),
  category: z.string(),
  splitType: z.enum(['equal', 'exact', 'percentage', 'item']).nullable(),
  splitTargets: z.array(z.string()),
  date: z.string().nullable(),
});

export type ParseResult = z.infer<typeof ParseResultSchema>;

// ============================================
// Pure Parse Tool
// ============================================

export const parseTextTool = createTool({
  id: 'parse-text',
  description: `Parse natural language text into expense data.
This is a PURE parsing tool - it does NOT create expenses.
Returns: description, amount, currency, category, split info, date.

Use this to extract expense data from user messages.
The workflow will handle validation and expense creation separately.

Examples:
- "coffee 65" → description: coffee, amount: 65, currency: THB
- "lunch $25 @all" → description: lunch, amount: 25, currency: USD, splitTargets: [all]
- "dinner 1200 @tom @jerry" → splitTargets: [tom, jerry]`,
  inputSchema: z.object({
    text: z.string().describe('The user message text to parse'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: ParseResultSchema.optional(),
    isValid: z.boolean(),
    missingFields: z.array(z.string()),
  }),
  execute: async (input) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[TOOL] 📝 parse-text CALLED (pure parse)`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Text: "${input.text}"`);
    console.log(`${'='.repeat(60)}\n`);

    const parsed = parseExpenseText(input.text);
    const { isValid, missingFields } = validateParsedExpense(parsed);

    console.log(`[Parse] Result: ${JSON.stringify(parsed)}`);
    console.log(`[Parse] Valid: ${isValid}, Missing: ${missingFields.join(', ') || 'none'}`);

    return {
      success: true,
      data: parsed,
      isValid,
      missingFields,
    };
  },
});
