/**
 * Text Expense Tool
 *
 * Processes text-based expense messages with validation.
 * Parses natural language, validates required fields, creates expense.
 *
 * Examples:
 * - "coffee 65" → Food, 65 THB
 * - "fuel $80 today" → Transport, 80 USD
 * - "lunch 500 @all" → Food, 500 THB, split equally
 */

import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { apiRequest, detectCategory, formatAmount, type ApiContext } from './api-client.js';
import { saveExpenseItemEmbeddings, isVectorStoreConfigured } from '../vector/index.js';

// ============================================
// Text Parsing Logic
// ============================================

interface ParsedExpense {
  description: string | null;
  amount: number | null;
  currency: string;
  category: string;
  splitType: 'equal' | 'exact' | 'percentage' | 'item' | null;
  splitTargets: string[];
  date: string | null;
}

function parseExpenseText(text: string): ParsedExpense {
  let description: string | null = null;
  let amount: number | null = null;
  let currency = 'THB';
  const splitTargets: string[] = [];

  // Extract amount with currency
  // Patterns: "65", "$80", "฿100", "100 THB", "USD 50"
  const amountPatterns = [
    { pattern: /\$(\d+(?:\.\d{2})?)/, currency: 'USD' },
    { pattern: /฿(\d+(?:\.\d{2})?)/, currency: 'THB' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:THB|บาท)/i, currency: 'THB' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:USD|ดอลลาร์)/i, currency: 'USD' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:EUR|ยูโร)/i, currency: 'EUR' },
    { pattern: /(\d+(?:\.\d{2})?)\s*(?:AUD)/i, currency: 'AUD' },
    { pattern: /(?:THB)\s*(\d+(?:\.\d{2})?)/i, currency: 'THB' },
    { pattern: /(?:USD)\s*(\d+(?:\.\d{2})?)/i, currency: 'USD' },
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

  // Extract description (everything except amount, currency, @mentions)
  let descText = text
    .replace(/@\w+/g, '') // Remove @mentions
    .replace(/[฿$€]\d+(?:\.\d{2})?/g, '') // Remove currency+amount
    .replace(/\d+(?:\.\d{2})?\s*(?:THB|USD|EUR|AUD|บาท|ดอลลาร์|ยูโร)/gi, '') // Remove amount+currency
    .replace(/(?:THB|USD|EUR|AUD)\s*\d+(?:\.\d{2})?/gi, '') // Remove currency+amount
    .replace(/\b\d+(?:\.\d{2})?\b/g, '') // Remove standalone numbers
    .replace(/\s+/g, ' ')
    .trim();

  // Remove common filler words
  descText = descText
    .replace(/\b(today|yesterday|วันนี้|เมื่อวาน)\b/gi, '')
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

// ============================================
// Tool Definition
// ============================================

export const processTextExpenseTool = createTool({
  id: 'process-text-expense',
  description: `Process a text message and create an expense record.
Parses natural language like "coffee 65", "fuel $80 today", "lunch 500 @all".
Handles validation and creates the expense.

Use this for TEXT-based expense messages (not receipts).
For receipts/images, use process-receipt instead.

Returns: expenseId confirming the record was saved, or error with missing fields.`,
  inputSchema: z.object({
    text: z.string().describe('The user message text to parse'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    expenseId: z.string().optional(),
    message: z.string(),
    parsed: z.object({
      description: z.string().nullable(),
      amount: z.number().nullable(),
      currency: z.string(),
      category: z.string(),
    }).optional(),
    missingFields: z.array(z.string()).optional(),
  }),
  execute: async (input, ctx) => {
    // Get context from RequestContext (auto-injected by router)
    const reqCtx = ctx?.requestContext;
    const channel = reqCtx?.get('channel') as 'LINE' | 'WHATSAPP' | 'TELEGRAM';
    const senderChannelId = reqCtx?.get('senderChannelId') as string;
    const sourceChannelId = reqCtx?.get('sourceChannelId') as string;
    const isGroup = reqCtx?.get('isGroup') as boolean;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[TOOL] 📝 process-text-expense CALLED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Text:    "${input.text}"`);
    console.log(`  Context: ${channel}/${senderChannelId}/${sourceChannelId}`);
    console.log(`${'='.repeat(60)}\n`);

    if (!channel || !senderChannelId || !sourceChannelId) {
      console.error(`[TextExpense] ❌ FAILED: Missing context`);
      return {
        success: false,
        message: 'ERROR: Cannot process expense - missing chat context.',
      };
    }

    // Step 1: Parse the text
    const parsed = parseExpenseText(input.text);
    console.log(`[TextExpense] Parsed: ${JSON.stringify(parsed)}`);

    // Step 2: Validate required fields
    const missingFields: string[] = [];
    if (!parsed.amount) missingFields.push('amount');
    if (!parsed.description) missingFields.push('description');

    if (missingFields.length > 0) {
      console.log(`[TextExpense] Missing fields: ${missingFields.join(', ')}`);

      // Build helpful message
      let msg = '';
      if (missingFields.includes('amount') && missingFields.includes('description')) {
        msg = 'Please provide what you bought and how much. Example: "coffee 65"';
      } else if (missingFields.includes('amount')) {
        msg = `How much was "${parsed.description}"?`;
      } else if (missingFields.includes('description')) {
        msg = `What did you spend ${formatAmount(parsed.amount!, parsed.currency)} on?`;
      }

      return {
        success: false,
        message: msg,
        parsed: {
          description: parsed.description,
          amount: parsed.amount,
          currency: parsed.currency,
          category: parsed.category,
        },
        missingFields,
      };
    }

    // Step 3: Create expense via API
    const context: ApiContext = {
      channel,
      senderChannelId,
      sourceChannelId,
      sourceType: isGroup ? 'GROUP' : 'DM',
    };

    // Build expense item (even single items should be ExpenseItems)
    const expenseItem = {
      name: parsed.description!,
      quantity: 1,
      unitPrice: parsed.amount!,
    };

    try {
      const response = await apiRequest<{
        expense: { id: string; description: string; amount: number; currency: string; date: string };
        splits: Array<{ userId: string; name: string | null; amount: number }>;
      }>('POST', '/expenses', context, {
        channel,
        senderChannelId,
        sourceChannelId,
        sourceType: isGroup ? 'GROUP' : 'DM',
        description: parsed.description,
        amount: parsed.amount,
        currency: parsed.currency,
        date: parsed.date,
        splitType: parsed.splitType,
        splits: parsed.splitTargets.map(target => ({ target })),
        // Always include items - even single item purchases
        items: [expenseItem],
      });

      // Verify expense was created
      if (!response.expense?.id) {
        console.error(`[TextExpense] ❌ FAILED: No expenseId in response`);
        return {
          success: false,
          message: 'ERROR: Expense was not saved. Please try again.',
        };
      }

      console.log(`[TextExpense] ✅ SUCCESS: EX:${response.expense.id}`);

      // Save embedding for Insights Agent (non-blocking)
      if (isVectorStoreConfigured()) {
        const expenseDate = response.expense.date || new Date().toISOString();
        saveExpenseItemEmbeddings(
          response.expense.id,
          [expenseItem],
          sourceChannelId,
          expenseDate,
          senderChannelId // Who paid
        ).catch((err) => console.error('[Vector] Embedding save error:', err));
      }

      // Format success message
      const formattedAmount = formatAmount(response.expense.amount, response.expense.currency);
      let message = `${response.expense.description} | ${formattedAmount}`;
      message += `\nCategory: ${parsed.category}`;

      // Show date if not today
      if (parsed.date) {
        const dateObj = new Date(parsed.date);
        const today = new Date();
        if (dateObj.toDateString() !== today.toDateString()) {
          message += `\nDate: ${dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
        }
      }

      message += `\nEX:${response.expense.id}`;

      // Show splits if any
      if (response.splits?.length > 0) {
        message += '\n' + response.splits.map(s =>
          `   → @${s.name || 'Unknown'} owes ${formatAmount(s.amount, response.expense.currency)}`
        ).join('\n');
      }

      return {
        success: true,
        expenseId: response.expense.id,
        message,
        parsed: {
          description: parsed.description,
          amount: parsed.amount,
          currency: parsed.currency,
          category: parsed.category,
        },
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[TextExpense] ❌ FAILED: ${errorMsg}`);
      return {
        success: false,
        message: `Failed to create expense: ${errorMsg}`,
      };
    }
  },
});
