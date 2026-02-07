/**
 * DM Process Receipt Step
 *
 * Processes receipt images for personal (DM) expenses using OCR.
 * Uses the currency from the receipt (preserves actual currency for travel).
 *
 * Input: Image URL or base64
 * Output: Parsed expense data from OCR
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { CATEGORIES } from '../../../tools/api-client.js';
import {
  MessageWorkflowStateSchema,
  ParsedExpenseSchema,
} from '../../schemas.js';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

// OCR Prompts
const EXTRACT_TEXT_PROMPT = `Extract ALL text from this image exactly as shown.
Include every word, number, and symbol visible.
Return ONLY the raw text, no formatting or explanation.`;

const categoryList = Object.keys(CATEGORIES).join('|');

const ANALYZE_TEXT_PROMPT = `Analyze this receipt text and extract structured data as JSON.

Receipt text:
---
{TEXT}
---

Return JSON:
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
      "unitPrice": 0.00
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "currency": "THB|USD|AUD|EUR|JPY",
  "payment": {
    "method": "Cash|Credit|Debit|QR|PromptPay|null",
    "cardType": "VISA|Mastercard|JCB|null",
    "cardLast4": "1234|null",
    "bankName": "SCB|KBank|null"
  },
  "metadata": {
    "receiptNo": "receipt number|null",
    "transactionDate": "YYYY-MM-DD|null"
  }
}

Rules:
- If NOT a receipt, return {"isReceipt": false}
- Translate non-English to English in "name" fields
- Keep original in "nameLocalized"
- Return ONLY valid JSON, no markdown`;

// Helpers
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadImage(url: string): Promise<{ data: string; mimeType: string }> {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/*,*/*;q=0.8' },
  });
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return {
    data: Buffer.from(buffer).toString('base64'),
    mimeType: response.headers.get('content-type') || 'image/jpeg',
  };
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
        await sleep(Math.pow(2, attempt) * 1000);
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

// Schemas
const DmProcessReceiptInputSchema = z.object({
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),
  userCurrency: z.string().default('THB'),
});

const DmProcessReceiptOutputSchema = z.object({
  success: z.boolean(),
  isReceipt: z.boolean(),
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  error: z.string().optional(),
});

export const dmProcessReceiptStep = createStep({
  id: 'dm-process-receipt',
  description: 'Process receipt image using OCR (DM - no splits)',
  inputSchema: DmProcessReceiptInputSchema,
  outputSchema: DmProcessReceiptOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] dm-process-receipt`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  ImageURL: ${inputData.imageUrl || '(base64 provided)'}`);
    console.log(`${'='.repeat(60)}\n`);

    if (!inputData.imageUrl && !inputData.imageBase64) {
      setState({ ...state, messageType: 'expense_receipt', isReceipt: false, error: 'No image provided' });
      return { success: false, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [], error: 'No image provided' };
    }

    try {
      // Get image data
      let imageData: { data: string; mimeType: string };
      if (inputData.imageBase64) {
        imageData = { data: inputData.imageBase64.replace(/^data:image\/\w+;base64,/, ''), mimeType: 'image/jpeg' };
      } else {
        imageData = await downloadImage(inputData.imageUrl!);
      }

      // OCR Step 1: Extract text
      console.log('[OCR] Extracting text...');
      const rawText = await callGemini('gemini-2.0-flash', [
        EXTRACT_TEXT_PROMPT,
        { inlineData: { data: imageData.data, mimeType: imageData.mimeType } },
      ]);

      // OCR Step 2: Analyze text
      console.log('[OCR] Analyzing text...');
      const analysisText = await callGemini('gemini-2.0-flash', [ANALYZE_TEXT_PROMPT.replace('{TEXT}', rawText)]);
      const ocrResult = parseJSON(analysisText);

      if (!ocrResult.isReceipt) {
        setState({ ...state, messageType: 'expense_receipt', isReceipt: false });
        return { success: true, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [] };
      }

      // Build parsed expense
      const items = ((ocrResult.items || []) as Array<Record<string, unknown>>).map(item => ({
        name: (item.name as string) || 'Unknown',
        nameLocalized: (item.nameLocalized as string) || null,
        quantity: (item.quantity as number) || 1,
        unitPrice: (item.unitPrice as number) || 0,
        ingredientType: null,
      }));

      const payment = ocrResult.payment as Record<string, unknown> | null;
      const metadata = ocrResult.metadata as Record<string, unknown> | null;

      const parsedExpense = {
        description: (ocrResult.storeName as string) || (ocrResult.storeNameLocalized as string) || null,
        amount: (ocrResult.total as number) || null,
        currency: (ocrResult.currency as string) || 'THB',
        category: (ocrResult.category as string) || null,
        date: (metadata?.transactionDate as string) || null,
        splitType: null,
        splitTargets: [],
        items,
        payment: payment ? {
          method: (payment.method as string) || null,
          cardType: (payment.cardType as string) || null,
          cardLast4: (payment.cardLast4 as string) || null,
          bankName: (payment.bankName as string) || null,
        } : null,
        metadata: {
          receiptNo: metadata?.receiptNo,
          subtotal: ocrResult.subtotal,
          tax: ocrResult.tax,
        },
      };

      // Validate
      const missingFields: string[] = [];
      if (!parsedExpense.amount) missingFields.push('amount');
      if (!parsedExpense.description) missingFields.push('description');
      const isValid = missingFields.length === 0;

      console.log(`[OCR] ✅ ${parsedExpense.description} | ${parsedExpense.amount} ${parsedExpense.currency}`);

      setState({ ...state, messageType: 'expense_receipt', isReceipt: true, parsedExpense, isValid, missingFields });
      return { success: true, isReceipt: true, parsedExpense, isValid, missingFields };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[OCR] ❌ Error: ${errorMsg}`);
      setState({ ...state, messageType: 'expense_receipt', isReceipt: false, error: errorMsg });
      return { success: false, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [], error: errorMsg };
    }
  },
});
