/**
 * OCR Receipt Tool
 *
 * Pure OCR extraction - extracts structured data from receipt images.
 * Does NOT create expenses - that's handled by the workflow.
 *
 * Output:
 * - storeName, storeNameLocalized
 * - items with quantities and prices
 * - total, subtotal, tax
 * - currency (detected from receipt)
 * - payment info
 * - metadata (receipt no, date, etc.)
 */

import { createTool } from '@mastra/core/tools';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { CATEGORIES } from './api-client.js';

// Initialize Gemini
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

// ============================================
// OCR Prompts
// ============================================

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
      "unitPrice": 0.00,
      "ingredientType": "meat|seafood|dairy|fruit|vegetable|frozen|bakery|beverage|snack|grain|condiment|canned|household|baby|pet|health|other"
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "serviceCharge": 0.00,
  "discount": 0.00,
  "total": 0.00,
  "currency": "THB|USD|AUD|EUR|JPY",
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
  console.log(`[OCR] Downloading: ${url}`);

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

  console.log(`[OCR] Downloaded ${buffer.byteLength} bytes`);
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
        console.log(`[OCR] Rate limited, retry in ${delay/1000}s (${attempt}/${maxRetries})`);
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
// Output Schema (shared with workflow)
// ============================================

export const OcrResultSchema = z.object({
  isReceipt: z.boolean(),
  storeName: z.string().nullable(),
  storeNameLocalized: z.string().nullable(),
  category: z.string().nullable(),
  items: z.array(z.object({
    name: z.string(),
    nameLocalized: z.string().nullable(),
    quantity: z.number(),
    unitPrice: z.number(),
    ingredientType: z.string().nullable(),
  })),
  subtotal: z.number().nullable(),
  tax: z.number().nullable(),
  serviceCharge: z.number().nullable(),
  discount: z.number().nullable(),
  total: z.number().nullable(),
  currency: z.string(),
  payment: z.object({
    method: z.string().nullable(),
    cardType: z.string().nullable(),
    cardLast4: z.string().nullable(),
    bankName: z.string().nullable(),
    approvalCode: z.string().nullable(),
  }).nullable(),
  metadata: z.object({
    receiptNo: z.string().nullable(),
    taxId: z.string().nullable(),
    branch: z.string().nullable(),
    cashier: z.string().nullable(),
    transactionTime: z.string().nullable(),
    transactionDate: z.string().nullable(),
  }).nullable(),
});

export type OcrResult = z.infer<typeof OcrResultSchema>;

// ============================================
// Pure OCR Tool
// ============================================

export const ocrReceiptTool = createTool({
  id: 'ocr-receipt',
  description: `Extract structured data from a receipt image using OCR.
This is a PURE extraction tool - it does NOT create expenses.
Returns: store name, items, total, currency, payment info.

Use this when you need to parse receipt data for workflow processing.
The workflow will handle expense creation separately.`,
  inputSchema: z.object({
    imageUrl: z.string().describe('Receipt image URL to process'),
    imageBase64: z.string().optional().describe('Receipt image as base64 (alternative to URL)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: OcrResultSchema.optional(),
    error: z.string().optional(),
  }),
  execute: async (input) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[TOOL] 🔍 ocr-receipt CALLED (pure OCR)`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  ImageURL: ${input.imageUrl || '(base64 provided)'}`);
    console.log(`${'='.repeat(60)}\n`);

    try {
      // Get image data
      let imageData: { data: string; mimeType: string };

      if (input.imageBase64) {
        // Use provided base64
        imageData = {
          data: input.imageBase64.replace(/^data:image\/\w+;base64,/, ''),
          mimeType: 'image/jpeg',
        };
      } else if (input.imageUrl) {
        // Download from URL
        imageData = await downloadImage(input.imageUrl);
      } else {
        return {
          success: false,
          error: 'No image provided (need imageUrl or imageBase64)',
        };
      }

      // Step 1: Extract raw text from image
      console.log('[OCR] Extracting text...');
      const rawText = await callGemini('gemini-2.0-flash', [
        EXTRACT_TEXT_PROMPT,
        { inlineData: { data: imageData.data, mimeType: imageData.mimeType } },
      ]);
      console.log(`[OCR] Extracted ${rawText.length} chars`);

      // Step 2: Analyze text to structured JSON
      console.log('[OCR] Analyzing text...');
      const analyzePrompt = ANALYZE_TEXT_PROMPT.replace('{TEXT}', rawText);
      const analysisText = await callGemini('gemini-2.0-flash', [analyzePrompt]);
      const ocrResult = parseJSON(analysisText);

      console.log(`[OCR] isReceipt: ${ocrResult.isReceipt}, items: ${(ocrResult.items as unknown[])?.length || 0}`);

      if (!ocrResult.isReceipt) {
        return {
          success: true,
          data: {
            isReceipt: false,
            storeName: null,
            storeNameLocalized: null,
            category: null,
            items: [],
            subtotal: null,
            tax: null,
            serviceCharge: null,
            discount: null,
            total: null,
            currency: 'THB',
            payment: null,
            metadata: null,
          },
        };
      }

      // Build structured result
      const items = ((ocrResult.items || []) as Array<Record<string, unknown>>).map(item => ({
        name: (item.name as string) || 'Unknown',
        nameLocalized: (item.nameLocalized as string) || null,
        quantity: (item.quantity as number) || 1,
        unitPrice: (item.unitPrice as number) || 0,
        ingredientType: (item.ingredientType as string) || null,
      }));

      const payment = ocrResult.payment as Record<string, unknown> | null;
      const metadata = ocrResult.metadata as Record<string, unknown> | null;

      const data: OcrResult = {
        isReceipt: true,
        storeName: (ocrResult.storeName as string) || null,
        storeNameLocalized: (ocrResult.storeNameLocalized as string) || null,
        category: (ocrResult.category as string) || null,
        items,
        subtotal: (ocrResult.subtotal as number) || null,
        tax: (ocrResult.tax as number) || null,
        serviceCharge: (ocrResult.serviceCharge as number) || null,
        discount: (ocrResult.discount as number) || null,
        total: (ocrResult.total as number) || null,
        currency: (ocrResult.currency as string) || 'THB',
        payment: payment ? {
          method: (payment.method as string) || null,
          cardType: (payment.cardType as string) || null,
          cardLast4: (payment.cardLast4 as string) || null,
          bankName: (payment.bankName as string) || null,
          approvalCode: (payment.approvalCode as string) || null,
        } : null,
        metadata: metadata ? {
          receiptNo: (metadata.receiptNo as string) || null,
          taxId: (metadata.taxId as string) || null,
          branch: (metadata.branch as string) || null,
          cashier: (metadata.cashier as string) || null,
          transactionTime: (metadata.transactionTime as string) || null,
          transactionDate: (metadata.transactionDate as string) || null,
        } : null,
      };

      console.log(`[OCR] ✅ SUCCESS: ${data.storeName} | ${data.total} ${data.currency}`);

      return {
        success: true,
        data,
      };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[OCR] ❌ FAILED: ${errorMsg}`);

      return {
        success: false,
        error: errorMsg,
      };
    }
  },
});

// Export helper for direct use in workflow steps
export { downloadImage, callGemini, parseJSON };
