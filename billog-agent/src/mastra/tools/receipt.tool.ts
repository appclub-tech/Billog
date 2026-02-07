/**
 * Receipt Processing Tool
 *
 * Combined OCR + Expense Creation in one atomic operation.
 * This ensures expense is ALWAYS created after OCR - no two-step workflow for agent to skip.
 */

import { createTool } from '@mastra/core/tools';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { apiRequest, CATEGORIES, formatAmount, type ApiContext, type CategoryName } from './api-client.js';
import { saveExpenseItemEmbeddings, isVectorStoreConfigured } from '../vector/index.js';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

// ============================================
// Single OCR Prompt - extract and analyze in one call
// ============================================

const categoryList = Object.keys(CATEGORIES).join('|');

const OCR_PROMPT = `Extract and analyze this receipt image. Return JSON only.

{
  "isReceipt": true/false,
  "storeName": "store name in English",
  "storeNameLocalized": "original name if not English, else null",
  "category": "${categoryList}",
  "items": [
    {
      "name": "item in English",
      "nameLocalized": "original if not English, else null",
      "quantity": 1,
      "unitPrice": 0.00,
      "ingredientType": "meat|seafood|dairy|fruit|vegetable|frozen|bakery|beverage|snack|grain|condiment|canned|household|baby|pet|health|other"
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "serviceCharge": 0.00,
  "discount": 0.00,
  "total": 0.00,
  "currency": "THB|USD|AUD|EUR",
  "payment": {
    "method": "Cash|Credit|Debit|QR|PromptPay|null",
    "cardType": "VISA|Mastercard|JCB|null",
    "cardLast4": "1234|null",
    "bankName": "SCB|KBank|null",
    "approvalCode": "auth code|null"
  },
  "metadata": {
    "receiptNo": "receipt number|null",
    "taxId": "tax ID|null",
    "branch": "branch name|null",
    "cashier": "staff name|null",
    "transactionTime": "HH:MM|null",
    "transactionDate": "YYYY-MM-DD|null"
  }
}

Rules:
- If NOT a receipt, return {"isReceipt": false}
- Translate non-English to English in "name" fields
- Keep original in "nameLocalized"
- Detect payment from: VISA, Mastercard, QR, PromptPay, Cash, etc.
- Category: Food (restaurants), Groceries (7-11, Big C), Shopping, Transport, Health
- Return ONLY valid JSON, no markdown`;

// ============================================
// Helpers
// ============================================

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadImage(url: string): Promise<{ data: string; mimeType: string }> {
  console.log(`[Receipt] Downloading: ${url}`);

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0',
      'Accept': 'image/*,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const contentType = response.headers.get('content-type') || 'image/jpeg';

  console.log(`[Receipt] Downloaded ${buffer.byteLength} bytes`);
  return { data: base64, mimeType: contentType };
}

async function callGemini(
  model: string,
  content: Array<string | { inlineData: { data: string; mimeType: string } }>,
  maxRetries = 3
): Promise<string> {
  const geminiModel = genAI.getGenerativeModel({ model });

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await geminiModel.generateContent(content);
      return response.response.text();
    } catch (error) {
      const isRateLimit = error instanceof Error &&
        (error.message.includes('429') || error.message.includes('Resource exhausted'));

      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`[Receipt] Rate limited, retry in ${delay/1000}s (${attempt}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}

function parseJSON(text: string): Record<string, unknown> {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith('```')) cleaned = cleaned.slice(3);
  if (cleaned.endsWith('```')) cleaned = cleaned.slice(0, -3);
  return JSON.parse(cleaned.trim());
}

// ============================================
// Process Receipt Tool (Combined OCR + Create)
// ============================================

export const processReceiptTool = createTool({
  id: 'process-receipt',
  description: `Process a receipt image and CREATE expense record in one step.
This is the ONLY tool needed for receipts - it does OCR AND saves the expense.
Returns: expenseId confirming the record was saved.

Use this when user sends a receipt image. Do NOT use extract-receipt separately.`,
  inputSchema: z.object({
    imageUrl: z.string().describe('Receipt image URL from "ImageURL:" in the message'),
    // Optional overrides
    description: z.string().optional().describe('Override auto-detected store name'),
    category: z.enum(['Food', 'Transport', 'Groceries', 'Utilities', 'Entertainment', 'Shopping', 'Health', 'Education', 'Travel', 'Housing', 'Personal', 'Gift', 'Other']).optional()
      .describe('Override auto-detected category'),
    // Split info
    splitType: z.enum(['equal', 'exact', 'percentage', 'item']).optional(),
    splits: z.array(z.object({
      target: z.string(),
      amount: z.number().optional(),
      percentage: z.number().optional(),
    })).optional(),
    notes: z.string().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    expenseId: z.string().optional(),
    message: z.string(),
    ocrData: z.object({
      storeName: z.string().nullable(),
      total: z.number().nullable(),
      itemCount: z.number(),
      category: z.string().nullable(),
    }).optional(),
    error: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    // Get context from RequestContext (auto-injected by router)
    const reqCtx = ctx?.requestContext;
    const channel = reqCtx?.get('channel') as 'LINE' | 'WHATSAPP' | 'TELEGRAM';
    const senderChannelId = reqCtx?.get('senderChannelId') as string;
    const sourceChannelId = reqCtx?.get('sourceChannelId') as string;
    const isGroup = reqCtx?.get('isGroup') as boolean;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[TOOL] 🧾 process-receipt CALLED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  ImageURL: ${input.imageUrl}`);
    console.log(`  Context:  ${channel}/${senderChannelId}/${sourceChannelId}`);
    console.log(`${'='.repeat(60)}\n`);

    if (!channel || !senderChannelId || !sourceChannelId) {
      console.error(`[Receipt] ❌ FAILED: Missing context`);
      return {
        success: false,
        message: 'ERROR: Cannot process receipt - missing chat context. Please try again.',
        error: 'Missing context',
      };
    }

    const context: ApiContext = {
      channel,
      senderChannelId,
      sourceChannelId,
      sourceType: isGroup ? 'GROUP' : 'DM',
    };

    try {
      // ==========================================
      // STEP 1: OCR - Extract and analyze in one call
      // ==========================================
      console.log('[Receipt] Step 1: OCR extraction...');

      const image = await downloadImage(input.imageUrl);

      // Single OCR call - extract and analyze together
      console.log('[Receipt] Processing receipt...');
      const analysisText = await callGemini('gemini-2.0-flash', [
        OCR_PROMPT,
        { inlineData: { data: image.data, mimeType: image.mimeType } },
      ]);
      const ocrResult = parseJSON(analysisText);

      console.log(`[Receipt] isReceipt: ${ocrResult.isReceipt}, items: ${(ocrResult.items as unknown[])?.length || 0}`);

      if (!ocrResult.isReceipt) {
        return {
          success: false,
          message: 'This does not appear to be a receipt. Please send a clear photo of a receipt.',
          error: 'Not a receipt',
        };
      }

      // ==========================================
      // STEP 2: Create expense with OCR data
      // ==========================================
      console.log('[Receipt] Step 2: Creating expense...');

      const storeName = (input.description || ocrResult.storeName || 'Receipt') as string;
      const total = (ocrResult.total || 0) as number;
      const currency = (ocrResult.currency || 'THB') as string;
      const category = (input.category || ocrResult.category || 'Other') as CategoryName;
      const items = (ocrResult.items || []) as Array<Record<string, unknown>>;
      const payment = ocrResult.payment as Record<string, unknown> | null;
      const metadata = ocrResult.metadata as Record<string, unknown> | null;

      // Build expense metadata
      const expenseMetadata: Record<string, unknown> = {};
      if (payment) {
        expenseMetadata.payment = payment;
      }
      if (metadata) {
        Object.assign(expenseMetadata, metadata);
      }

      // Use date from receipt if available
      const expenseDate = (metadata?.transactionDate as string) || undefined;

      // Ensure we always have items (even if OCR didn't extract line items)
      const expenseItems = items.length > 0
        ? items.map(item => ({
            name: (item.name as string) || 'Unknown',
            nameLocalized: (item.nameLocalized as string) || null,
            quantity: (item.quantity as number) || 1,
            unitPrice: (item.unitPrice as number) || 0,
            ingredientType: (item.ingredientType as string) || null,
          }))
        : [{
            name: storeName,
            nameLocalized: null,
            quantity: 1,
            unitPrice: total,
            ingredientType: null,
          }];

      // Call API to create expense
      const response = await apiRequest<{
        expense: { id: string; description: string; amount: number; currency: string; date: string };
        splits: Array<{ userId: string; name: string | null; amount: number }>;
      }>('POST', '/expenses', context, {
        channel,
        senderChannelId,
        sourceChannelId,
        sourceType: isGroup ? 'GROUP' : 'DM',
        description: storeName,
        amount: total,
        currency,
        date: expenseDate,
        splitType: input.splitType,
        splits: input.splits,
        items: expenseItems,
        notes: input.notes,
        metadata: Object.keys(expenseMetadata).length > 0 ? expenseMetadata : undefined,
        // Receipt data for creating Receipt record
        receiptData: {
          imageUrl: input.imageUrl,
          storeName,
          subtotal: (ocrResult.subtotal as number) || null,
          tax: (ocrResult.tax as number) || null,
          total,
        },
      });

      // CRITICAL: Verify expense was actually created
      if (!response.expense?.id) {
        console.error(`[Receipt] ❌ FAILED: No expenseId in response`);
        return {
          success: false,
          message: 'ERROR: Receipt was processed but expense was NOT saved. Please try again.',
          error: 'No expense ID returned',
          ocrData: {
            storeName,
            total,
            itemCount: items.length,
            category,
          },
        };
      }

      console.log(`[Receipt] ✅ SUCCESS: EX:${response.expense.id}`);

      // Save embeddings for Insights Agent (non-blocking)
      if (isVectorStoreConfigured()) {
        const embeddingDate = response.expense.date || new Date().toISOString();

        // Always save items (we ensured expenseItems exists above)
        saveExpenseItemEmbeddings(
          response.expense.id,
          expenseItems.map((item) => ({
            name: item.name || 'Unknown',
            nameLocalized: item.nameLocalized || undefined,
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || 0,
            totalPrice: (item.quantity || 1) * (item.unitPrice || 0),
          })),
          sourceChannelId,
          embeddingDate,
          senderChannelId // Who paid
        ).catch((err) => console.error('[Vector] Embedding save error:', err));
      }

      // ==========================================
      // STEP 3: Format response
      // ==========================================
      const formattedAmount = formatAmount(response.expense.amount, response.expense.currency);
      let message = `${storeName} | ${formattedAmount}`;
      message += `\nCategory: ${category}`;

      // Show date if from receipt (not today)
      if (expenseDate) {
        const dateObj = new Date(expenseDate);
        const today = new Date();
        const isToday = dateObj.toDateString() === today.toDateString();
        if (!isToday) {
          const formattedDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          message += `\nDate: ${formattedDate}`;
        }
      }

      if (items.length > 0) {
        message += `\n───────────`;
        for (const item of items) {
          const qty = (item.quantity as number) || 1;
          const unitPrice = (item.unitPrice as number) || 0;
          const lineTotal = qty * unitPrice;
          message += `\n- ${item.name} x${qty} @ ${formatAmount(unitPrice, currency)} = ${formatAmount(lineTotal, currency)}`;
        }
        message += `\n───────────`;
      }

      // Show payment info
      if (payment?.method) {
        let paymentStr = `Paid: ${payment.method}`;
        if (payment.cardType && payment.cardLast4) {
          paymentStr += ` (${payment.cardType} **${payment.cardLast4})`;
        } else if (payment.cardLast4) {
          paymentStr += ` (**${payment.cardLast4})`;
        }
        if (payment.bankName) {
          paymentStr += ` - ${payment.bankName}`;
        }
        message += `\n${paymentStr}`;
      }

      message += `\nEX:${response.expense.id}`;

      // Add split info if present
      if (response.splits?.length > 0) {
        message += '\n' + response.splits.map(s =>
          `   → @${s.name || 'Unknown'} owes ${formatAmount(s.amount, currency)}`
        ).join('\n');
      }

      return {
        success: true,
        expenseId: response.expense.id,
        message,
        ocrData: {
          storeName,
          total,
          itemCount: items.length,
          category,
        },
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Receipt] ❌ FAILED: ${errorMsg}`);

      // Provide helpful error message
      let userMessage = 'ERROR: Failed to process receipt.';
      if (errorMsg.includes('429') || errorMsg.includes('Resource exhausted')) {
        userMessage = 'OCR service is busy. Please try again in a few seconds.';
      } else if (errorMsg.includes('download')) {
        userMessage = 'Could not download the image. Please try sending it again.';
      } else {
        userMessage = `Failed to process receipt: ${errorMsg}. Please try again.`;
      }

      return {
        success: false,
        message: userMessage,
        error: errorMsg,
      };
    }
  },
});
