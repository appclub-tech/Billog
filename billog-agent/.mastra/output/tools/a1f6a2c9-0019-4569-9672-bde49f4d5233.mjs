import { createTool } from '@mastra/core/tools';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { z } from 'zod';
import { CATEGORIES } from './c6e0983a-3be3-4b60-875a-a96a14c18c25.mjs';
import 'jsonwebtoken';

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const ReceiptItemSchema = z.object({
  name: z.string().describe("Item name in English"),
  nameLocalized: z.string().nullable().describe("Original language name"),
  quantity: z.number().default(1),
  unitPrice: z.number().describe("Price per unit"),
  ingredientType: z.string().nullable().describe("Type: meat, seafood, dairy, fruit, vegetable, frozen, bakery, beverage, snack, grain, condiment, canned, household, baby, pet, health, other")
});
const PaymentSchema = z.object({
  method: z.string().nullable(),
  cardType: z.string().nullable(),
  cardLast4: z.string().nullable(),
  bankName: z.string().nullable(),
  approvalCode: z.string().nullable()
});
const ReceiptMetadataSchema = z.object({
  receiptNo: z.string().nullable(),
  taxId: z.string().nullable(),
  branch: z.string().nullable(),
  cashier: z.string().nullable(),
  terminal: z.string().nullable(),
  transactionTime: z.string().nullable(),
  transactionDate: z.string().nullable(),
  memberNo: z.string().nullable(),
  points: z.string().nullable()
});
const categoryList = Object.keys(CATEGORIES).join("|");
const EXTRACT_TEXT_PROMPT = `Extract ALL text from this image exactly as shown.
Include every word, number, and symbol visible.
Return ONLY the raw text, no formatting or explanation.`;
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function downloadImage(url) {
  console.log(`[OCR] Downloading: ${url}`);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "image/*,*/*;q=0.8"
    }
  });
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const contentType = response.headers.get("content-type") || "image/jpeg";
  console.log(`[OCR] Downloaded ${buffer.byteLength} bytes`);
  return { data: base64, mimeType: contentType };
}
async function callGemini(model, content, maxRetries = 3) {
  const geminiModel = genAI.getGenerativeModel({ model });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await geminiModel.generateContent(content);
      return response.response.text();
    } catch (error) {
      const isRateLimit = error instanceof Error && (error.message.includes("429") || error.message.includes("Resource exhausted"));
      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1e3;
        console.log(`[OCR] Rate limited, retry in ${delay / 1e3}s (${attempt}/${maxRetries})`);
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}
function parseJSON(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return JSON.parse(cleaned.trim());
}
const extractReceiptTool = createTool({
  id: "extract-receipt",
  description: `Extract receipt data using OCR (DOES NOT SAVE to database).
Returns: storeName, items[], total, tax, payment info.
\u26A0\uFE0F IMPORTANT: This is OCR only - nothing is saved!
After this, you MUST call create-expense with receiptData to save the record.
Only after create-expense returns an expenseId can you confirm the expense was recorded.`,
  inputSchema: z.object({
    imageUrl: z.string().describe('URL from "ImageURL:" in the message')
  }),
  outputSchema: z.object({
    success: z.boolean(),
    isReceipt: z.boolean(),
    storeName: z.string().nullable(),
    storeNameLocalized: z.string().nullable(),
    category: z.string().nullable(),
    items: z.array(ReceiptItemSchema),
    subtotal: z.number().nullable(),
    tax: z.number().nullable(),
    serviceCharge: z.number().nullable(),
    discount: z.number().nullable(),
    total: z.number().nullable(),
    currency: z.string(),
    payment: PaymentSchema.nullable(),
    metadata: ReceiptMetadataSchema.nullable(),
    rawText: z.string().nullable(),
    error: z.string().nullable()
  }),
  execute: async (input) => {
    const emptyResult = {
      success: false,
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
      currency: "THB",
      payment: null,
      metadata: null,
      rawText: null,
      error: null
    };
    try {
      console.log(`[OCR] Processing: ${input.imageUrl}`);
      const image = await downloadImage(input.imageUrl);
      console.log("[OCR] Step 1: Extracting text...");
      const rawText = await callGemini("gemini-2.0-flash", [
        EXTRACT_TEXT_PROMPT,
        { inlineData: { data: image.data, mimeType: image.mimeType } }
      ]);
      console.log(`[OCR] Extracted ${rawText.length} chars`);
      console.log("[OCR] Step 2: Analyzing text...");
      const analyzePrompt = ANALYZE_TEXT_PROMPT.replace("{TEXT}", rawText);
      const analysisText = await callGemini("gemini-2.0-flash", [analyzePrompt]);
      const result = parseJSON(analysisText);
      console.log(`[OCR] isReceipt: ${result.isReceipt}, items: ${result.items?.length || 0}`);
      if (!result.isReceipt) {
        return { ...emptyResult, success: true, rawText };
      }
      const category = result.category;
      const validCategory = Object.keys(CATEGORIES).includes(category) ? category : "Other";
      const payment = result.payment;
      const metadata = result.metadata;
      return {
        success: true,
        isReceipt: true,
        storeName: result.storeName || null,
        storeNameLocalized: result.storeNameLocalized || null,
        category: validCategory,
        items: (result.items || []).map((item) => ({
          name: item.name || "Unknown",
          nameLocalized: item.nameLocalized || null,
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 0,
          ingredientType: item.ingredientType || null
        })),
        subtotal: result.subtotal ?? null,
        tax: result.tax ?? null,
        serviceCharge: result.serviceCharge ?? null,
        discount: result.discount ?? null,
        total: result.total ?? null,
        currency: result.currency || "THB",
        payment: payment ? {
          method: payment.method || null,
          cardType: payment.cardType || null,
          cardLast4: payment.cardLast4 || null,
          bankName: payment.bankName || null,
          approvalCode: payment.approvalCode || null
        } : null,
        metadata: metadata ? {
          receiptNo: metadata.receiptNo || null,
          taxId: metadata.taxId || null,
          branch: metadata.branch || null,
          cashier: metadata.cashier || null,
          terminal: metadata.terminal || null,
          transactionTime: metadata.transactionTime || null,
          transactionDate: metadata.transactionDate || null,
          memberNo: metadata.memberNo || null,
          points: metadata.points || null
        } : null,
        rawText,
        error: null
      };
    } catch (error) {
      console.error("[OCR] Error:", error);
      let errorMsg = error instanceof Error ? error.message : "Unknown error";
      if (errorMsg.includes("429") || errorMsg.includes("Resource exhausted")) {
        errorMsg = "OCR service busy. Please try again in a few seconds.";
      }
      return { ...emptyResult, error: errorMsg };
    }
  }
});
const extractRawTextTool = extractReceiptTool;

export { extractRawTextTool, extractReceiptTool };
