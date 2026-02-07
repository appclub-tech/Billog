import { Mastra } from '@mastra/core';
import { LibSQLVector, LibSQLStore } from '@mastra/libsql';
import path from 'path';
import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { Workspace, LocalFilesystem } from '@mastra/core/workspace';
import { UnicodeNormalizer, TokenLimiterProcessor } from '@mastra/core/processors';
import { ModelRouterEmbeddingModel } from '@mastra/core/llm';
import { fileURLToPath } from 'url';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { Index } from '@upstash/vector';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { RequestContext } from '@mastra/core/request-context';
import crypto from 'crypto';
import fs from 'fs/promises';
import { EventEmitter } from 'events';
import { createStep, createWorkflow } from '@mastra/core/workflows';

"use strict";
const BILLOG_API_URL = process.env.BILLOG_API_URL || "http://localhost:8000";
const BILLOG_JWT_SECRET = process.env.BILLOG_JWT_SECRET || "billog-jwt-secret-2024";
function generateJwt(context) {
  const payload = {
    channel: context.channel,
    senderChannelId: context.senderChannelId,
    sourceChannelId: context.sourceChannelId,
    sourceType: context.sourceType || "GROUP",
    // Agent identifier for audit trail
    iss: "billog-agent",
    iat: Math.floor(Date.now() / 1e3)
  };
  return jwt.sign(payload, BILLOG_JWT_SECRET, { expiresIn: "1h" });
}
async function apiRequest(method, path, context, body) {
  const url = `${BILLOG_API_URL}/api${path}`;
  const token = generateJwt(context);
  const requestId = Math.random().toString(36).substring(2, 10);
  console.log(`
${"\u2500".repeat(50)}`);
  console.log(`[API] \u{1F4E4} REQUEST [${requestId}]`);
  console.log(`${"\u2500".repeat(50)}`);
  console.log(`  Method:     ${method}`);
  console.log(`  URL:        ${url}`);
  console.log(`  Context:    ${JSON.stringify(context)}`);
  if (body) {
    console.log(`  Body:       ${JSON.stringify(body, null, 2).substring(0, 500)}`);
  }
  console.log(`${"\u2500".repeat(50)}`);
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Request-Id": requestId
      },
      body: body ? JSON.stringify(body) : void 0
    });
    const duration = Date.now() - startTime;
    const responseText = await response.text();
    console.log(`
${"\u2500".repeat(50)}`);
    console.log(`[API] \u{1F4E5} RESPONSE [${requestId}] ${response.status} ${duration}ms`);
    console.log(`${"\u2500".repeat(50)}`);
    console.log(`  Status:     ${response.status} ${response.statusText}`);
    console.log(`  Duration:   ${duration}ms`);
    console.log(`  Body:       ${responseText.substring(0, 500)}${responseText.length > 500 ? "..." : ""}`);
    console.log(`${"\u2500".repeat(50)}
`);
    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${responseText}`);
    }
    try {
      return JSON.parse(responseText);
    } catch {
      return {};
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`
${"\u2500".repeat(50)}`);
    console.log(`[API] \u274C ERROR [${requestId}] ${duration}ms`);
    console.log(`${"\u2500".repeat(50)}`);
    console.log(`  Error:      ${error instanceof Error ? error.message : String(error)}`);
    console.log(`${"\u2500".repeat(50)}
`);
    throw error;
  }
}
const CATEGORIES = {
  Food: { nameLocalized: "\u0E2D\u0E32\u0E2B\u0E32\u0E23", icon: "\u{1F354}", keywords: ["lunch", "dinner", "breakfast", "restaurant", "meal", "snack", "coffee"] },
  Transport: { nameLocalized: "\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07", icon: "\u{1F697}", keywords: ["taxi", "grab", "bts", "mrt", "gas", "fuel", "uber"] },
  Groceries: { nameLocalized: "\u0E02\u0E2D\u0E07\u0E43\u0E0A\u0E49", icon: "\u{1F6D2}", keywords: ["7-11", "big c", "lotus", "supermarket", "mart"] },
  Utilities: { nameLocalized: "\u0E2A\u0E32\u0E18\u0E32\u0E23\u0E13\u0E39\u0E1B\u0E42\u0E20\u0E04", icon: "\u{1F4A1}", keywords: ["electric", "water", "internet", "phone", "bill"] },
  Entertainment: { nameLocalized: "\u0E1A\u0E31\u0E19\u0E40\u0E17\u0E34\u0E07", icon: "\u{1F3AC}", keywords: ["movie", "cinema", "game", "netflix", "concert"] },
  Shopping: { nameLocalized: "\u0E0A\u0E49\u0E2D\u0E1B\u0E1B\u0E34\u0E49\u0E07", icon: "\u{1F6CD}\uFE0F", keywords: ["clothes", "electronics", "online", "lazada", "shopee"] },
  Health: { nameLocalized: "\u0E2A\u0E38\u0E02\u0E20\u0E32\u0E1E", icon: "\u{1F48A}", keywords: ["medicine", "hospital", "clinic", "gym", "pharmacy"] },
  Education: { nameLocalized: "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", icon: "\u{1F4DA}", keywords: ["course", "book", "tutor", "school"] },
  Travel: { nameLocalized: "\u0E17\u0E48\u0E2D\u0E07\u0E40\u0E17\u0E35\u0E48\u0E22\u0E27", icon: "\u2708\uFE0F", keywords: ["hotel", "flight", "tour", "agoda", "booking"] },
  Housing: { nameLocalized: "\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E2D\u0E32\u0E28\u0E31\u0E22", icon: "\u{1F3E0}", keywords: ["rent", "repair", "furniture"] },
  Personal: { nameLocalized: "\u0E2A\u0E48\u0E27\u0E19\u0E15\u0E31\u0E27", icon: "\u{1F464}", keywords: ["haircut", "salon", "personal"] },
  Gift: { nameLocalized: "\u0E02\u0E2D\u0E07\u0E02\u0E27\u0E31\u0E0D", icon: "\u{1F381}", keywords: ["gift", "present", "donation"] },
  Other: { nameLocalized: "\u0E2D\u0E37\u0E48\u0E19\u0E46", icon: "\u{1F4E6}", keywords: [] }
};
function detectCategory(description) {
  const lower = description.toLowerCase();
  for (const [category, data] of Object.entries(CATEGORIES)) {
    if (data.keywords.some((keyword) => lower.includes(keyword))) {
      return category;
    }
  }
  return "Other";
}
function formatAmount(amount, currency = "THB") {
  const symbols = {
    THB: "\u0E3F",
    USD: "$",
    EUR: "\u20AC",
    JPY: "\xA5",
    AUD: "A$"
  };
  return `${symbols[currency] || currency}${amount.toLocaleString()}`;
}
function getApiContext(input, requestContext) {
  const channel = input.channel || requestContext?.get("channel");
  const senderChannelId = input.senderChannelId || requestContext?.get("senderChannelId");
  const sourceChannelId = input.sourceChannelId || requestContext?.get("sourceChannelId");
  const isGroup = requestContext?.get("isGroup");
  const sourceType = input.sourceType || (isGroup === false ? "DM" : "GROUP");
  if (!channel || !senderChannelId || !sourceChannelId) {
    console.error("[API] Missing context:", { channel, senderChannelId, sourceChannelId });
    return null;
  }
  return { channel, senderChannelId, sourceChannelId, sourceType };
}

"use strict";
const PERISHABLE_WINDOWS = {
  fresh_produce: 7,
  // banana, vegetables, leafy greens
  dairy: 14,
  // milk, yogurt, cheese
  bread: 5,
  // bread, pastries
  meat_seafood: 3,
  // chicken, fish, shrimp
  eggs: 21,
  // eggs
  frozen: 60,
  // frozen items
  pantry: 180,
  // rice, pasta, canned goods
  non_food: 0
  // household items (no check)
};
const ITEM_TYPE_PATTERNS = {
  fresh_produce: [
    // Fruits
    /banana|กล้วย/i,
    /apple|แอปเปิ้ล/i,
    /orange|ส้ม/i,
    /mango|มะม่วง/i,
    /watermelon|แตงโม/i,
    /strawberry|สตรอว์เบอร์รี่/i,
    /grape|องุ่น/i,
    /pineapple|สับปะรด/i,
    /papaya|มะละกอ/i,
    /longan|ลำไย/i,
    /durian|ทุเรียน/i,
    /lychee|ลิ้นจี่/i,
    /rambutan|เงาะ/i,
    /mangosteen|มังคุด/i,
    // Vegetables
    /lettuce|ผักกาด/i,
    /spinach|ผักโขม/i,
    /cabbage|กะหล่ำปลี/i,
    /carrot|แครอท/i,
    /tomato|มะเขือเทศ/i,
    /cucumber|แตงกวา/i,
    /broccoli|บร็อคโคลี่/i,
    /chinese|ผักจีน|ผักคะน้า|ผักกาดขาว/i,
    /morning glory|ผักบุ้ง/i,
    /basil|โหระพา|กะเพรา/i,
    /vegetable|ผัก/i,
    /salad|สลัด/i,
    /herb|สมุนไพร/i,
    /fresh|สด/i
  ],
  dairy: [
    /milk|นม/i,
    /yogurt|โยเกิร์ต/i,
    /cheese|ชีส/i,
    /cream|ครีม/i,
    /butter|เนย/i,
    /dairy|นม/i,
    /kefir/i
  ],
  bread: [
    /bread|ขนมปัง/i,
    /bakery|เบเกอรี่/i,
    /pastry|เพสตรี้/i,
    /croissant|ครัวซองต์/i,
    /donut|โดนัท/i,
    /cake|เค้ก/i,
    /bun|ซาลาเปา|ปัง/i,
    /toast|โทสต์/i
  ],
  meat_seafood: [
    /chicken|ไก่/i,
    /pork|หมู/i,
    /beef|เนื้อ/i,
    /fish|ปลา/i,
    /shrimp|กุ้ง/i,
    /crab|ปู/i,
    /squid|หมึก/i,
    /meat|เนื้อสัตว์/i,
    /seafood|อาหารทะเล/i,
    /shellfish|หอย/i,
    /salmon|แซลมอน/i,
    /tuna|ทูน่า/i
  ],
  eggs: [
    /egg|ไข่/i
  ],
  frozen: [
    /frozen|แช่แข็ง/i,
    /ice cream|ไอศกรีม/i
  ],
  pantry: [
    /rice|ข้าว/i,
    /pasta|พาสต้า/i,
    /noodle|เส้น|บะหมี่/i,
    /can|กระป๋อง/i,
    /sauce|ซอส/i,
    /oil|น้ำมัน/i,
    /sugar|น้ำตาล/i,
    /salt|เกลือ/i,
    /flour|แป้ง/i,
    /instant|สำเร็จรูป/i,
    /snack|ขนม/i,
    /chips|มันฝรั่ง/i,
    /coffee|กาแฟ/i,
    /tea|ชา/i,
    /cereal|ซีเรียล/i
  ],
  non_food: [
    /soap|สบู่/i,
    /shampoo|แชมพู/i,
    /detergent|ผงซักฟอก/i,
    /tissue|ทิชชู่|กระดาษ/i,
    /toothpaste|ยาสีฟัน/i,
    /cleaning|ทำความสะอาด/i,
    /household|ของใช้/i
  ]
};
function detectItemType(itemName) {
  const normalizedName = itemName.toLowerCase().trim();
  for (const [type, patterns] of Object.entries(ITEM_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedName)) {
        return type;
      }
    }
  }
  return "pantry";
}
function getPerishableWindow(itemType) {
  return PERISHABLE_WINDOWS[itemType];
}
function getPerishableWindowForItem(itemName) {
  const itemType = detectItemType(itemName);
  return getPerishableWindow(itemType);
}
function shouldCheckFreshness(itemType) {
  return itemType !== "non_food";
}

"use strict";
let vectorIndex = null;
function getExpenseItemVectorIndex() {
  if (vectorIndex) {
    return vectorIndex;
  }
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Missing Upstash Vector configuration. Set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN."
    );
  }
  vectorIndex = new Index({
    url,
    token
  });
  console.log("[Vector] Upstash Vector index initialized");
  return vectorIndex;
}
function isVectorStoreConfigured() {
  return !!(process.env.UPSTASH_VECTOR_REST_URL && process.env.UPSTASH_VECTOR_REST_TOKEN);
}
async function saveExpenseItemEmbeddings(expenseId, items, sourceId, date, paidBy) {
  if (!isVectorStoreConfigured()) {
    console.log("[Vector] Skipping save - vector store not configured");
    return;
  }
  const index = getExpenseItemVectorIndex();
  const embeddings = items.map((item, idx) => {
    const searchText = item.nameLocalized ? `${item.name} ${item.nameLocalized}` : item.name;
    const metadata = {
      name: item.name,
      nameLocalized: item.nameLocalized,
      sourceId,
      date,
      expenseId,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      totalPrice: item.totalPrice ?? item.quantity * item.unitPrice,
      itemType: detectItemType(item.name),
      paidBy
    };
    return {
      id: `${expenseId}-item-${idx}`,
      data: searchText,
      metadata
    };
  });
  try {
    await index.upsert(embeddings);
    console.log(`[Vector] Saved ${embeddings.length} item embeddings for expense ${expenseId}`);
  } catch (error) {
    console.error(`[Vector] Failed to save embeddings:`, error);
  }
}
async function saveSimpleExpenseEmbedding(expenseId, description, amount, sourceId, date, paidBy) {
  await saveExpenseItemEmbeddings(
    expenseId,
    [{
      name: description,
      quantity: 1,
      unitPrice: amount,
      totalPrice: amount
    }],
    sourceId,
    date,
    paidBy
  );
}
function daysBetween(dateStr, now) {
  const date = new Date(dateStr);
  const diffTime = now.getTime() - date.getTime();
  return Math.floor(diffTime / (1e3 * 60 * 60 * 24));
}
async function searchSimilarItems(query, sourceId, lookbackDays = 14, topK = 10) {
  if (!isVectorStoreConfigured()) {
    console.log("[Vector] Skipping search - vector store not configured");
    return { found: false, matches: [] };
  }
  const index = getExpenseItemVectorIndex();
  const now = /* @__PURE__ */ new Date();
  const cutoffDate = /* @__PURE__ */ new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);
  try {
    const results = await index.query({
      data: query,
      topK,
      filter: `sourceId = '${sourceId}'`,
      includeMetadata: true
    });
    const matches = results.filter((r) => {
      const metadata = r.metadata;
      const itemDate = new Date(metadata.date);
      return itemDate >= cutoffDate;
    }).filter((r) => r.score >= 0.7).map((r) => {
      const metadata = r.metadata;
      return {
        id: r.id,
        name: metadata.name,
        nameLocalized: metadata.nameLocalized,
        date: metadata.date,
        quantity: metadata.quantity,
        unit: metadata.unit,
        totalPrice: metadata.totalPrice,
        expenseId: metadata.expenseId,
        itemType: metadata.itemType,
        similarity: r.score,
        daysSince: daysBetween(metadata.date, now),
        paidBy: metadata.paidBy
      };
    });
    if (matches.length === 0) {
      return { found: false, matches: [] };
    }
    matches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return {
      found: true,
      matches,
      lastPurchase: matches[0]
    };
  } catch (error) {
    console.error(`[Vector] Search failed:`, error);
    return { found: false, matches: [] };
  }
}
async function deleteExpenseEmbeddings(expenseId) {
  if (!isVectorStoreConfigured()) {
    return;
  }
  const index = getExpenseItemVectorIndex();
  try {
    const results = await index.query({
      data: "expense item",
      // Generic query to find items
      topK: 100,
      filter: `expenseId = '${expenseId}'`,
      includeMetadata: true
    });
    if (results.length > 0) {
      const ids = results.map((r) => r.id);
      await index.delete(ids);
      console.log(`[Vector] Deleted ${ids.length} embeddings for expense ${expenseId}`);
    }
  } catch (error) {
    console.error(`[Vector] Failed to delete embeddings:`, error);
  }
}

"use strict";

"use strict";
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
    const categoryData = CATEGORIES[category];
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

"use strict";
const getBalancesTool = createTool({
  id: "get-balances",
  description: `Get group balances showing who owes whom. Use when user asks:
- "who owes what"
- "show balances"
- "check debts"
- "what do I owe"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)"),
    currency: z.string().default("THB").describe("Currency to show balances in")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    balances: z.array(z.object({
      from: z.string(),
      to: z.string(),
      amount: z.number()
    })).optional(),
    members: z.array(z.object({
      name: z.string(),
      net: z.number()
    })).optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      const params = new URLSearchParams();
      params.set("channel", context.channel);
      params.set("sourceChannelId", context.sourceChannelId);
      params.set("currency", input.currency ?? "THB");
      const response = await apiRequest("GET", `/balances?${params}`, context);
      if (response.balances.length === 0) {
        return {
          success: true,
          message: "\u2705 No outstanding balances - everyone is settled!",
          balances: [],
          members: []
        };
      }
      let message = `\u{1F4B0} Group Balances (${input.currency})
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      for (const balance of response.balances) {
        message += `@${balance.from.name} owes @${balance.to.name} ${formatAmount(balance.amount, balance.currency)}
`;
      }
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Net: `;
      message += response.members.map((m) => `${m.nickname || m.name} ${m.net >= 0 ? "+" : ""}${formatAmount(m.net, input.currency)}`).join(" | ");
      return {
        success: true,
        message,
        balances: response.balances.map((b) => ({
          from: b.from.name,
          to: b.to.name,
          amount: b.amount
        })),
        members: response.members.map((m) => ({
          name: m.nickname || m.name,
          net: m.net
        }))
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get balances: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getSpendingSummaryTool = createTool({
  id: "get-spending-summary",
  description: `Get spending summary for a period. Use when user asks:
- "how much did we spend this month"
- "spending summary"
- "what did tom spend"
- "show expenses by category"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)"),
    period: z.enum(["day", "week", "month", "year"]).default("month").describe("Time period")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    summary: z.object({
      total: z.number(),
      count: z.number(),
      byCategory: z.record(z.number()),
      byPayer: z.array(z.object({
        name: z.string(),
        total: z.number()
      }))
    }).optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      const period = input.period ?? "month";
      const params = new URLSearchParams();
      params.set("channel", context.channel);
      params.set("sourceChannelId", context.sourceChannelId);
      params.set("period", period);
      const response = await apiRequest("GET", `/insights/summary?${params}`, context);
      if (response.count === 0) {
        return {
          success: true,
          message: `\u{1F4CA} No spending recorded for this ${period}.`
        };
      }
      const periodLabels = {
        day: "Today's",
        week: "This Week's",
        month: "This Month's",
        year: "This Year's"
      };
      let message = `\u{1F4CA} ${periodLabels[period]} Spending
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Total: ${formatAmount(response.total, response.currency)} (${response.count} expenses)

`;
      if (Object.keys(response.byCategory).length > 0) {
        message += `By Category:
`;
        const sortedCategories = Object.entries(response.byCategory).sort(([, a], [, b]) => b - a);
        for (const [category, amount] of sortedCategories) {
          const percentage = Math.round(amount / response.total * 100);
          message += `\u2022 ${category}: ${formatAmount(amount, response.currency)} (${percentage}%)
`;
        }
      }
      if (response.byPayer.length > 0) {
        message += `
By Payer:
`;
        for (const payer of response.byPayer) {
          message += `\u2022 ${payer.name}: ${formatAmount(payer.total, response.currency)}
`;
        }
      }
      return {
        success: true,
        message,
        summary: {
          total: response.total,
          count: response.count,
          byCategory: response.byCategory,
          byPayer: response.byPayer.map((p) => ({ name: p.name, total: p.total }))
        }
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get summary: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getMyBalanceTool = createTool({
  id: "get-my-balance",
  description: `Get user's personal balance across all sources. Use when user asks:
- "my balance"
- "what do I owe"
- "how much do I owe"`,
  inputSchema: z.object({
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      const response = await apiRequest("GET", "/users/me", context);
      if (response.sources.length === 0) {
        return {
          success: true,
          message: `\u{1F4B0} @${response.user.name} - No active sources yet.`
        };
      }
      let message = `\u{1F4B0} @${response.user.name}'s Balance
`;
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      for (const source of response.sources) {
        const status = source.net >= 0 ? "owed to you" : "you owe";
        message += `\u2022 ${source.name}: ${formatAmount(Math.abs(source.net), source.currency)} ${status}
`;
      }
      const totalsByCurrency = response.sources.reduce((acc, s) => {
        acc[s.currency] = (acc[s.currency] || 0) + s.net;
        return acc;
      }, {});
      message += `\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
`;
      message += `Net: `;
      message += Object.entries(totalsByCurrency).map(([currency, net]) => `${net >= 0 ? "+" : ""}${formatAmount(net, currency)}`).join(", ");
      return {
        success: true,
        message
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to get balance: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

"use strict";
const PAYMENT_METHODS = {
  1: "Cash",
  2: "Bank Transfer",
  3: "PromptPay",
  4: "Credit Card",
  5: "E-Wallet",
  99: "Other"
};
const recordSettlementTool = createTool({
  id: "record-settlement",
  description: `Record a payment/settlement between users. Use when:
- "tom paid me 350"
- "paid jerry 200 via promptpay"
- "received 500 from wife"
- "settled with tom"

Direction:
- "X paid me" \u2192 from=X, to=me (I received)
- "I paid X" \u2192 from=me, to=X (I gave)
- "X paid Y" \u2192 from=X, to=Y (third-party)`,
  inputSchema: z.object({
    fromTarget: z.string().describe('Who paid: @nickname, channel ID, or "me"'),
    toTarget: z.string().describe('Who received: @nickname, channel ID, or "me"'),
    amount: z.number().min(0).describe("Amount paid"),
    currency: z.string().default("THB").describe("Currency code"),
    paymentMethod: z.number().optional().describe("Payment method: 1=Cash, 2=Bank, 3=PromptPay, 4=Card, 5=E-Wallet"),
    // Context (optional - auto-injected)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    remainingBalance: z.number().optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    const fromChannelId = input.fromTarget === "me" ? context.senderChannelId : input.fromTarget;
    const toChannelId = input.toTarget === "me" ? context.senderChannelId : input.toTarget;
    try {
      const response = await apiRequest("POST", "/settlements", context, {
        channel: context.channel,
        sourceChannelId: context.sourceChannelId,
        senderChannelId: context.senderChannelId,
        fromChannelId,
        toChannelId,
        amount: input.amount,
        currency: input.currency,
        paymentMethod: input.paymentMethod
      });
      const { settlement, remainingBalance } = response;
      const methodName = input.paymentMethod ? PAYMENT_METHODS[input.paymentMethod] || "Other" : null;
      let message = `\u2705 Settlement recorded
`;
      message += `@${settlement.from.name} paid @${settlement.to.name} ${formatAmount(settlement.amount, settlement.currency)}`;
      if (methodName) {
        message += ` via ${methodName}`;
      }
      message += "\n";
      if (remainingBalance === 0) {
        message += `Remaining: ${formatAmount(0, settlement.currency)} \u2713 All settled!`;
      } else if (remainingBalance > 0) {
        message += `Remaining: ${formatAmount(remainingBalance, settlement.currency)} still owed`;
      } else {
        message += `Remaining: ${formatAmount(Math.abs(remainingBalance), settlement.currency)} overpaid (credit)`;
      }
      return {
        success: true,
        message,
        remainingBalance
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to record settlement: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

"use strict";
const adjustmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reassign_item"),
    itemId: z.string().describe("ID of item to reassign"),
    assignedTo: z.string().describe("New assignee: @nickname or channel ID")
  }),
  z.object({
    type: z.literal("update_item"),
    itemId: z.string().describe("ID of item to update"),
    quantity: z.number().optional().describe("New quantity"),
    unitPrice: z.number().optional().describe("New unit price"),
    name: z.string().optional().describe("New item name")
  }),
  z.object({
    type: z.literal("add_item"),
    name: z.string().describe("Item name"),
    quantity: z.number().default(1).describe("Quantity"),
    unitPrice: z.number().describe("Unit price"),
    assignedTo: z.string().optional().describe("Assignee: @nickname or null for split")
  }),
  z.object({
    type: z.literal("remove_item"),
    itemId: z.string().describe("ID of item to remove")
  }),
  z.object({
    type: z.literal("remove_from_split"),
    target: z.string().describe("Person to remove: @nickname or channel ID")
  }),
  z.object({
    type: z.literal("add_to_split"),
    target: z.string().describe("Person to add: @nickname or channel ID")
  }),
  z.object({
    type: z.literal("update_amount"),
    amount: z.number().describe("New total amount")
  }),
  z.object({
    type: z.literal("update_category"),
    categoryId: z.string().describe("New category ID")
  }),
  z.object({
    type: z.literal("update_description"),
    description: z.string().describe("New description")
  })
]);
const reconcileExpenseTool = createTool({
  id: "reconcile-expense",
  description: `Adjust/correct an existing expense. Use when user:
- Quotes an expense (EX:xxx) and wants to modify it
- Wants to reassign items to different people
- Needs to correct prices or quantities
- Wants to add or remove items
- Needs to remove/add someone from a split

Extract expense ID from quoted message (EX:xxx format).`,
  inputSchema: z.object({
    expenseId: z.string().describe("Expense ID (from EX:xxx in quoted message)"),
    adjustments: z.array(adjustmentSchema).describe("List of adjustments to make"),
    reason: z.string().optional().describe("Reason for adjustment"),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    expense: z.object({
      id: z.string(),
      description: z.string(),
      amount: z.number(),
      currency: z.string()
    }).optional(),
    adjustments: z.array(z.object({
      name: z.string(),
      delta: z.number()
    })).optional()
  }),
  execute: async (input, ctx) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[TOOL] \u{1F527} reconcile-expense CALLED`);
    console.log(`[TOOL] Expense ID: ${input.expenseId}`);
    console.log(`[TOOL] Adjustments: ${JSON.stringify(input.adjustments)}`);
    console.log(`${"=".repeat(60)}
`);
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      const response = await apiRequest(
        "POST",
        `/expenses/${input.expenseId}/reconcile`,
        context,
        {
          adjustments: input.adjustments,
          reason: input.reason
        }
      );
      const { expense, adjustments } = response;
      const formattedAmount = formatAmount(expense.amount, expense.currency);
      let message = `Updated ${expense.description} (EX:${expense.id})`;
      for (const adj of input.adjustments) {
        switch (adj.type) {
          case "reassign_item":
            message += `
- Item reassigned to ${adj.assignedTo}`;
            break;
          case "update_item":
            message += `
- Item updated`;
            break;
          case "add_item":
            message += `
- Added: ${adj.name} ${formatAmount(adj.unitPrice * (adj.quantity || 1), expense.currency)}`;
            break;
          case "remove_item":
            message += `
- Item removed`;
            break;
          case "remove_from_split":
            message += `
- Removed ${adj.target} from split`;
            break;
          case "add_to_split":
            message += `
- Added ${adj.target} to split`;
            break;
          case "update_amount":
            message += `
- Amount updated to ${formatAmount(adj.amount, expense.currency)}`;
            break;
          case "update_category":
            message += `
- Category updated`;
            break;
          case "update_description":
            message += `
- Description: ${adj.description}`;
            break;
        }
      }
      message += `
New total: ${formattedAmount}`;
      if (adjustments.length > 0) {
        message += "\n\nAdjustments:";
        for (const adj of adjustments) {
          const sign = adj.delta >= 0 ? "+" : "";
          message += `
- ${adj.name}: ${sign}${formatAmount(adj.delta, expense.currency)}`;
        }
      }
      return {
        success: true,
        message,
        expense: {
          id: expense.id,
          description: expense.description,
          amount: expense.amount,
          currency: expense.currency
        },
        adjustments: adjustments.map((a) => ({
          name: a.name,
          delta: a.delta
        }))
      };
    } catch (error) {
      console.error("[TOOL] reconcile-expense ERROR:", error);
      return {
        success: false,
        message: `Error: Failed to reconcile expense: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

"use strict";
const MemberInputSchema = z.object({
  channelId: z.string().describe("User channel ID"),
  displayName: z.string().optional().describe("Display name")
});
const initSourceTool = createTool({
  id: "init-source",
  description: `Initialize a source (group/DM) for expense tracking. Use when:
- First interaction in a new group
- Bot added to a group
- User explicitly asks to set up billog
This is usually called automatically on first expense.`,
  inputSchema: z.object({
    sourceType: z.enum(["GROUP", "DM"]).default("GROUP").describe("Source type"),
    sourceName: z.string().optional().describe("Group name"),
    senderDisplayName: z.string().optional().describe("User display name"),
    members: z.array(MemberInputSchema).optional().describe("Initial member list (for WhatsApp)"),
    currency: z.string().default("THB").describe("Default currency"),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    isNewSource: z.boolean().optional(),
    isNewUser: z.boolean().optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    context.sourceType = input.sourceType || context.sourceType;
    try {
      const response = await apiRequest("POST", "/sources/init", context, {
        channel: input.channel,
        sourceChannelId: input.sourceChannelId,
        sourceType: input.sourceType,
        sourceName: input.sourceName,
        senderChannelId: input.senderChannelId,
        senderDisplayName: input.senderDisplayName,
        members: input.members,
        currency: input.currency
      });
      const { source, user, isNewSource, isNewUser } = response;
      let message;
      if (isNewSource) {
        message = `Group ready!
`;
        message += `   Source: ${source.name}
`;
        message += `   Members: ${source.memberCount}

`;
        message += `   Type "help" to see commands`;
      } else if (isNewUser) {
        message = `Registered!
`;
        message += `   Name: ${user.name}
`;
        if (user.nickname) {
          message += `   Nickname: @${user.nickname}
`;
        }
        message += `
   Start recording expenses, e.g. "coffee 65"`;
      } else {
        message = `Ready
`;
        message += `   Source: ${source.name} (${source.memberCount} members)`;
      }
      return {
        success: true,
        message,
        isNewSource,
        isNewUser
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to initialize: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const syncMembersTool = createTool({
  id: "sync-members",
  description: `Sync group members with the API. Use for WhatsApp/Telegram groups to update @all targeting.`,
  inputSchema: z.object({
    members: z.array(MemberInputSchema).describe("Current member list"),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    summary: z.object({
      added: z.number(),
      updated: z.number(),
      deactivated: z.number(),
      total: z.number()
    }).optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      const sourceResponse = await apiRequest("GET", `/sources?channel=${context.channel}&channelId=${context.sourceChannelId}`, context);
      if (!sourceResponse.source) {
        return {
          success: false,
          message: "\u274C Source not found. Initialize first."
        };
      }
      const response = await apiRequest("POST", `/sources/${sourceResponse.source.id}/sync-members`, context, {
        channel: input.channel,
        members: input.members
      });
      const { summary } = response;
      let message = `\u2705 Members synced
`;
      message += `   Added: ${summary.added}
`;
      message += `   Updated: ${summary.updated}
`;
      message += `   Deactivated: ${summary.deactivated}
`;
      message += `   Total: ${summary.total}`;
      return {
        success: true,
        message,
        summary
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to sync members: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const setNicknameTool = createTool({
  id: "set-nickname",
  description: `Set a user's nickname for @mentions. Use when:
- "call me boss"
- "set nickname tom"
- "my name is X"`,
  inputSchema: z.object({
    nickname: z.string().describe("New nickname (without @)"),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      await apiRequest("PATCH", "/users/me", context, {
        nickname: input.nickname
      });
      return {
        success: true,
        message: `Nickname set: @${input.nickname}`
      };
    } catch (error) {
      return {
        success: false,
        message: `\u274C Failed to set nickname: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

"use strict";
const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  nameLocalized: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable()
});
let categoryCache = null;
const CATEGORY_CACHE_TTL = 60 * 60 * 1e3;
const listCategoriesTool = createTool({
  id: "list-categories",
  description: `List all available expense categories. Use this to get category IDs for creating expenses.
Returns categories with id, name, nameLocalized (Thai name), icon, and color.`,
  inputSchema: z.object({
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    categories: z.array(CategorySchema),
    message: z.string()
  }),
  execute: async (input, ctx) => {
    if (categoryCache && Date.now() - categoryCache.timestamp < CATEGORY_CACHE_TTL) {
      console.log("[CategoryTool] Using cached categories");
      const categoryList = categoryCache.data.map((c) => `${c.icon || "\u{1F4E6}"} ${c.name} (${c.nameLocalized || c.name}) - ID: ${c.id}`).join("\n");
      return {
        success: true,
        categories: categoryCache.data,
        message: `Available categories:
${categoryList}`
      };
    }
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, categories: [], message: "Error: Missing context" };
    }
    try {
      const response = await apiRequest("GET", "/categories", context);
      categoryCache = {
        data: response.categories,
        timestamp: Date.now()
      };
      console.log("[CategoryTool] Fetched and cached categories");
      const categoryList = response.categories.map((c) => `${c.icon || "\u{1F4E6}"} ${c.name} (${c.nameLocalized || c.name}) - ID: ${c.id}`).join("\n");
      return {
        success: true,
        categories: response.categories,
        message: `Available categories:
${categoryList}`
      };
    } catch (error) {
      return {
        success: false,
        categories: [],
        message: `Failed to list categories: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});
const getCategoryByNameTool = createTool({
  id: "get-category-by-name",
  description: `Find a category by name to get its ID. Use before creating an expense to get the correct categoryId.
Common categories: Food, Transport, Groceries, Utilities, Entertainment, Shopping, Health, Education, Travel, Housing, Personal, Gift, Other`,
  inputSchema: z.object({
    name: z.string().describe("Category name (English): Food, Transport, etc."),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    category: CategorySchema.nullable(),
    message: z.string()
  }),
  execute: async (input, ctx) => {
    if (categoryCache && Date.now() - categoryCache.timestamp < CATEGORY_CACHE_TTL) {
      const nameLower = input.name.toLowerCase();
      const found = categoryCache.data.find(
        (c) => c.name.toLowerCase() === nameLower || c.nameLocalized?.toLowerCase() === nameLower
      );
      if (found) {
        console.log(`[CategoryTool] Found "${input.name}" in cache`);
        return {
          success: true,
          category: found,
          message: `Found: ${found.icon || "\u{1F4E6}"} ${found.name} (ID: ${found.id})`
        };
      }
      console.log(`[CategoryTool] "${input.name}" not in cache`);
      return {
        success: false,
        category: null,
        message: `Category "${input.name}" not found. Use "Other" as default.`
      };
    }
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, category: null, message: "Error: Missing context" };
    }
    try {
      const response = await apiRequest("GET", `/categories/by-name/${encodeURIComponent(input.name)}`, context);
      if (response.category) {
        return {
          success: true,
          category: response.category,
          message: `Found: ${response.category.icon || "\u{1F4E6}"} ${response.category.name} (ID: ${response.category.id})`
        };
      } else {
        return {
          success: false,
          category: null,
          message: `Category "${input.name}" not found. Use "Other" as default.`
        };
      }
    } catch (error) {
      return {
        success: false,
        category: null,
        message: `Failed to find category: ${error instanceof Error ? error.message : "Unknown error"}`
      };
    }
  }
});

"use strict";
const genAI$4 = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
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
const categoryList$4 = Object.keys(CATEGORIES).join("|");
const EXTRACT_TEXT_PROMPT$1 = `Extract ALL text from this image exactly as shown.
Include every word, number, and symbol visible.
Return ONLY the raw text, no formatting or explanation.`;
const ANALYZE_TEXT_PROMPT$1 = `Analyze this receipt text and extract structured data as JSON.

Receipt text:
---
{TEXT}
---

Return JSON:
{
  "isReceipt": true/false,
  "storeName": "store name in English",
  "storeNameLocalized": "original name if not English, else null",
  "category": "${categoryList$4}",
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
function sleep$4(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function downloadImage$4(url) {
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
async function callGemini$4(model, content, maxRetries = 3) {
  const geminiModel = genAI$4.getGenerativeModel({ model });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await geminiModel.generateContent(content);
      return response.response.text();
    } catch (error) {
      const isRateLimit = error instanceof Error && (error.message.includes("429") || error.message.includes("Resource exhausted"));
      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1e3;
        console.log(`[OCR] Rate limited, retry in ${delay / 1e3}s (${attempt}/${maxRetries})`);
        await sleep$4(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}
function parseJSON$4(text) {
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
      const image = await downloadImage$4(input.imageUrl);
      console.log("[OCR] Step 1: Extracting text...");
      const rawText = await callGemini$4("gemini-2.0-flash", [
        EXTRACT_TEXT_PROMPT$1,
        { inlineData: { data: image.data, mimeType: image.mimeType } }
      ]);
      console.log(`[OCR] Extracted ${rawText.length} chars`);
      console.log("[OCR] Step 2: Analyzing text...");
      const analyzePrompt = ANALYZE_TEXT_PROMPT$1.replace("{TEXT}", rawText);
      const analysisText = await callGemini$4("gemini-2.0-flash", [analyzePrompt]);
      const result = parseJSON$4(analysisText);
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

"use strict";
const genAI$3 = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const categoryList$3 = Object.keys(CATEGORIES).join("|");
const OCR_PROMPT$2 = `Extract and analyze this receipt image. Return JSON only.

{
  "isReceipt": true/false,
  "storeName": "store name in English",
  "storeNameLocalized": "original name if not English, else null",
  "category": "${categoryList$3}",
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
function sleep$3(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function downloadImage$3(url) {
  console.log(`[Receipt] Downloading: ${url}`);
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
  console.log(`[Receipt] Downloaded ${buffer.byteLength} bytes`);
  return { data: base64, mimeType: contentType };
}
async function callGemini$3(model, content, maxRetries = 3) {
  const geminiModel = genAI$3.getGenerativeModel({ model });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await geminiModel.generateContent(content);
      return response.response.text();
    } catch (error) {
      const isRateLimit = error instanceof Error && (error.message.includes("429") || error.message.includes("Resource exhausted"));
      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1e3;
        console.log(`[Receipt] Rate limited, retry in ${delay / 1e3}s (${attempt}/${maxRetries})`);
        await sleep$3(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}
function parseJSON$3(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return JSON.parse(cleaned.trim());
}
const processReceiptTool = createTool({
  id: "process-receipt",
  description: `Process a receipt image and CREATE expense record in one step.
This is the ONLY tool needed for receipts - it does OCR AND saves the expense.
Returns: expenseId confirming the record was saved.

Use this when user sends a receipt image. Do NOT use extract-receipt separately.`,
  inputSchema: z.object({
    imageUrl: z.string().describe('Receipt image URL from "ImageURL:" in the message'),
    // Optional overrides
    description: z.string().optional().describe("Override auto-detected store name"),
    category: z.enum(["Food", "Transport", "Groceries", "Utilities", "Entertainment", "Shopping", "Health", "Education", "Travel", "Housing", "Personal", "Gift", "Other"]).optional().describe("Override auto-detected category"),
    // Split info
    splitType: z.enum(["equal", "exact", "percentage", "item"]).optional(),
    splits: z.array(z.object({
      target: z.string(),
      amount: z.number().optional(),
      percentage: z.number().optional()
    })).optional(),
    notes: z.string().optional()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    expenseId: z.string().optional(),
    message: z.string(),
    ocrData: z.object({
      storeName: z.string().nullable(),
      total: z.number().nullable(),
      itemCount: z.number(),
      category: z.string().nullable()
    }).optional(),
    error: z.string().optional()
  }),
  execute: async (input, ctx) => {
    const reqCtx = ctx?.requestContext;
    const channel = reqCtx?.get("channel");
    const senderChannelId = reqCtx?.get("senderChannelId");
    const sourceChannelId = reqCtx?.get("sourceChannelId");
    const isGroup = reqCtx?.get("isGroup");
    console.log(`
${"=".repeat(60)}`);
    console.log(`[TOOL] \u{1F9FE} process-receipt CALLED`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  ImageURL: ${input.imageUrl}`);
    console.log(`  Context:  ${channel}/${senderChannelId}/${sourceChannelId}`);
    console.log(`${"=".repeat(60)}
`);
    if (!channel || !senderChannelId || !sourceChannelId) {
      console.error(`[Receipt] \u274C FAILED: Missing context`);
      return {
        success: false,
        message: "ERROR: Cannot process receipt - missing chat context. Please try again.",
        error: "Missing context"
      };
    }
    const context = {
      channel,
      senderChannelId,
      sourceChannelId,
      sourceType: isGroup ? "GROUP" : "DM"
    };
    try {
      console.log("[Receipt] Step 1: OCR extraction...");
      const image = await downloadImage$3(input.imageUrl);
      console.log("[Receipt] Processing receipt...");
      const analysisText = await callGemini$3("gemini-2.0-flash", [
        OCR_PROMPT$2,
        { inlineData: { data: image.data, mimeType: image.mimeType } }
      ]);
      const ocrResult = parseJSON$3(analysisText);
      console.log(`[Receipt] isReceipt: ${ocrResult.isReceipt}, items: ${ocrResult.items?.length || 0}`);
      if (!ocrResult.isReceipt) {
        return {
          success: false,
          message: "This does not appear to be a receipt. Please send a clear photo of a receipt.",
          error: "Not a receipt"
        };
      }
      console.log("[Receipt] Step 2: Creating expense...");
      const storeName = input.description || ocrResult.storeName || "Receipt";
      const total = ocrResult.total || 0;
      const currency = ocrResult.currency || "THB";
      const category = input.category || ocrResult.category || "Other";
      const items = ocrResult.items || [];
      const payment = ocrResult.payment;
      const metadata = ocrResult.metadata;
      const expenseMetadata = {};
      if (payment) {
        expenseMetadata.payment = payment;
      }
      if (metadata) {
        Object.assign(expenseMetadata, metadata);
      }
      const expenseDate = metadata?.transactionDate || void 0;
      const expenseItems = items.length > 0 ? items.map((item) => ({
        name: item.name || "Unknown",
        nameLocalized: item.nameLocalized || null,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        ingredientType: item.ingredientType || null
      })) : [{
        name: storeName,
        nameLocalized: null,
        quantity: 1,
        unitPrice: total,
        ingredientType: null
      }];
      const response = await apiRequest("POST", "/expenses", context, {
        channel,
        senderChannelId,
        sourceChannelId,
        sourceType: isGroup ? "GROUP" : "DM",
        description: storeName,
        amount: total,
        currency,
        date: expenseDate,
        splitType: input.splitType,
        splits: input.splits,
        items: expenseItems,
        notes: input.notes,
        metadata: Object.keys(expenseMetadata).length > 0 ? expenseMetadata : void 0,
        // Receipt data for creating Receipt record
        receiptData: {
          imageUrl: input.imageUrl,
          storeName,
          subtotal: ocrResult.subtotal || null,
          tax: ocrResult.tax || null,
          total
        }
      });
      if (!response.expense?.id) {
        console.error(`[Receipt] \u274C FAILED: No expenseId in response`);
        return {
          success: false,
          message: "ERROR: Receipt was processed but expense was NOT saved. Please try again.",
          error: "No expense ID returned",
          ocrData: {
            storeName,
            total,
            itemCount: items.length,
            category
          }
        };
      }
      console.log(`[Receipt] \u2705 SUCCESS: EX:${response.expense.id}`);
      if (isVectorStoreConfigured()) {
        const embeddingDate = response.expense.date || (/* @__PURE__ */ new Date()).toISOString();
        saveExpenseItemEmbeddings(
          response.expense.id,
          expenseItems.map((item) => ({
            name: item.name || "Unknown",
            nameLocalized: item.nameLocalized || void 0,
            quantity: item.quantity || 1,
            unitPrice: item.unitPrice || 0,
            totalPrice: (item.quantity || 1) * (item.unitPrice || 0)
          })),
          sourceChannelId,
          embeddingDate,
          senderChannelId
          // Who paid
        ).catch((err) => console.error("[Vector] Embedding save error:", err));
      }
      const formattedAmount = formatAmount(response.expense.amount, response.expense.currency);
      let message = `${storeName} | ${formattedAmount}`;
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
      if (items.length > 0) {
        message += `
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;
        for (const item of items) {
          const qty = item.quantity || 1;
          const unitPrice = item.unitPrice || 0;
          const lineTotal = qty * unitPrice;
          message += `
- ${item.name} x${qty} @ ${formatAmount(unitPrice, currency)} = ${formatAmount(lineTotal, currency)}`;
        }
        message += `
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;
      }
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
        message += `
${paymentStr}`;
      }
      message += `
EX:${response.expense.id}`;
      if (response.splits?.length > 0) {
        message += "\n" + response.splits.map(
          (s) => `   \u2192 @${s.name || "Unknown"} owes ${formatAmount(s.amount, currency)}`
        ).join("\n");
      }
      return {
        success: true,
        expenseId: response.expense.id,
        message,
        ocrData: {
          storeName,
          total,
          itemCount: items.length,
          category
        }
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[Receipt] \u274C FAILED: ${errorMsg}`);
      let userMessage = "ERROR: Failed to process receipt.";
      if (errorMsg.includes("429") || errorMsg.includes("Resource exhausted")) {
        userMessage = "OCR service is busy. Please try again in a few seconds.";
      } else if (errorMsg.includes("download")) {
        userMessage = "Could not download the image. Please try sending it again.";
      } else {
        userMessage = `Failed to process receipt: ${errorMsg}. Please try again.`;
      }
      return {
        success: false,
        message: userMessage,
        error: errorMsg
      };
    }
  }
});

"use strict";
function parseExpenseText$1(text) {
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
    const parsed = parseExpenseText$1(input.text);
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

"use strict";
const genAI$2 = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const EXTRACT_TEXT_PROMPT = `Extract ALL text from this image exactly as shown.
Include every word, number, and symbol visible.
Return ONLY the raw text, no formatting or explanation.`;
const categoryList$2 = Object.keys(CATEGORIES).join("|");
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
  "category": "${categoryList$2}",
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
function sleep$2(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function downloadImage$2(url) {
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
async function callGemini$2(model, content, maxRetries = 3) {
  const geminiModel = genAI$2.getGenerativeModel({ model });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await geminiModel.generateContent(content);
      return response.response.text();
    } catch (error) {
      const isRateLimit = error instanceof Error && (error.message.includes("429") || error.message.includes("Resource exhausted"));
      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1e3;
        console.log(`[OCR] Rate limited, retry in ${delay / 1e3}s (${attempt}/${maxRetries})`);
        await sleep$2(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}
function parseJSON$2(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return JSON.parse(cleaned.trim());
}
const OcrResultSchema = z.object({
  isReceipt: z.boolean(),
  storeName: z.string().nullable(),
  storeNameLocalized: z.string().nullable(),
  category: z.string().nullable(),
  items: z.array(z.object({
    name: z.string(),
    nameLocalized: z.string().nullable(),
    quantity: z.number(),
    unitPrice: z.number(),
    ingredientType: z.string().nullable()
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
    approvalCode: z.string().nullable()
  }).nullable(),
  metadata: z.object({
    receiptNo: z.string().nullable(),
    taxId: z.string().nullable(),
    branch: z.string().nullable(),
    cashier: z.string().nullable(),
    transactionTime: z.string().nullable(),
    transactionDate: z.string().nullable()
  }).nullable()
});
const ocrReceiptTool = createTool({
  id: "ocr-receipt",
  description: `Extract structured data from a receipt image using OCR.
This is a PURE extraction tool - it does NOT create expenses.
Returns: store name, items, total, currency, payment info.

Use this when you need to parse receipt data for workflow processing.
The workflow will handle expense creation separately.`,
  inputSchema: z.object({
    imageUrl: z.string().describe("Receipt image URL to process"),
    imageBase64: z.string().optional().describe("Receipt image as base64 (alternative to URL)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    data: OcrResultSchema.optional(),
    error: z.string().optional()
  }),
  execute: async (input) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[TOOL] \u{1F50D} ocr-receipt CALLED (pure OCR)`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  ImageURL: ${input.imageUrl || "(base64 provided)"}`);
    console.log(`${"=".repeat(60)}
`);
    try {
      let imageData;
      if (input.imageBase64) {
        imageData = {
          data: input.imageBase64.replace(/^data:image\/\w+;base64,/, ""),
          mimeType: "image/jpeg"
        };
      } else if (input.imageUrl) {
        imageData = await downloadImage$2(input.imageUrl);
      } else {
        return {
          success: false,
          error: "No image provided (need imageUrl or imageBase64)"
        };
      }
      console.log("[OCR] Extracting text...");
      const rawText = await callGemini$2("gemini-2.0-flash", [
        EXTRACT_TEXT_PROMPT,
        { inlineData: { data: imageData.data, mimeType: imageData.mimeType } }
      ]);
      console.log(`[OCR] Extracted ${rawText.length} chars`);
      console.log("[OCR] Analyzing text...");
      const analyzePrompt = ANALYZE_TEXT_PROMPT.replace("{TEXT}", rawText);
      const analysisText = await callGemini$2("gemini-2.0-flash", [analyzePrompt]);
      const ocrResult = parseJSON$2(analysisText);
      console.log(`[OCR] isReceipt: ${ocrResult.isReceipt}, items: ${ocrResult.items?.length || 0}`);
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
            currency: "THB",
            payment: null,
            metadata: null
          }
        };
      }
      const items = (ocrResult.items || []).map((item) => ({
        name: item.name || "Unknown",
        nameLocalized: item.nameLocalized || null,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        ingredientType: item.ingredientType || null
      }));
      const payment = ocrResult.payment;
      const metadata = ocrResult.metadata;
      const data = {
        isReceipt: true,
        storeName: ocrResult.storeName || null,
        storeNameLocalized: ocrResult.storeNameLocalized || null,
        category: ocrResult.category || null,
        items,
        subtotal: ocrResult.subtotal || null,
        tax: ocrResult.tax || null,
        serviceCharge: ocrResult.serviceCharge || null,
        discount: ocrResult.discount || null,
        total: ocrResult.total || null,
        currency: ocrResult.currency || "THB",
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
          transactionTime: metadata.transactionTime || null,
          transactionDate: metadata.transactionDate || null
        } : null
      };
      console.log(`[OCR] \u2705 SUCCESS: ${data.storeName} | ${data.total} ${data.currency}`);
      return {
        success: true,
        data
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[OCR] \u274C FAILED: ${errorMsg}`);
      return {
        success: false,
        error: errorMsg
      };
    }
  }
});

"use strict";
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

"use strict";
const getUserPreferencesTool = createTool({
  id: "get-user-preferences",
  description: `Get user's preferences including language setting.
Call this to know which language (th/en) to use for responses.`,
  inputSchema: z.object({
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    language: z.enum(["th", "en"]).describe("User language preference"),
    timezone: z.string().optional(),
    name: z.string().optional()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: true, language: "th" };
    }
    try {
      const response = await apiRequest("GET", "/users/me", context);
      return {
        success: true,
        language: response.user.language === "en" ? "en" : "th",
        timezone: response.user.timezone,
        name: response.user.name || void 0
      };
    } catch (error) {
      return {
        success: true,
        language: "th"
      };
    }
  }
});
const setUserLanguageTool = createTool({
  id: "set-user-language",
  description: `Set user's preferred language for responses.
Use when user says "speak English", "speak Thai", "use Thai", etc.`,
  inputSchema: z.object({
    language: z.enum(["th", "en"]).describe("Language: th (Thai) or en (English)"),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).optional().describe("Chat channel (auto-injected)"),
    senderChannelId: z.string().optional().describe("User channel ID (auto-injected)"),
    sourceChannelId: z.string().optional().describe("Group/DM channel ID (auto-injected)")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: "Error: Missing context" };
    }
    try {
      await apiRequest("PATCH", "/users/me", context, {
        language: input.language
      });
      const message = input.language === "th" ? "Language set to Thai" : "Language set to English";
      return {
        success: true,
        message
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : "Failed to update language"}`
      };
    }
  }
});

"use strict";
const searchSimilarPurchasesTool = createTool({
  id: "search-similar-purchases",
  description: `Semantic search for similar items in purchase history.
Works across languages: "banana" matches "\u0E01\u0E25\u0E49\u0E27\u0E22", "milk" matches "\u0E19\u0E21".
Use this to check if user recently bought an item.

Returns matches sorted by date (most recent first).`,
  inputSchema: z.object({
    query: z.string().describe('Item to search for: "banana", "\u0E01\u0E25\u0E49\u0E27\u0E22", "milk"'),
    lookbackDays: z.number().default(14).describe("Days to look back (default: 14)")
  }),
  outputSchema: z.object({
    found: z.boolean(),
    message: z.string(),
    matches: z.array(z.object({
      name: z.string(),
      nameLocalized: z.string().optional(),
      date: z.string(),
      quantity: z.number(),
      unit: z.string().optional(),
      totalPrice: z.number(),
      expenseId: z.string(),
      itemType: z.string(),
      daysSince: z.number(),
      similarity: z.number(),
      paidBy: z.string().optional()
    })),
    lastPurchase: z.object({
      name: z.string(),
      date: z.string(),
      quantity: z.number(),
      unit: z.string().optional(),
      totalPrice: z.number(),
      daysSince: z.number()
    }).optional()
  }),
  execute: async (input, ctx) => {
    const reqCtx = ctx?.requestContext;
    const sourceChannelId = reqCtx?.get("sourceChannelId");
    console.log(`
${"=".repeat(60)}`);
    console.log(`[TOOL] \u{1F50D} search-similar-purchases CALLED`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Query:        "${input.query}"`);
    console.log(`  Lookback:     ${input.lookbackDays} days`);
    console.log(`  SourceId:     ${sourceChannelId}`);
    console.log(`${"=".repeat(60)}
`);
    if (!sourceChannelId) {
      console.error(`[Insights] \u274C FAILED: Missing sourceChannelId`);
      return {
        found: false,
        message: "Cannot search - missing context.",
        matches: []
      };
    }
    const result = await searchSimilarItems(
      input.query,
      sourceChannelId,
      input.lookbackDays
    );
    if (!result.found) {
      console.log(`[Insights] No matches found for "${input.query}"`);
      return {
        found: false,
        message: `No recent purchases of "${input.query}" found.`,
        matches: []
      };
    }
    const { lastPurchase } = result;
    console.log(`[Insights] Found ${result.matches.length} matches, last: ${lastPurchase?.name} (${lastPurchase?.daysSince} days ago)`);
    return {
      found: true,
      message: lastPurchase ? `Found ${lastPurchase.name} purchased ${lastPurchase.daysSince} days ago (${lastPurchase.quantity} ${lastPurchase.unit || "units"})` : `Found ${result.matches.length} matches`,
      matches: result.matches,
      lastPurchase: lastPurchase ? {
        name: lastPurchase.name,
        date: lastPurchase.date,
        quantity: lastPurchase.quantity,
        unit: lastPurchase.unit,
        totalPrice: lastPurchase.totalPrice,
        daysSince: lastPurchase.daysSince
      } : void 0
    };
  }
});
const getPerishableWindowTool = createTool({
  id: "get-perishable-window",
  description: `Get the typical freshness window for an item type.
Use this to determine if a duplicate purchase warning is relevant.

Item types:
- fresh_produce: 7 days (banana, vegetables)
- dairy: 14 days (milk, yogurt)
- bread: 5 days (bread, pastries)
- meat_seafood: 3 days (chicken, fish)
- eggs: 21 days
- frozen: 60 days
- pantry: 180 days (rice, pasta)
- non_food: 0 (no check)`,
  inputSchema: z.object({
    itemType: z.enum([
      "fresh_produce",
      "dairy",
      "bread",
      "meat_seafood",
      "eggs",
      "frozen",
      "pantry",
      "non_food"
    ]).describe("The item type to get window for")
  }),
  outputSchema: z.object({
    days: z.number(),
    shouldCheck: z.boolean()
  }),
  execute: async (input) => {
    const days = getPerishableWindow(input.itemType);
    return {
      days,
      shouldCheck: input.itemType !== "non_food"
    };
  }
});
const detectItemTypeTool = createTool({
  id: "detect-item-type",
  description: `Detect the perishable type from an item name.
Supports English and Thai. Returns the item type and freshness window.`,
  inputSchema: z.object({
    itemName: z.string().describe("Item name to detect type for")
  }),
  outputSchema: z.object({
    itemType: z.string(),
    freshnessWindow: z.number(),
    shouldCheck: z.boolean()
  }),
  execute: async (input) => {
    const itemType = detectItemType(input.itemName);
    const freshnessWindow = getPerishableWindow(itemType);
    return {
      itemType,
      freshnessWindow,
      shouldCheck: itemType !== "non_food"
    };
  }
});
const checkDuplicatePurchaseTool = createTool({
  id: "check-duplicate-purchase",
  description: `Check if user recently bought a similar item within its freshness window.
Combines search + perishable check. Returns advisory if duplicate found.

Call this when user records a new expense to check for duplicates.`,
  inputSchema: z.object({
    items: z.array(z.object({
      name: z.string(),
      nameLocalized: z.string().optional()
    })).describe("Items being purchased")
  }),
  outputSchema: z.object({
    hasDuplicates: z.boolean(),
    duplicates: z.array(z.object({
      itemName: z.string(),
      lastPurchase: z.object({
        name: z.string(),
        date: z.string(),
        quantity: z.number(),
        daysSince: z.number()
      }),
      freshnessWindow: z.number(),
      isWithinWindow: z.boolean(),
      message: z.string()
    })),
    advisoryMessage: z.string().nullable()
  }),
  execute: async (input, ctx) => {
    const reqCtx = ctx?.requestContext;
    const sourceChannelId = reqCtx?.get("sourceChannelId");
    console.log(`
${"=".repeat(60)}`);
    console.log(`[TOOL] \u{1F504} check-duplicate-purchase CALLED`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Items:    ${input.items.map((i) => i.name).join(", ")}`);
    console.log(`  SourceId: ${sourceChannelId}`);
    console.log(`${"=".repeat(60)}
`);
    if (!sourceChannelId) {
      return {
        hasDuplicates: false,
        duplicates: [],
        advisoryMessage: null
      };
    }
    const duplicates = [];
    for (const item of input.items) {
      const searchQuery = item.nameLocalized ? `${item.name} ${item.nameLocalized}` : item.name;
      const itemType = detectItemType(item.name);
      const freshnessWindow = getPerishableWindow(itemType);
      if (itemType === "non_food") continue;
      const result = await searchSimilarItems(
        searchQuery,
        sourceChannelId,
        freshnessWindow
        // Use freshness window as lookback
      );
      if (result.found && result.lastPurchase) {
        const isWithinWindow = result.lastPurchase.daysSince <= freshnessWindow;
        duplicates.push({
          itemName: item.name,
          lastPurchase: {
            name: result.lastPurchase.name,
            date: result.lastPurchase.date,
            quantity: result.lastPurchase.quantity,
            daysSince: result.lastPurchase.daysSince
          },
          freshnessWindow,
          isWithinWindow,
          message: isWithinWindow ? `You bought ${result.lastPurchase.name} ${result.lastPurchase.daysSince} days ago (${result.lastPurchase.quantity} ${result.lastPurchase.unit || "units"}). Still have some?` : `Last purchase was ${result.lastPurchase.daysSince} days ago (outside ${freshnessWindow}-day window)`
        });
      }
    }
    const relevantDuplicates = duplicates.filter((d) => d.isWithinWindow);
    let advisoryMessage = null;
    if (relevantDuplicates.length > 0) {
      if (relevantDuplicates.length === 1) {
        const d = relevantDuplicates[0];
        advisoryMessage = `\u26A0\uFE0F Heads up! ${d.message}`;
      } else {
        advisoryMessage = `\u26A0\uFE0F Heads up! You recently bought:
` + relevantDuplicates.map((d) => `\u2022 ${d.lastPurchase.name} (${d.lastPurchase.daysSince} days ago)`).join("\n");
      }
    }
    console.log(`[Insights] Found ${relevantDuplicates.length} relevant duplicates`);
    return {
      hasDuplicates: relevantDuplicates.length > 0,
      duplicates,
      advisoryMessage
    };
  }
});

"use strict";
const TEMPLATES = {
  // Expense creation
  expenseCreated: (data) => `${data.description} | ${data.amount}
Category: ${data.category}
EX:${data.id}`,
  // Expense with items (receipt)
  expenseWithItems: (data) => `${data.description} | ${data.amount}
Category: ${data.category}${data.date ? `
${data.date}` : ""}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.items}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500${data.payment ? `
Paid: ${data.payment}` : ""}
EX:${data.id}`,
  // Expense with split
  expenseWithSplit: (data) => `${data.description} | ${data.amount}
Category: ${data.category}
Split ${data.splitCount} ways (${data.eachAmount} each)
${data.splits}EX:${data.id}`,
  // Split line
  splitLine: (data) => `   \u2192 @${data.name} owes ${data.amount}`,
  // Item line (no translation needed - item names kept as-is)
  itemLine: (data) => `- ${data.name} x${data.qty} @ ${data.unitPrice} = ${data.total}
`,
  // Balance check
  balances: (data) => `Outstanding balances:
${data.balances}`,
  balanceLine: (data) => `- @${data.name} owes ${data.amount}`,
  noBalances: () => "No outstanding balances. Everyone is settled up!",
  // Settlement
  settlementRecorded: (data) => `Settlement recorded: @${data.from} paid @${data.to} ${data.amount}`,
  // Expense deleted
  expenseDeleted: (data) => `Deleted EX:${data.id}`,
  // Expense history
  expenseHistory: (data) => `Recent Expenses (${data.count} items)
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.expenses}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Total: ${data.total}`,
  expenseHistoryLine: (data) => `- ${data.description} | ${data.amount} | ${data.category} | ${data.date}
`,
  noExpenses: () => "No expenses found for this period.",
  // Spending summary
  spendingSummary: (data) => `Spending Summary ${data.period}
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
${data.breakdown}\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
Total: ${data.total}`,
  // Errors
  error: (data) => `Error: ${data.reason}`,
  notReceipt: () => "This doesn't look like a receipt. Please send a photo of your bill/receipt.",
  // General
  success: () => "Success",
  // Payment method formatting
  paymentMethod: (data) => {
    let str = data.method;
    if (data.cardType && data.last4) str += ` (${data.cardType} **${data.last4})`;
    else if (data.last4) str += ` (**${data.last4})`;
    if (data.bank) str += ` - ${data.bank}`;
    return str;
  }
};
class ResponseBuilder {
  /**
   * Build expense created response
   */
  expenseCreated(data) {
    if (!data.items?.length && !data.splits?.length) {
      return TEMPLATES.expenseCreated(data);
    }
    if (data.items?.length) {
      const itemsStr = data.items.map((item) => TEMPLATES.itemLine(item)).join("");
      const paymentStr = data.payment ? TEMPLATES.paymentMethod(data.payment) : void 0;
      let response = TEMPLATES.expenseWithItems({
        description: data.description,
        amount: data.amount,
        category: data.category,
        date: data.date,
        items: itemsStr,
        payment: paymentStr,
        id: data.id
      });
      if (data.splits?.length) {
        const splitsStr = data.splits.map((s) => TEMPLATES.splitLine(s)).join("\n");
        response = response.replace(`EX:${data.id}`, `${splitsStr}
EX:${data.id}`);
      }
      return response;
    }
    if (data.splits?.length) {
      const splitsStr = data.splits.map((s) => TEMPLATES.splitLine(s)).join("\n") + "\n";
      const totalAmount = parseFloat(data.amount.replace(/[^0-9.]/g, ""));
      const eachAmount = (totalAmount / data.splits.length).toFixed(2);
      const currency = data.amount.match(/[^\d.,\s]+/)?.[0] || "";
      return TEMPLATES.expenseWithSplit({
        description: data.description,
        amount: data.amount,
        category: data.category,
        splitCount: data.splits.length,
        eachAmount: `${currency}${eachAmount}`,
        splits: splitsStr,
        id: data.id
      });
    }
    return TEMPLATES.expenseCreated(data);
  }
}
const responses = new ResponseBuilder();

"use strict";

"use strict";
const __filename$1 = fileURLToPath(import.meta.url);
const __dirname$1 = path.dirname(__filename$1);
function getDataPath(filename) {
  if (process.env.MEMORY_DATABASE_URL) {
    return process.env.MEMORY_DATABASE_URL;
  }
  if (process.env.NODE_ENV === "production") {
    return `file:/app/data/${filename}`;
  }
  return `file:${path.join(process.cwd(), "data", filename)}`;
}
const BILLOG_BASE_INSTRUCTIONS = `You are Billog, an AI Bookkeeper that helps users track expenses and split bills through chat.

## Multi-Agent System

You work alongside an Insights Agent that handles shopping intelligence:
- **You handle**: Expense recording, balance queries, settlements, expense history, help
- **Insights handles**: Item search queries like "have I bought banana?", duplicate purchase warnings

**Stay silent** (let Insights handle) for:
- "have I bought X?" / "\u0E0B\u0E37\u0E49\u0E2D X \u0E2B\u0E23\u0E37\u0E2D\u0E22\u0E31\u0E07?"
- "what groceries did I buy?" / "\u0E0B\u0E37\u0E49\u0E2D\u0E2D\u0E30\u0E44\u0E23\u0E1A\u0E49\u0E32\u0E07?"
- Shopping history and item lookup questions

**You respond** to everything else: expenses, balances, settlements, help, etc.

## Skills

You have access to skills that provide domain knowledge:
- **billog-onboarding**: First interaction flow, welcome messages, help commands
- **billog-bookkeeper**: Categories, response formats, expense tracking
- **billog-reconciliation**: How to adjust and correct expenses
- **billog-interpreter**: Translation rules for user's preferred language

Use the interpreter skill to translate your responses to the user's language. Important:
- Translate labels, confirmations, error messages
- Do NOT translate expense item names, store names, or user nicknames (keep original for querying)

## First Interaction

On first message in a new source (group/DM):
1. Call init-source tool to register source and user
2. Show welcome message based on skill guidance
3. Then process user's actual request if any

## Context

Each message includes a [Context] block with:
- Channel: LINE, WHATSAPP, or TELEGRAM
- SenderChannelId: Who is talking
- SourceChannelId: Which group/DM
- IsGroup: true for groups, false for DM
- SenderName: Display name if available
- SourceName: Group name if available
- QuotedMessageId: ID of message being replied to (if user quoted a message)
- QuotedText: Text of quoted message (may contain EX:expense_id)

Note: User's language preference is provided in the "RESPONSE LANGUAGE" section at the end of instructions.

**Context fields (channel, senderChannelId, sourceChannelId) are auto-injected to all tools.**
You do NOT need to pass these manually - focus on the actual business parameters.

## Querying Specific Expense

When user asks about a SPECIFIC expense (e.g., "how much was this?", "what was that?"):
1. Check if QuotedText contains an expense ID (format: EX:xxx)
2. If found, extract the ID and use get-expense-by-id tool
3. If not found but user is asking about recent expense, query last expense from history

Example:
- User quotes message containing "EX:abc123" and asks "how much was this?"
- Extract "abc123" from QuotedText
- Call get-expense-by-id with expenseId="abc123"

## Expense Recording

When user sends a TEXT message to record spending:
1. Call process-text-expense tool with the text
2. The tool parses, validates, and creates the expense in one step
3. If missing info (e.g., no amount), tool will return questions to ask user
4. Return the confirmation with EX:{expenseId}

Examples:
- "coffee 65" \u2192 process-text-expense \u2192 EX:xxx
- "lunch 600 @all" \u2192 process-text-expense (handles split) \u2192 EX:xxx
- "fuel $80 today" \u2192 process-text-expense (detects USD, date) \u2192 EX:xxx
- "50" \u2192 process-text-expense \u2192 asks "What did you buy?"

\u26A0\uFE0F Use process-text-expense for TEXT messages.
\u26A0\uFE0F Use process-receipt for RECEIPT IMAGES.

## Receipt Processing

When user sends a receipt image:
1. Call process-receipt tool with the imageUrl
2. The tool does OCR + creates expense in ONE step
3. Use the tool's message field in your response (it includes EX:{expenseId})

## Bill Splitting

Split methods:
- **@all** - Equal split with all group members
- **@name @name** - Equal split with specific people
- **"tom 300, jerry 200"** - Exact amounts
- **"tom 60%, jerry 40%"** - Percentage split
- **Item assignment** - "wife's items are X and Y"

## Settlements

When user reports payment:
- "tom paid me 350" \u2192 from=tom, to=me
- "paid jerry 200" \u2192 from=me, to=jerry
- "via promptpay" \u2192 paymentMethod=3

## Error Handling

- If receipt is unclear: Ask for clearer photo or manual input
- If amount missing: Ask "How much was it?"
- If split ambiguous: Ask who to split with
- Never guess amounts - always confirm

## Important Rules

1. Always include expense ID (EX:xxx) in confirmations
2. Auto-detect categories - don't ask unless truly ambiguous
3. Show remaining balance after settlements
4. For large adjustments (>500 THB), confirm first
5. Maintain audit trail - adjustments, not deletions`;
const LANGUAGE_INSTRUCTIONS = {
  th: `

## RESPONSE LANGUAGE: THAI

Respond in Thai. Use the billog-interpreter skill for translation rules.
Remember: Keep expense item names, store names, and @nicknames in original language.`,
  en: `

## RESPONSE LANGUAGE: ENGLISH

Respond in English. Use the billog-interpreter skill for translation rules.
Remember: Keep expense item names, store names, and @nicknames in original language.`
};
function getBillogInstructions({ requestContext }) {
  const userLanguage = requestContext?.get("userLanguage") || "th";
  const languageSuffix = LANGUAGE_INSTRUCTIONS[userLanguage] || LANGUAGE_INSTRUCTIONS.th;
  return BILLOG_BASE_INSTRUCTIONS + languageSuffix;
}
const memoryDbUrl = getDataPath("agent-memory.db");
console.log(`[Memory] Database URL: ${memoryDbUrl}`);
const billogMemory = new Memory({
  // Composite storage for memory domain
  storage: new LibSQLStore({
    id: "billog-memory",
    url: memoryDbUrl
  }),
  // Vector store for semantic recall (same DB, different tables)
  vector: new LibSQLVector({
    id: "billog-vector",
    url: memoryDbUrl
  }),
  // Embedder for semantic search (uses OPENAI_API_KEY)
  embedder: new ModelRouterEmbeddingModel("openai/text-embedding-3-small"),
  options: {
    // Minimal history - expense tracking is quick in/out
    lastMessages: 3,
    // Semantic recall - for "same as yesterday" or "lunch again"
    semanticRecall: {
      topK: 2,
      // 2 similar past expenses is enough
      messageRange: 1,
      // Minimal context around match
      scope: "resource"
      // Search across all threads for this source
    },
    // Working memory - persistent user context (compact template)
    workingMemory: {
      enabled: true,
      scope: "resource",
      template: `# User Profile
- **Language**:
- **Currency**:
- **Common Categories**:
- **Frequent Stores**:

# Group (if applicable)
- **Usual Payer**:
- **Split Method**:
- **Members**:
`
    }
  }
});
const unicodeNormalizer = new UnicodeNormalizer({
  stripControlChars: true,
  // Remove control chars (keep newlines, tabs)
  preserveEmojis: true,
  // Keep 📸 🍕 💰 etc for receipts
  collapseWhitespace: true,
  // Normalize spaces
  trim: true
  // Trim leading/trailing whitespace
});
const tokenLimiter = new TokenLimiterProcessor({
  limit: 8e3
  // Conservative limit for cost control
});
const billogWorkspace = new Workspace({
  filesystem: new LocalFilesystem({
    basePath: path.resolve(__dirname$1, ".."),
    // src/mastra/
    readOnly: true
    // Agent doesn't need to write files
  }),
  skills: ["/skills"]
  // Loads skills from src/mastra/skills/
});
function getBillogModel({ requestContext }) {
  const ctx = requestContext;
  const complexity = ctx?.get("taskComplexity") || "simple";
  return complexity === "high" ? "openai/gpt-4o" : "openai/gpt-4o-mini";
}
const billogAgent = new Agent({
  id: "billog",
  name: "Billog",
  description: "AI Bookkeeper for expense tracking, bill splitting, and group finances",
  instructions: getBillogInstructions,
  model: getBillogModel,
  memory: billogMemory,
  workspace: billogWorkspace,
  // Input processors run before messages reach the LLM
  // Order matters: normalize first, then limit tokens after all context is loaded
  inputProcessors: [
    unicodeNormalizer,
    // 1. Normalize Thai text first
    tokenLimiter
    // 2. Limit tokens (runs after Memory adds history)
  ],
  tools: {
    // Primary expense tools (use these for recording)
    processTextExpense: processTextExpenseTool,
    // For text messages
    processReceipt: processReceiptTool,
    // For receipt images
    // Query/manage expense tools
    getExpenses: getExpensesTool,
    getExpenseById: getExpenseByIdTool,
    deleteExpense: deleteExpenseTool,
    // Balance tools
    getBalances: getBalancesTool,
    getSpendingSummary: getSpendingSummaryTool,
    getMyBalance: getMyBalanceTool,
    // Settlement tools
    recordSettlement: recordSettlementTool,
    // Reconciliation tools
    reconcileExpense: reconcileExpenseTool,
    // Source tools
    initSource: initSourceTool,
    syncMembers: syncMembersTool,
    setNickname: setNicknameTool,
    // Category tools (for queries)
    listCategories: listCategoriesTool,
    getCategoryByName: getCategoryByNameTool,
    // User preference tools
    getUserPreferences: getUserPreferencesTool,
    setUserLanguage: setUserLanguageTool,
    // Legacy (kept for compatibility)
    createExpense: createExpenseTool
  }
});

"use strict";
const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_API_KEY
});
const INSIGHTS_INSTRUCTIONS = `You are Billog's Shopping Insights assistant.
You help users with shopping intelligence and zero-waste goals.

## Your Role

1. **When user records an expense** (isExpenseMessage=true):
   - Check if they recently bought similar items
   - If found within freshness window: warn gently
   - If not found or outside window: STAY SILENT (respond with "SILENT")

2. **When user asks about purchases**:
   - "have I bought banana?" \u2192 search and answer
   - "what groceries did I buy this week?" \u2192 search and summarize
   - "\u0E0B\u0E37\u0E49\u0E2D\u0E01\u0E25\u0E49\u0E27\u0E22\u0E2B\u0E23\u0E37\u0E2D\u0E22\u0E31\u0E07?" \u2192 search and answer in Thai

3. **When NOT to respond**:
   - Balance queries, settlements, expense lists \u2192 STAY SILENT
   - Help requests about using Billog \u2192 STAY SILENT
   - General chat unrelated to shopping \u2192 STAY SILENT

## Perishable Windows

| Category | Days | Examples |
|----------|------|----------|
| Fresh produce | 7 | banana, vegetables, leafy greens |
| Dairy | 14 | milk, yogurt, cheese |
| Bread | 5 | bread, pastries |
| Meat/seafood | 3 | chicken, fish, shrimp |
| Eggs | 21 | eggs |
| Frozen | 60 | frozen items |
| Pantry | 180 | rice, pasta, canned goods |
| Non-food | 0 | no check |

## Response Style

- **Brief and helpful** - not preachy
- **Use emoji sparingly** - just \u26A0\uFE0F for warnings
- **Only speak when you have useful info**
- **Keep item names as-is** - don't translate "banana" to "\u0E01\u0E25\u0E49\u0E27\u0E22" or vice versa

## Examples

**Expense with duplicate found:**
User message indicates expense: "banana 50"
\u2192 Check for recent banana purchases
\u2192 If found 3 days ago: "\u26A0\uFE0F You bought banana 3 days ago (2 bunches). Still have some?"

**Expense without duplicate:**
User message indicates expense: "coffee 65"
\u2192 Check for recent coffee purchases
\u2192 Not found or outside window: "SILENT"

**Direct item query:**
"have I bought banana this week?"
\u2192 Search and respond: "Yes, you bought banana 3 days ago (2 bunches, \u0E3F50)"

**Non-item query:**
"who owes what"
\u2192 "SILENT" (Bookkeeper handles this)

## Critical Rules

1. **ALWAYS respond with "SILENT" when you have nothing useful to say**
2. Only warn about duplicates if:
   - Item was purchased within its freshness window
   - It's a perishable item (not pantry/non-food)
3. For expense messages, use check-duplicate-purchase tool
4. For queries, use search-similar-purchases tool

## Context

Each message includes context:
- Channel: LINE, WHATSAPP, or TELEGRAM
- SenderChannelId: Who is talking
- SourceChannelId: Which group/DM
- IsGroup: true for groups, false for DM
- isExpenseMessage: true if this is an expense being recorded
- expenseItems: items from the expense (if available)
`;
function getInsightsInstructions({
  requestContext
}) {
  const userLanguage = requestContext?.get("userLanguage") || "th";
  const languageSuffix = userLanguage === "th" ? `

## \u0E20\u0E32\u0E29\u0E32: \u0E44\u0E17\u0E22
\u0E15\u0E2D\u0E1A\u0E40\u0E1B\u0E47\u0E19\u0E20\u0E32\u0E29\u0E32\u0E44\u0E17\u0E22` : `

## LANGUAGE: ENGLISH
Respond in English.`;
  return INSIGHTS_INSTRUCTIONS + languageSuffix;
}
const insightsAgent = new Agent({
  id: "insights",
  name: "Insights",
  description: "Shopping intelligence agent for duplicate warnings and item queries",
  instructions: getInsightsInstructions,
  model: google("gemini-2.0-flash"),
  tools: {
    searchSimilarPurchases: searchSimilarPurchasesTool,
    getPerishableWindow: getPerishableWindowTool,
    detectItemType: detectItemTypeTool,
    checkDuplicatePurchase: checkDuplicatePurchaseTool
  }
});

"use strict";
function makeSessionKey(channel, sourceId) {
  return `${channel}:${sourceId}`;
}
function parseSessionKey(key) {
  const [channel, ...rest] = key.split(":");
  if (!channel || rest.length === 0) return null;
  return {
    channel,
    sourceId: rest.join(":")
    // Handle sourceIds with colons
  };
}
function shouldActivate(message, mode, mentionPatterns = []) {
  if (message.source.type === "dm") return true;
  if (mode === "always") return true;
  if (message.mentions && message.mentions.length > 0) {
    return true;
  }
  if (message.text && mentionPatterns.length > 0) {
    const text = message.text.toLowerCase();
    return mentionPatterns.some((pattern) => {
      const regex = new RegExp(pattern, "i");
      return regex.test(text);
    });
  }
  return false;
}

"use strict";
class LineAdapter {
  channel = "LINE";
  accessToken;
  channelSecret;
  apiBase = "https://api.line.me/v2";
  uploadsDir;
  baseUrl;
  constructor(config) {
    this.accessToken = config.channelAccessToken;
    this.channelSecret = config.channelSecret;
    this.uploadsDir = config.uploadsDir || "./uploads";
    this.baseUrl = config.baseUrl || process.env.BASE_URL || "http://localhost:3000";
  }
  async initialize() {
    await fs.mkdir(this.uploadsDir, { recursive: true });
    try {
      const response = await fetch(`${this.apiBase}/bot/info`, {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      });
      if (!response.ok) {
        throw new Error(`LINE API error: ${response.status}`);
      }
      const info = await response.json();
      console.log(`\u2713 LINE adapter initialized: ${info.displayName}`);
    } catch (error) {
      console.error("Failed to initialize LINE adapter:", error);
      throw error;
    }
  }
  /**
   * Verify webhook signature (X-Line-Signature header)
   */
  verifySignature(body, signature) {
    const bodyStr = typeof body === "string" ? body : body.toString("utf-8");
    const hash = crypto.createHmac("SHA256", this.channelSecret).update(bodyStr).digest("base64");
    return hash === signature;
  }
  /**
   * Parse LINE webhook payload into unified messages
   */
  async parseWebhook(payload) {
    const body = payload;
    const messages = [];
    for (const event of body.events) {
      if (event.type !== "message" || !event.message) {
        continue;
      }
      const messageType = event.message.type;
      if (!["text", "image"].includes(messageType)) {
        continue;
      }
      const sourceId = this.getSourceId(event.source);
      const sourceType = event.source.type === "user" ? "dm" : "group";
      let senderName;
      let pictureUrl;
      if (event.source.userId) {
        try {
          const profile = await this.getProfile(
            event.source.userId,
            sourceType === "group" ? sourceId : void 0
          );
          senderName = profile.displayName;
          pictureUrl = profile.pictureUrl;
        } catch {
        }
      }
      let sourceName;
      if (sourceType === "group") {
        try {
          const group = await this.getGroupSummary(sourceId);
          sourceName = group.groupName;
        } catch {
        }
      }
      const mentions = event.message.mention?.mentionees.map((m) => m.userId) || [];
      const message = {
        id: event.message.id,
        channel: "LINE",
        sender: {
          id: event.source.userId || "unknown",
          name: senderName,
          pictureUrl
        },
        source: {
          id: sourceId,
          type: sourceType,
          name: sourceName
        },
        mentions,
        replyToken: event.replyToken,
        timestamp: new Date(event.timestamp)
      };
      if (messageType === "text") {
        message.text = event.message.text;
      }
      if (messageType === "image") {
        try {
          const { url, base64, mimeType } = await this.downloadAndSaveImageWithBase64(event.message.id);
          message.imageUrl = url;
          message.imageBase64 = `data:${mimeType};base64,${base64}`;
          message.text = "[Receipt Image]";
          console.log(`\u2713 Image ready: URL=${url}, base64 length=${base64.length}`);
        } catch (error) {
          console.error("Failed to download image:", error);
          message.text = "[Failed to download image]";
        }
      }
      if (event.message.quotedMessageId) {
        message.quotedMessage = {
          id: event.message.quotedMessageId
        };
        console.log(`\u2713 Message is replying to: ${event.message.quotedMessageId}`);
      }
      messages.push(message);
    }
    return messages;
  }
  /**
   * Download image from LINE and save locally
   * Returns the accessible URL
   */
  async downloadAndSaveImage(messageId) {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }
    const contentType = response.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png") ? "png" : "jpeg";
    const filename = `${messageId}.${ext}`;
    const filepath = path.join(this.uploadsDir, filename);
    const buffer = await response.arrayBuffer();
    await fs.writeFile(filepath, Buffer.from(buffer));
    console.log(`\u2713 Saved image: ${filepath}`);
    return `${this.baseUrl}/uploads/${filename}`;
  }
  /**
   * Download image from LINE and save locally + return base64
   * Returns both URL and base64 for flexibility
   */
  async downloadAndSaveImageWithBase64(messageId) {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    const ext = mimeType.includes("png") ? "png" : "jpeg";
    const filename = `${messageId}.${ext}`;
    const filepath = path.join(this.uploadsDir, filename);
    const buffer = await response.arrayBuffer();
    const nodeBuffer = Buffer.from(buffer);
    await fs.writeFile(filepath, nodeBuffer);
    const base64 = nodeBuffer.toString("base64");
    console.log(`\u2713 Saved image: ${filepath} (${nodeBuffer.length} bytes)`);
    return {
      url: `${this.baseUrl}/uploads/${filename}`,
      base64,
      mimeType
    };
  }
  /**
   * Send response via LINE
   */
  async send(sourceId, response, replyToken) {
    const messages = this.buildLineMessages(response);
    if (replyToken) {
      await this.replyMessage(replyToken, messages);
    } else {
      await this.pushMessage(sourceId, messages);
    }
  }
  // ===========================================
  // Private helpers
  // ===========================================
  getSourceId(source) {
    return source.groupId || source.roomId || source.userId || "unknown";
  }
  async getProfile(userId, groupId) {
    const url = groupId ? `${this.apiBase}/bot/group/${groupId}/member/${userId}` : `${this.apiBase}/bot/profile/${userId}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to get profile: ${response.status}`);
    }
    return response.json();
  }
  async getGroupSummary(groupId) {
    const response = await fetch(`${this.apiBase}/bot/group/${groupId}/summary`, {
      headers: { Authorization: `Bearer ${this.accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`Failed to get group summary: ${response.status}`);
    }
    return response.json();
  }
  buildLineMessages(response) {
    const messages = [];
    if (response.text) {
      const chunks = this.splitText(response.text, 4900);
      for (const chunk of chunks) {
        messages.push({ type: "text", text: chunk });
      }
    }
    if (response.imageUrl) {
      messages.push({
        type: "image",
        originalContentUrl: response.imageUrl,
        previewImageUrl: response.imageUrl
      });
    }
    if (response.quickReplies && response.quickReplies.length > 0 && messages.length > 0) {
      const lastMsg = messages[messages.length - 1];
      lastMsg.quickReply = {
        items: response.quickReplies.map((qr) => ({
          type: "action",
          action: {
            type: "message",
            label: qr.label.substring(0, 20),
            // LINE limit
            text: qr.text
          }
        }))
      };
    }
    return messages;
  }
  splitText(text, maxLength) {
    if (text.length <= maxLength) return [text];
    const chunks = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let breakAt = remaining.lastIndexOf("\n", maxLength);
      if (breakAt < maxLength / 2) {
        breakAt = remaining.lastIndexOf(" ", maxLength);
      }
      if (breakAt < maxLength / 2) {
        breakAt = maxLength;
      }
      chunks.push(remaining.substring(0, breakAt));
      remaining = remaining.substring(breakAt).trimStart();
    }
    return chunks;
  }
  async replyMessage(replyToken, messages) {
    const response = await fetch(`${this.apiBase}/bot/message/reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`
      },
      body: JSON.stringify({ replyToken, messages: messages.slice(0, 5) })
      // LINE limit: 5 messages
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LINE reply failed: ${response.status} ${error}`);
    }
  }
  async pushMessage(to, messages) {
    const response = await fetch(`${this.apiBase}/bot/message/push`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`
      },
      body: JSON.stringify({ to, messages: messages.slice(0, 5) })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LINE push failed: ${response.status} ${error}`);
    }
  }
  /**
   * Download image content from LINE (returns base64)
   * Use downloadAndSaveImage for receipt processing
   */
  async downloadImage(messageId) {
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${messageId}/content`,
      {
        headers: { Authorization: `Bearer ${this.accessToken}` }
      }
    );
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    const mimeType = response.headers.get("content-type") || "image/jpeg";
    return { base64, mimeType };
  }
}

"use strict";
class GatewayRouter {
  adapters = /* @__PURE__ */ new Map();
  config;
  mastra = null;
  agent = null;
  insightsAgent = null;
  workflow = null;
  // Simple in-memory lock per session (prevent concurrent runs)
  sessionLocks = /* @__PURE__ */ new Map();
  // User preferences cache (key: channel:userId)
  userPrefsCache = /* @__PURE__ */ new Map();
  PREFS_CACHE_TTL_MS = 60 * 60 * 1e3;
  // 1 hour
  // Suspended workflow runs (key: sessionKey)
  suspendedRuns = /* @__PURE__ */ new Map();
  SUSPENDED_RUN_TTL_MS = 5 * 60 * 1e3;
  // 5 minutes timeout
  constructor(config) {
    this.config = config;
  }
  /**
   * Initialize the gateway with adapters
   */
  async initialize(mastra) {
    this.mastra = mastra;
    this.agent = mastra.getAgent("billog");
    if (!this.agent) {
      throw new Error("Billog agent not found in Mastra instance");
    }
    this.insightsAgent = mastra.getAgent("insights");
    if (this.insightsAgent) {
      console.log("\u2713 Insights agent registered (parallel mode enabled)");
    } else {
      console.log("\u26A0 Insights agent not found - running in single-agent mode");
    }
    this.workflow = mastra.getWorkflow("messageWorkflow");
    if (!this.workflow) {
      console.warn("Message workflow not found - will use agent only");
    } else {
      console.log("\u2713 Message workflow registered");
    }
    if (this.config.line) {
      const lineAdapter = new LineAdapter({
        channelAccessToken: this.config.line.channelAccessToken,
        channelSecret: this.config.line.channelSecret,
        uploadsDir: this.config.line.uploadsDir,
        baseUrl: this.config.line.baseUrl
      });
      await lineAdapter.initialize();
      this.adapters.set("LINE", lineAdapter);
    }
    console.log(`\u2713 Gateway router initialized with ${this.adapters.size} adapter(s)`);
    setInterval(() => this.cleanupExpiredRuns(), 6e4);
  }
  /**
   * Get adapter by channel
   */
  getAdapter(channel) {
    return this.adapters.get(channel);
  }
  /**
   * Handle LINE webhook
   */
  async handleLineWebhook(body, signature) {
    const adapter = this.adapters.get("LINE");
    if (!adapter) {
      throw new Error("LINE adapter not initialized");
    }
    const bodyStr = typeof body === "string" ? body : JSON.stringify(body);
    if (!adapter.verifySignature(bodyStr, signature)) {
      throw new Error("Invalid LINE signature");
    }
    const messages = await adapter.parseWebhook(body);
    for (const msg of messages) {
      await this.handleMessage(msg);
    }
  }
  /**
   * Handle incoming message from any channel
   */
  async handleMessage(message) {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[GATEWAY] \u{1F4E5} INBOUND MESSAGE`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Channel:    ${message.channel}`);
    console.log(`  Source ID:  ${message.source.id}`);
    console.log(`  Source:     ${message.source.type} - ${message.source.name || "N/A"}`);
    console.log(`  Sender ID:  ${message.sender.id}`);
    console.log(`  Sender:     ${message.sender.name || "N/A"}`);
    console.log(`  Text:       ${message.text?.substring(0, 100) || "(no text)"}`);
    if (message.imageUrl) {
      console.log(`  Image URL:  ${message.imageUrl}`);
    }
    console.log(`${"=".repeat(60)}
`);
    const activationMode = this.config.groupActivation?.mode || "mention";
    const mentionPatterns = this.config.groupActivation?.mentionPatterns || ["@billog", "billog"];
    if (!shouldActivate(message, activationMode, mentionPatterns)) {
      console.log(`[${message.channel}] Skipping (not activated): ${message.text?.substring(0, 50)}`);
      return;
    }
    const sessionKey = makeSessionKey(message.channel, message.source.id);
    await this.acquireLock(sessionKey);
    let context = null;
    try {
      console.log(`[${sessionKey}] Processing: ${message.text?.substring(0, 50) || "(no text)"}`);
      context = await this.buildAgentContext(message);
      console.log(`[${sessionKey}] Context: language=${context.userLanguage}, isGroup=${context.isGroup}`);
      const suspendedRun = this.suspendedRuns.get(sessionKey);
      if (suspendedRun) {
        console.log(`[${sessionKey}] Resuming suspended workflow: ${suspendedRun.runId}`);
        await this.handleResume(message, sessionKey, suspendedRun, context);
        return;
      }
      if (this.workflow) {
        console.log(`[${sessionKey}] \u{1F504} Using WORKFLOW`);
        await this.handleWithWorkflow(message, sessionKey, context);
      } else {
        console.log(`[${sessionKey}] \u{1F916} Using AGENT (no workflow)`);
        await this.handleWithAgent(message, sessionKey, context);
      }
    } catch (error) {
      console.error(`[${sessionKey}] \u274C Error:`, error);
      await this.sendResponse(message, {
        text: context?.userLanguage === "en" ? "Sorry, an error occurred. Please try again." : "\u0E02\u0E2D\u0E2D\u0E20\u0E31\u0E22 \u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E43\u0E2B\u0E21\u0E48\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07"
      });
    } finally {
      this.releaseLock(sessionKey);
    }
  }
  /**
   * Handle message with workflow
   */
  async handleWithWorkflow(message, sessionKey, context) {
    if (!this.workflow) {
      throw new Error("Workflow not initialized");
    }
    if (message.imageUrl || message.imageBase64) {
      const ackMessage = context.userLanguage === "en" ? "\u{1F4F8} Got it! Processing..." : "\u{1F4F8} \u0E44\u0E14\u0E49\u0E23\u0E31\u0E1A\u0E41\u0E25\u0E49\u0E27! \u0E01\u0E33\u0E25\u0E31\u0E07\u0E1B\u0E23\u0E30\u0E21\u0E27\u0E25\u0E1C\u0E25...";
      await this.sendResponse(message, { text: ackMessage });
      message.replyToken = void 0;
    }
    const prefs = await this.getUserPreferences(message.channel, message.sender.id);
    const workflowInput = {
      channel: message.channel,
      senderChannelId: message.sender.id,
      sourceChannelId: message.source.id,
      isGroup: message.source.type === "group",
      senderName: message.sender.name,
      sourceName: message.source.name,
      userLanguage: prefs?.language || "th",
      userCurrency: prefs?.currency || "THB",
      userTimezone: prefs?.timezone || "Asia/Bangkok",
      messageText: message.text,
      imageUrl: message.imageUrl,
      imageBase64: message.imageBase64,
      quotedMessageId: message.quotedMessage?.id,
      quotedMessageText: message.quotedMessage?.text
    };
    const run = await this.workflow.createRun();
    const result = await run.start({ inputData: workflowInput });
    await this.handleWorkflowResult(result, run.runId, sessionKey, message, context);
  }
  /**
   * Handle resume of suspended workflow
   */
  async handleResume(message, sessionKey, suspendedRun, context) {
    if (!this.workflow) {
      throw new Error("Workflow not initialized");
    }
    const resumeData = this.parseResumeData(
      message.text || "",
      suspendedRun.suspendPayload.missingFields
    );
    console.log(`[${sessionKey}] Resume data: ${JSON.stringify(resumeData)}`);
    const run = await this.workflow.createRun({ runId: suspendedRun.runId });
    const result = await run.resume({
      step: suspendedRun.suspendedStep,
      resumeData
    });
    this.suspendedRuns.delete(sessionKey);
    await this.handleWorkflowResult(result, run.runId, sessionKey, message, context);
  }
  /**
   * Handle workflow result (success, suspended, failed)
   */
  async handleWorkflowResult(result, runId, sessionKey, message, context) {
    console.log(`[${sessionKey}] Workflow result: status=${result.status}`);
    if (result.status === "success") {
      const output = result.result;
      console.log(`[${sessionKey}] Workflow output:`, JSON.stringify(output, null, 2));
      if (!output?.message) {
        console.log(`[${sessionKey}] \u26A0\uFE0F No message in workflow output, falling back to agent`);
        await this.handleWithAgent(message, sessionKey, context);
        return;
      }
      console.log(`[${sessionKey}] \u2705 Workflow success: ${output.message.substring(0, 100)}`);
      await this.sendResponse(message, { text: output.message });
      message.replyToken = void 0;
      if (this.insightsAgent && output.expenseId) {
        console.log(`[${sessionKey}] \u{1F4A1} Running Insights for expense`);
        try {
          const insightsResponse = await this.callInsightsAgent(message, context, "expense");
          if (insightsResponse && insightsResponse.trim() !== "SILENT") {
            console.log(`[${sessionKey}] \u{1F4A1} Insights: ${insightsResponse.substring(0, 100)}`);
            await this.sendResponse(message, { text: insightsResponse });
          }
        } catch (error) {
          console.error(`[${sessionKey}] Insights error (non-fatal):`, error);
        }
      }
    } else if (result.status === "suspended") {
      const suspendPayload = result.suspendPayload;
      const suspendedPaths = result.suspended;
      const lastPath = suspendedPaths?.[suspendedPaths.length - 1];
      const suspendedStep = lastPath?.[lastPath.length - 1] || "unknown";
      console.log(`[${sessionKey}] \u23F8\uFE0F Workflow suspended at: ${suspendedStep}`);
      console.log(`[${sessionKey}] Missing fields: ${suspendPayload.missingFields.join(", ")}`);
      this.suspendedRuns.set(sessionKey, {
        runId,
        workflowId: "messageWorkflow",
        suspendedStep,
        suspendPayload,
        originalMessage: message,
        context,
        createdAt: Date.now()
      });
      await this.sendResponse(message, { text: suspendPayload.prompt });
    } else if (result.status === "failed") {
      const errorMsg = result.error?.message || "Unknown error";
      console.error(`[${sessionKey}] \u274C Workflow failed: ${errorMsg}`);
      const text = context.userLanguage === "en" ? `Error: ${errorMsg}` : `\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14: ${errorMsg}`;
      await this.sendResponse(message, { text });
    } else {
      const output = result.result;
      if (output?.status === "fallback") {
        console.log(`[${sessionKey}] \u{1F504} Workflow fallback: ${output.fallbackReason}`);
        await this.handleWithAgent(message, sessionKey, context);
      } else {
        console.warn(`[${sessionKey}] Unexpected workflow status: ${result.status}`);
        await this.handleWithAgent(message, sessionKey, context);
      }
    }
  }
  /**
   * Parse user's reply to extract resume data
   */
  parseResumeData(text, missingFields) {
    const parsed = parseExpenseText(text);
    const resumeData = {};
    if (missingFields.includes("amount") && parsed.amount) {
      resumeData.amount = parsed.amount;
    }
    if (missingFields.includes("description") && parsed.description) {
      resumeData.description = parsed.description;
    }
    if (missingFields.includes("splitInfo") && parsed.splitTargets.length > 0) {
      resumeData.splitTargets = parsed.splitTargets;
    }
    if (!resumeData.description && !resumeData.amount && text.trim()) {
      const numMatch = text.match(/^\s*(\d+(?:\.\d{2})?)\s*$/);
      if (numMatch) {
        resumeData.amount = parseFloat(numMatch[1]);
      } else {
        resumeData.description = text.trim();
      }
    }
    return resumeData;
  }
  /**
   * Handle message with agent (fallback)
   * Runs both Bookkeeper and Insights agents in parallel when appropriate
   */
  async handleWithAgent(message, sessionKey, context) {
    const taskComplexity = this.detectComplexity(message);
    if (taskComplexity === "high" && (message.imageUrl || message.imageBase64)) {
      await this.sendResponse(message, { text: "\u{1F4F8} Thanks! Working on it..." });
      message.replyToken = void 0;
    }
    const intent = this.detectMessageIntent(message);
    console.log(`[${sessionKey}] Intent: ${intent}`);
    const agentInput = this.formatAgentInput(message, context);
    const shouldRunInsights = this.insightsAgent && (intent === "expense" || intent === "insight_query");
    if (shouldRunInsights && this.insightsAgent) {
      console.log(`[${sessionKey}] \u{1F500} Running PARALLEL agents (Bookkeeper + Insights)`);
      const [bookkeeperResult, insightsResult] = await Promise.allSettled([
        // Bookkeeper (skip for insight-only queries)
        intent !== "insight_query" ? this.callAgent(agentInput, message.source.id, message.channel, context, taskComplexity) : Promise.resolve(null),
        // Insights
        this.callInsightsAgent(message, context, intent)
      ]);
      if (bookkeeperResult.status === "fulfilled" && bookkeeperResult.value) {
        console.log(`[${sessionKey}] \u{1F916} Bookkeeper: ${bookkeeperResult.value.substring(0, 100)}`);
        await this.sendResponse(message, { text: bookkeeperResult.value });
        message.replyToken = void 0;
      } else if (bookkeeperResult.status === "rejected") {
        console.error(`[${sessionKey}] \u274C Bookkeeper error:`, bookkeeperResult.reason);
      }
      if (insightsResult.status === "fulfilled" && insightsResult.value) {
        const insightsResponse = insightsResult.value.trim();
        if (insightsResponse && insightsResponse !== "SILENT") {
          console.log(`[${sessionKey}] \u{1F4A1} Insights: ${insightsResponse.substring(0, 100)}`);
          await this.sendResponse(message, { text: insightsResponse });
        } else {
          console.log(`[${sessionKey}] \u{1F4A1} Insights: (silent)`);
        }
      } else if (insightsResult.status === "rejected") {
        console.error(`[${sessionKey}] \u274C Insights error:`, insightsResult.reason);
      }
    } else {
      console.log(`[${sessionKey}] \u{1F916} Running SINGLE agent (Bookkeeper only)`);
      const response = await this.callAgent(
        agentInput,
        message.source.id,
        message.channel,
        context,
        taskComplexity
      );
      console.log(`[${sessionKey}] Agent response: ${response?.substring(0, 200) || "(no response)"}`);
      if (response) {
        await this.sendResponse(message, { text: response });
      }
    }
  }
  /**
   * Detect message intent for agent routing
   */
  detectMessageIntent(message) {
    const text = (message.text || "").toLowerCase().trim();
    const expensePatterns = [
      /^\d+(?:\.\d{2})?$/,
      // Just a number
      /^[฿$€]\d+/,
      // Currency + number
      /\d+(?:\.\d{2})?\s*(?:THB|บาท|USD|EUR)/i,
      /^\w+\s+\d+/,
      // "coffee 65"
      /^\d+\s+\w+/
      // "65 coffee"
    ];
    if (message.imageUrl || message.imageBase64) {
      return "expense";
    }
    const insightQueryPatterns = [
      /have i bought/i,
      /did i buy/i,
      /ซื้อ.*หรือยัง/i,
      /ซื้อ.*ไหม/i,
      /เคยซื้อ/i,
      /bought.*recently/i,
      /what.*groceries/i,
      /ซื้ออะไร.*บ้าง/i
    ];
    for (const pattern of insightQueryPatterns) {
      if (pattern.test(text)) {
        return "insight_query";
      }
    }
    const queryPatterns = [
      /who owes/i,
      /ใครเป็นหนี้/i,
      /balance/i,
      /ยอด/i,
      /summary/i,
      /สรุป/i,
      /list expenses/i,
      /show expenses/i,
      /expenses/i
    ];
    for (const pattern of queryPatterns) {
      if (pattern.test(text)) {
        return "query";
      }
    }
    const settlementPatterns = [
      /paid/i,
      /จ่าย.*แล้ว/i,
      /โอน.*แล้ว/i,
      /settle/i
    ];
    for (const pattern of settlementPatterns) {
      if (pattern.test(text)) {
        return "settlement";
      }
    }
    const helpPatterns = [
      /help/i,
      /ช่วย/i,
      /how to/i,
      /วิธี/i
    ];
    for (const pattern of helpPatterns) {
      if (pattern.test(text)) {
        return "help";
      }
    }
    for (const pattern of expensePatterns) {
      if (pattern.test(text)) {
        return "expense";
      }
    }
    return "other";
  }
  /**
   * Call Insights Agent
   */
  async callInsightsAgent(message, context, intent) {
    if (!this.insightsAgent) {
      return null;
    }
    const isExpenseMessage = intent === "expense";
    let expenseItems = [];
    if (isExpenseMessage && message.text) {
      const parsed = parseExpenseText(message.text);
      if (parsed.description) {
        expenseItems = [{ name: parsed.description }];
      }
    }
    const contextLines = [
      `[Context]`,
      `Channel: ${context.channel}`,
      `SenderChannelId: ${context.senderChannelId}`,
      `SourceChannelId: ${context.sourceChannelId}`,
      `IsGroup: ${context.isGroup}`,
      `isExpenseMessage: ${isExpenseMessage}`
    ];
    if (expenseItems.length > 0) {
      contextLines.push(`expenseItems: ${JSON.stringify(expenseItems)}`);
    }
    const messageText = message.text || "";
    const content = `${contextLines.join("\n")}

[Message]
${messageText}`;
    const requestContext = new RequestContext();
    requestContext.set("userLanguage", context.userLanguage || "th");
    requestContext.set("userTimezone", context.userTimezone || "Asia/Bangkok");
    requestContext.set("channel", context.channel);
    requestContext.set("senderChannelId", context.senderChannelId);
    requestContext.set("sourceChannelId", context.sourceChannelId);
    requestContext.set("isGroup", context.isGroup);
    requestContext.set("isExpenseMessage", isExpenseMessage);
    requestContext.set("expenseItems", expenseItems);
    try {
      const result = await this.insightsAgent.generate(content, {
        requestContext,
        toolChoice: "auto",
        maxSteps: 3
      });
      return result.text || null;
    } catch (error) {
      console.error(`[Insights] Agent error:`, error);
      return null;
    }
  }
  /**
   * Send response via the appropriate channel
   */
  async sendResponse(originalMessage, response) {
    const adapter = this.adapters.get(originalMessage.channel);
    if (!adapter) {
      console.error(`No adapter for channel: ${originalMessage.channel}`);
      return;
    }
    await adapter.send(
      originalMessage.source.id,
      response,
      originalMessage.replyToken
    );
  }
  /**
   * Detect task complexity for model routing
   */
  detectComplexity(message) {
    if (message.imageUrl || message.imageBase64) {
      return "high";
    }
    return "simple";
  }
  /**
   * Build context for agent tools
   */
  async buildAgentContext(message) {
    const prefs = await this.getUserPreferences(message.channel, message.sender.id);
    return {
      channel: message.channel,
      senderChannelId: message.sender.id,
      sourceChannelId: message.source.id,
      isGroup: message.source.type === "group",
      senderName: message.sender.name,
      sourceName: message.source.name,
      userLanguage: prefs?.language,
      userTimezone: prefs?.timezone
    };
  }
  /**
   * Get user preferences (with caching)
   */
  async getUserPreferences(channel, userId) {
    const cacheKey = `${channel}:${userId}`;
    const cached = this.userPrefsCache.get(cacheKey);
    if (cached && Date.now() - cached.fetchedAt < this.PREFS_CACHE_TTL_MS) {
      return cached;
    }
    try {
      const context = {
        channel,
        senderChannelId: userId,
        sourceChannelId: userId
      };
      const data = await apiRequest("GET", "/users/me", context);
      const prefs = {
        language: data.user?.language === "en" ? "en" : "th",
        timezone: data.user?.timezone || "Asia/Bangkok",
        currency: data.user?.currency || "THB",
        fetchedAt: Date.now()
      };
      this.userPrefsCache.set(cacheKey, prefs);
      console.log(`[Gateway] Loaded user prefs: language=${prefs.language}, currency=${prefs.currency}`);
      return prefs;
    } catch (error) {
      console.log(`[Gateway] User prefs not found (will use defaults)`);
      return null;
    }
  }
  /**
   * Invalidate user preferences cache
   */
  invalidateUserPrefs(channel, userId) {
    const cacheKey = `${channel}:${userId}`;
    this.userPrefsCache.delete(cacheKey);
  }
  /**
   * Format message for agent input
   */
  formatAgentInput(message, context) {
    const contextLines = [
      `[Context]`,
      `Channel: ${context.channel}`,
      `SenderChannelId: ${context.senderChannelId}`,
      `SourceChannelId: ${context.sourceChannelId}`,
      `IsGroup: ${context.isGroup}`
    ];
    if (context.senderName) {
      contextLines.push(`SenderName: ${context.senderName}`);
    }
    if (context.sourceName) {
      contextLines.push(`SourceName: ${context.sourceName}`);
    }
    if (message.quotedMessage) {
      contextLines.push(`QuotedMessageId: ${message.quotedMessage.id}`);
      if (message.quotedMessage.text) {
        contextLines.push(`QuotedText: ${message.quotedMessage.text}`);
      }
    }
    let messageText = message.text || "";
    if (message.source.type === "group") {
      const senderLabel = message.sender.name || message.sender.id;
      messageText = `[From: ${senderLabel}]
${messageText}`;
    }
    const textContent = `${contextLines.join("\n")}

[Message]
${messageText}`;
    if (message.imageUrl) {
      console.log(`[GATEWAY] \u{1F9FE} Receipt: ${message.imageUrl}`);
      return textContent + `

[Receipt Image]
ImageURL: ${message.imageUrl}`;
    }
    return textContent;
  }
  /**
   * Call the Billog agent
   */
  async callAgent(input, sourceId, channel, context, taskComplexity) {
    if (!this.agent) {
      throw new Error("Agent not initialized");
    }
    const messages = Array.isArray(input) ? [{ role: "user", content: input }] : input;
    const requestContext = new RequestContext();
    requestContext.set("userLanguage", context.userLanguage || "th");
    requestContext.set("userTimezone", context.userTimezone || "Asia/Bangkok");
    requestContext.set("channel", context.channel);
    requestContext.set("senderChannelId", context.senderChannelId);
    requestContext.set("sourceChannelId", context.sourceChannelId);
    requestContext.set("isGroup", context.isGroup);
    if (context.senderName) requestContext.set("senderName", context.senderName);
    if (context.sourceName) requestContext.set("sourceName", context.sourceName);
    requestContext.set("taskComplexity", taskComplexity);
    const result = await this.agent.generate(messages, {
      memory: {
        thread: sourceId,
        resource: `${channel}:${sourceId}`
      },
      requestContext,
      toolChoice: "auto",
      maxSteps: 5
    });
    return result.text || null;
  }
  // ===========================================
  // Session Locking
  // ===========================================
  async acquireLock(sessionKey) {
    while (this.sessionLocks.has(sessionKey)) {
      await this.sessionLocks.get(sessionKey);
    }
    let releaseLock;
    const lockPromise = new Promise((resolve) => {
      releaseLock = resolve;
    });
    lockPromise.__release = releaseLock;
    this.sessionLocks.set(sessionKey, lockPromise);
  }
  releaseLock(sessionKey) {
    const lock = this.sessionLocks.get(sessionKey);
    if (lock) {
      lock.__release?.();
      this.sessionLocks.delete(sessionKey);
    }
  }
  // ===========================================
  // Cleanup
  // ===========================================
  cleanupExpiredRuns() {
    const now = Date.now();
    for (const [key, run] of this.suspendedRuns) {
      if (now - run.createdAt > this.SUSPENDED_RUN_TTL_MS) {
        console.log(`[Gateway] Cleaning up expired suspended run: ${key}`);
        this.suspendedRuns.delete(key);
      }
    }
  }
  async shutdown() {
    for (const adapter of this.adapters.values()) {
      await adapter.shutdown?.();
    }
    this.adapters.clear();
    this.suspendedRuns.clear();
    console.log("Gateway router shutdown complete");
  }
}
function createGateway(config) {
  return new GatewayRouter(config);
}

"use strict";
class WhatsAppAdapter extends EventEmitter {
  channel = "WHATSAPP";
  sock = null;
  sessionPath;
  messageHandler = null;
  botJid = null;
  constructor(config = {}) {
    super();
    this.sessionPath = config.sessionPath || "./data/whatsapp";
  }
  /**
   * Set message handler (called when message received)
   */
  onMessage(handler) {
    this.messageHandler = handler;
  }
  /**
   * Initialize WhatsApp connection
   */
  async initialize() {
    let baileys;
    try {
      baileys = await import('@whiskeysockets/baileys');
    } catch {
      console.log("\u26A0\uFE0F WhatsApp: baileys not installed, skipping WhatsApp adapter");
      return;
    }
    const {
      makeWASocket,
      DisconnectReason,
      useMultiFileAuthState,
      fetchLatestBaileysVersion
    } = baileys;
    const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);
    const { version } = await fetchLatestBaileysVersion();
    this.sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: true,
      // Reduce noise
      logger: {
        level: "silent",
        child: () => ({ level: "silent" }),
        trace: () => {
        },
        debug: () => {
        },
        info: () => {
        },
        warn: console.warn,
        error: console.error,
        fatal: console.error
      }
    });
    this.sock.ev.on("creds.update", saveCreds);
    this.sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr) {
        console.log("\u{1F4F1} WhatsApp: Scan QR code to connect");
      }
      if (connection === "close") {
        const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log("WhatsApp: Reconnecting...");
          this.initialize();
        } else {
          console.log("WhatsApp: Logged out");
        }
      }
      if (connection === "open") {
        this.botJid = this.sock?.user?.id || null;
        console.log(`\u2713 WhatsApp adapter connected: ${this.sock?.user?.name || "Unknown"}`);
      }
    });
    this.sock.ev.on("messages.upsert", async (m) => {
      for (const msg of m.messages) {
        if (msg.key.fromMe) continue;
        const inbound = this.parseMessage(msg);
        if (inbound && this.messageHandler) {
          try {
            await this.messageHandler(inbound);
          } catch (error) {
            console.error("WhatsApp message handler error:", error);
          }
        }
      }
    });
  }
  /**
   * Parse webhook is not used for WhatsApp (uses socket events)
   */
  async parseWebhook(_payload) {
    return [];
  }
  /**
   * Send response via WhatsApp
   */
  async send(sourceId, response, _replyToken) {
    if (!this.sock) {
      throw new Error("WhatsApp not connected");
    }
    if (response.text) {
      await this.sock.sendMessage(sourceId, { text: response.text });
    }
    if (response.imageUrl) {
      await this.sock.sendMessage(sourceId, {
        image: { url: response.imageUrl },
        caption: response.text ? void 0 : "Image"
        // Only add caption if no text sent
      });
    }
  }
  /**
   * Shutdown connection
   */
  async shutdown() {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
    }
  }
  // ===========================================
  // Private helpers
  // ===========================================
  parseMessage(msg) {
    const jid = msg.key.remoteJid;
    if (!jid) return null;
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || msg.message?.imageMessage?.caption;
    const isGroup = jid.endsWith("@g.us");
    const sourceType = isGroup ? "group" : "dm";
    const senderId = isGroup ? msg.key.participant || "unknown" : jid.split("@")[0];
    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const botMentioned = this.botJid ? mentions.includes(this.botJid) : false;
    return {
      id: msg.key.id || `wa-${Date.now()}`,
      channel: "WHATSAPP",
      text,
      sender: {
        id: senderId,
        name: msg.pushName
      },
      source: {
        id: jid,
        type: sourceType
      },
      mentions: botMentioned ? [this.botJid] : mentions,
      timestamp: new Date((msg.messageTimestamp || Date.now()) * 1e3)
    };
  }
  /**
   * Get JID from phone number
   */
  formatJid(phoneNumber) {
    const cleaned = phoneNumber.replace(/\D/g, "");
    return `${cleaned}@s.whatsapp.net`;
  }
  /**
   * Check if connected
   */
  get connected() {
    return this.sock !== null;
  }
}

"use strict";

"use strict";
const ChannelSchema = z.enum(["LINE", "WHATSAPP", "TELEGRAM"]);
const LanguageSchema = z.enum(["th", "en"]);
const MessageInputSchema = z.object({
  // Channel context
  channel: ChannelSchema,
  senderChannelId: z.string(),
  sourceChannelId: z.string(),
  isGroup: z.boolean(),
  senderName: z.string().optional(),
  sourceName: z.string().optional(),
  // User preferences
  userLanguage: LanguageSchema.default("th"),
  userCurrency: z.string().default("THB"),
  userTimezone: z.string().default("Asia/Bangkok"),
  // Message content
  messageText: z.string().optional(),
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),
  // Quote context (for expense lookup)
  quotedMessageId: z.string().optional(),
  quotedMessageText: z.string().optional()
});
const ParsedExpenseItemSchema = z.object({
  name: z.string(),
  nameLocalized: z.string().nullable(),
  quantity: z.number().default(1),
  unitPrice: z.number(),
  ingredientType: z.string().nullable().optional(),
  assignedTo: z.string().optional()
  // For item-based splits
});
const ParsedExpenseSchema = z.object({
  description: z.string().nullable(),
  amount: z.number().nullable(),
  currency: z.string().default("THB"),
  category: z.string().nullable(),
  date: z.string().nullable(),
  // YYYY-MM-DD
  // Split info (group only)
  splitType: z.enum(["equal", "exact", "percentage", "item"]).nullable(),
  splitTargets: z.array(z.string()).default([]),
  // @all, @name
  // Items (from receipt OCR)
  items: z.array(ParsedExpenseItemSchema).default([]),
  // Payment info (from receipt OCR)
  payment: z.object({
    method: z.string().nullable(),
    cardType: z.string().nullable(),
    cardLast4: z.string().nullable(),
    bankName: z.string().nullable()
  }).nullable().optional(),
  // Metadata
  metadata: z.record(z.unknown()).optional()
});
const MessageWorkflowStateSchema = z.object({
  // Source initialization
  sourceInitialized: z.boolean().default(false),
  isNewSource: z.boolean().default(false),
  isNewUser: z.boolean().default(false),
  // Message type detection (nullable with default)
  messageType: z.enum(["expense_text", "expense_receipt", "query", "settlement", "help", "other"]).nullable().default(null),
  // Parsed expense (accumulated from parse/OCR steps)
  parsedExpense: ParsedExpenseSchema.nullable().default(null),
  // OCR specific
  isReceipt: z.boolean().default(false),
  // Validation
  isValid: z.boolean().default(false),
  missingFields: z.array(z.string()).default([]),
  // Group-specific
  groupMembers: z.array(z.object({
    id: z.string(),
    name: z.string().nullable(),
    nickname: z.string().nullable()
  })).default([]),
  // Result (nullable with default)
  expenseId: z.string().nullable().default(null),
  responseMessage: z.string().nullable().default(null),
  // Error handling (nullable with default)
  error: z.string().nullable().default(null)
});
const initialMessageWorkflowState = {
  sourceInitialized: false,
  isNewSource: false,
  isNewUser: false,
  messageType: null,
  parsedExpense: null,
  isReceipt: false,
  isValid: false,
  missingFields: [],
  groupMembers: [],
  expenseId: null,
  responseMessage: null,
  error: null
};
const MessageOutputSchema = z.object({
  success: z.boolean(),
  status: z.enum(["completed", "suspended", "failed", "fallback"]),
  message: z.string(),
  expenseId: z.string().optional(),
  // For suspend/resume
  suspendReason: z.string().optional(),
  missingFields: z.array(z.string()).optional(),
  // For fallback (agent handling)
  fallbackReason: z.string().optional()
});
const ExpenseResumeSchema = z.object({
  description: z.string().optional(),
  amount: z.number().optional(),
  splitTargets: z.array(z.string()).optional()
});
function buildApiContext(input) {
  return {
    channel: input.channel,
    senderChannelId: input.senderChannelId,
    sourceChannelId: input.sourceChannelId,
    sourceType: input.isGroup ? "GROUP" : "DM"
  };
}

"use strict";
const EnsureSourceInitOutputSchema = z.object({
  sourceInitialized: z.boolean(),
  isNewSource: z.boolean(),
  isNewUser: z.boolean()
});
const ensureSourceInitStep = createStep({
  id: "ensure-source-init",
  description: "Initialize source, user, and membership in the system",
  inputSchema: MessageInputSchema,
  outputSchema: EnsureSourceInitOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    const input = inputData;
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] ensure-source-init`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Channel:    ${input.channel}`);
    console.log(`  Source:     ${input.sourceChannelId} (${input.isGroup ? "GROUP" : "DM"})`);
    console.log(`  Sender:     ${input.senderChannelId}`);
    console.log(`${"=".repeat(60)}
`);
    const context = buildApiContext(input);
    try {
      const response = await apiRequest("POST", "/sources/init", context, {
        channel: input.channel,
        sourceChannelId: input.sourceChannelId,
        sourceType: input.isGroup ? "GROUP" : "DM",
        sourceName: input.sourceName,
        senderChannelId: input.senderChannelId,
        senderDisplayName: input.senderName,
        currency: input.userCurrency
      });
      const isNewSource = response.isNewSource ?? false;
      const isNewUser = response.isNewUser ?? false;
      if (isNewSource) {
        console.log(`[ensure-source-init] New source: ${response.source?.name}`);
      }
      if (isNewUser) {
        console.log(`[ensure-source-init] New user: ${response.user?.name}`);
      }
      setState({
        ...state,
        sourceInitialized: true,
        isNewSource,
        isNewUser
      });
      console.log(`[ensure-source-init] \u2705 Source initialized`);
      return {
        sourceInitialized: true,
        isNewSource,
        isNewUser
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[ensure-source-init] \u274C Error: ${errorMsg}`);
      setState({
        ...state,
        sourceInitialized: false,
        isNewSource: false,
        isNewUser: false,
        error: `Source init failed: ${errorMsg}`
      });
      return {
        sourceInitialized: false,
        isNewSource: false,
        isNewUser: false
      };
    }
  }
});

"use strict";
const DmParseTextInputSchema = z.object({
  messageText: z.string(),
  userCurrency: z.string().default("THB"),
  userLanguage: z.enum(["th", "en"]).default("th")
});
const DmParseTextOutputSchema = z.object({
  success: z.boolean(),
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string())
});
const dmParseTextStep = createStep({
  id: "dm-parse-text",
  description: "Parse text message into expense data (DM - no splits)",
  inputSchema: DmParseTextInputSchema,
  outputSchema: DmParseTextOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] dm-parse-text`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Text: "${inputData.messageText}"`);
    console.log(`${"=".repeat(60)}
`);
    const parsed = parseExpenseText(inputData.messageText);
    parsed.splitType = null;
    parsed.splitTargets = [];
    if (parsed.currency === "THB" && inputData.userCurrency !== "THB") {
      const hasExplicitCurrency = /[฿$€¥]|\b(THB|USD|EUR|JPY|AUD)\b/i.test(inputData.messageText);
      if (!hasExplicitCurrency) {
        parsed.currency = inputData.userCurrency;
      }
    }
    const { isValid, missingFields } = validateParsedExpense(parsed);
    console.log(`[dm-parse-text] Parsed: ${JSON.stringify(parsed)}`);
    console.log(`[dm-parse-text] Valid: ${isValid}, Missing: ${missingFields.join(", ") || "none"}`);
    const parsedExpense = {
      description: parsed.description,
      amount: parsed.amount,
      currency: parsed.currency,
      category: parsed.category,
      date: parsed.date,
      splitType: null,
      splitTargets: [],
      items: [],
      payment: null,
      metadata: void 0
    };
    setState({
      ...state,
      messageType: "expense_text",
      parsedExpense,
      isValid,
      missingFields
    });
    return {
      success: true,
      parsedExpense,
      isValid,
      missingFields
    };
  }
});

"use strict";
const genAI$1 = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const categoryList$1 = Object.keys(CATEGORIES).join("|");
const OCR_PROMPT$1 = `Extract and analyze this receipt image. Return JSON only.

{
  "isReceipt": true/false,
  "storeName": "store name in English",
  "storeNameLocalized": "original name if not English, else null",
  "category": "${categoryList$1}",
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
function sleep$1(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function downloadImage$1(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "image/*,*/*;q=0.8" }
  });
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return {
    data: Buffer.from(buffer).toString("base64"),
    mimeType: response.headers.get("content-type") || "image/jpeg"
  };
}
async function callGemini$1(model, content, maxRetries = 3) {
  const geminiModel = genAI$1.getGenerativeModel({ model });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await geminiModel.generateContent(content);
      return response.response.text();
    } catch (error) {
      const isRateLimit = error instanceof Error && (error.message.includes("429") || error.message.includes("Resource exhausted"));
      if (isRateLimit && attempt < maxRetries) {
        await sleep$1(Math.pow(2, attempt) * 1e3);
        continue;
      }
      throw error;
    }
  }
  throw new Error("Max retries exceeded");
}
function parseJSON$1(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
  else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
  if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
  return JSON.parse(cleaned.trim());
}
const DmProcessReceiptInputSchema = z.object({
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),
  userCurrency: z.string().default("THB")
});
const DmProcessReceiptOutputSchema = z.object({
  success: z.boolean(),
  isReceipt: z.boolean(),
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  error: z.string().optional()
});
const dmProcessReceiptStep = createStep({
  id: "dm-process-receipt",
  description: "Process receipt image using OCR (DM - no splits)",
  inputSchema: DmProcessReceiptInputSchema,
  outputSchema: DmProcessReceiptOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] dm-process-receipt`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  ImageURL: ${inputData.imageUrl || "(base64 provided)"}`);
    console.log(`${"=".repeat(60)}
`);
    if (!inputData.imageUrl && !inputData.imageBase64) {
      setState({ ...state, messageType: "expense_receipt", isReceipt: false, error: "No image provided" });
      return { success: false, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [], error: "No image provided" };
    }
    try {
      let imageData;
      if (inputData.imageBase64) {
        imageData = { data: inputData.imageBase64.replace(/^data:image\/\w+;base64,/, ""), mimeType: "image/jpeg" };
      } else {
        imageData = await downloadImage$1(inputData.imageUrl);
      }
      console.log("[OCR] Processing receipt...");
      const analysisText = await callGemini$1("gemini-2.0-flash", [
        OCR_PROMPT$1,
        { inlineData: { data: imageData.data, mimeType: imageData.mimeType } }
      ]);
      const ocrResult = parseJSON$1(analysisText);
      if (!ocrResult.isReceipt) {
        setState({ ...state, messageType: "expense_receipt", isReceipt: false });
        return { success: true, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [] };
      }
      const items = (ocrResult.items || []).map((item) => ({
        name: item.name || "Unknown",
        nameLocalized: item.nameLocalized || null,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        ingredientType: null
      }));
      const payment = ocrResult.payment;
      const metadata = ocrResult.metadata;
      const parsedExpense = {
        description: ocrResult.storeName || ocrResult.storeNameLocalized || null,
        amount: ocrResult.total || null,
        currency: ocrResult.currency || "THB",
        category: ocrResult.category || null,
        date: metadata?.transactionDate || null,
        splitType: null,
        splitTargets: [],
        items,
        payment: payment ? {
          method: payment.method || null,
          cardType: payment.cardType || null,
          cardLast4: payment.cardLast4 || null,
          bankName: payment.bankName || null
        } : null,
        metadata: {
          receiptNo: metadata?.receiptNo,
          subtotal: ocrResult.subtotal,
          tax: ocrResult.tax
        }
      };
      const missingFields = [];
      if (!parsedExpense.amount) missingFields.push("amount");
      if (!parsedExpense.description) missingFields.push("description");
      const isValid = missingFields.length === 0;
      console.log(`[OCR] \u2705 ${parsedExpense.description} | ${parsedExpense.amount} ${parsedExpense.currency}`);
      setState({ ...state, messageType: "expense_receipt", isReceipt: true, parsedExpense, isValid, missingFields });
      return { success: true, isReceipt: true, parsedExpense, isValid, missingFields };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[OCR] \u274C Error: ${errorMsg}`);
      setState({ ...state, messageType: "expense_receipt", isReceipt: false, error: errorMsg });
      return { success: false, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [], error: errorMsg };
    }
  }
});

"use strict";
const DmValidateInputSchema = z.object({
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  userLanguage: z.enum(["th", "en"]).default("th"),
  userCurrency: z.string().default("THB")
});
const DmValidateOutputSchema = z.object({
  isValid: z.boolean(),
  parsedExpense: ParsedExpenseSchema
});
const DmValidateSuspendSchema = z.object({
  prompt: z.string(),
  missingFields: z.array(z.string())
});
const dmValidateStep = createStep({
  id: "dm-validate",
  description: "Validate DM expense and suspend for missing info (HITL)",
  inputSchema: DmValidateInputSchema,
  outputSchema: DmValidateOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  resumeSchema: ExpenseResumeSchema,
  suspendSchema: DmValidateSuspendSchema,
  execute: async ({ inputData, resumeData, suspend, setState, state }) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] dm-validate`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  IsValid: ${inputData.isValid}`);
    console.log(`  Missing: ${inputData.missingFields.join(", ") || "none"}`);
    if (resumeData) {
      console.log(`  ResumeData: ${JSON.stringify(resumeData)}`);
    }
    console.log(`${"=".repeat(60)}
`);
    let parsedExpense = inputData.parsedExpense || {
      description: null,
      amount: null,
      currency: inputData.userCurrency,
      category: "Other",
      date: null,
      splitType: null,
      splitTargets: [],
      items: [],
      payment: null,
      metadata: void 0
    };
    if (resumeData) {
      console.log(`[dm-validate] Processing resume data...`);
      if (resumeData.description || resumeData.amount) {
        if (resumeData.description) {
          parsedExpense = { ...parsedExpense, description: resumeData.description };
        }
        if (resumeData.amount) {
          parsedExpense = { ...parsedExpense, amount: resumeData.amount };
        }
      }
      console.log(`[dm-validate] After merge: ${JSON.stringify(parsedExpense)}`);
    }
    const missingFields = [];
    if (!parsedExpense.amount) missingFields.push("amount");
    if (!parsedExpense.description) missingFields.push("description");
    const isValid = missingFields.length === 0;
    if (!isValid) {
      const prompt = generateMissingFieldsPrompt(
        {
          description: parsedExpense.description,
          amount: parsedExpense.amount,
          currency: parsedExpense.currency,
          category: parsedExpense.category || "Other",
          splitType: null,
          splitTargets: [],
          date: null
        },
        missingFields,
        inputData.userLanguage
      );
      console.log(`[dm-validate] Suspending for: ${missingFields.join(", ")}`);
      console.log(`[dm-validate] Prompt: "${prompt}"`);
      setState({
        ...state,
        parsedExpense,
        isValid: false,
        missingFields
      });
      return await suspend({
        prompt,
        missingFields
      });
    }
    console.log(`[dm-validate] \u2705 Validation passed`);
    setState({
      ...state,
      parsedExpense,
      isValid: true,
      missingFields: []
    });
    return {
      isValid: true,
      parsedExpense
    };
  }
});

"use strict";
const CreateExpenseInputSchema = z.object({
  parsedExpense: ParsedExpenseSchema,
  channel: ChannelSchema,
  senderChannelId: z.string(),
  sourceChannelId: z.string(),
  isGroup: z.boolean(),
  imageUrl: z.string().optional()
  // For receipt data
});
const CreateExpenseOutputSchema = z.object({
  success: z.boolean(),
  expenseId: z.string().optional(),
  splits: z.array(z.object({
    userId: z.string(),
    name: z.string().nullable(),
    amount: z.number()
  })).optional(),
  error: z.string().optional()
});
const createExpenseStep = createStep({
  id: "create-expense",
  description: "Create expense record via API",
  inputSchema: CreateExpenseInputSchema,
  outputSchema: CreateExpenseOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    const { parsedExpense, channel, senderChannelId, sourceChannelId, isGroup } = inputData;
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] create-expense`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Description: ${parsedExpense.description}`);
    console.log(`  Amount:      ${parsedExpense.amount} ${parsedExpense.currency}`);
    console.log(`  IsGroup:     ${isGroup}`);
    if (parsedExpense.splitTargets.length > 0) {
      console.log(`  Splits:      ${parsedExpense.splitTargets.join(", ")}`);
    }
    console.log(`${"=".repeat(60)}
`);
    const context = {
      channel,
      senderChannelId,
      sourceChannelId,
      sourceType: isGroup ? "GROUP" : "DM"
    };
    try {
      const requestBody = {
        channel,
        senderChannelId,
        sourceChannelId,
        sourceType: isGroup ? "GROUP" : "DM",
        description: parsedExpense.description,
        amount: parsedExpense.amount,
        currency: parsedExpense.currency,
        date: parsedExpense.date
      };
      if (isGroup && parsedExpense.splitType && parsedExpense.splitTargets.length > 0) {
        requestBody.splitType = parsedExpense.splitType;
        requestBody.splits = parsedExpense.splitTargets.map((target) => ({ target }));
      }
      if (parsedExpense.items && parsedExpense.items.length > 0) {
        requestBody.items = parsedExpense.items.map((item) => ({
          name: item.name,
          nameLocalized: item.nameLocalized,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          ingredientType: item.ingredientType
        }));
      }
      if (inputData.imageUrl && parsedExpense.metadata) {
        requestBody.receiptData = {
          imageUrl: inputData.imageUrl,
          storeName: parsedExpense.description,
          subtotal: parsedExpense.metadata.subtotal,
          tax: parsedExpense.metadata.tax,
          total: parsedExpense.amount
        };
      }
      if (parsedExpense.metadata) {
        requestBody.metadata = parsedExpense.metadata;
      }
      const response = await apiRequest("POST", "/expenses", context, requestBody);
      if (!response.expense?.id) {
        console.error(`[create-expense] \u274C No expenseId in response`);
        setState({
          ...state,
          expenseId: null,
          error: "Expense was not saved"
        });
        return {
          success: false,
          error: "Expense was not saved. Please try again."
        };
      }
      console.log(`[create-expense] \u2705 SUCCESS: EX:${response.expense.id}`);
      setState({
        ...state,
        expenseId: response.expense.id
      });
      return {
        success: true,
        expenseId: response.expense.id,
        splits: response.splits
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[create-expense] \u274C Error: ${errorMsg}`);
      setState({
        ...state,
        expenseId: null,
        error: errorMsg
      });
      return {
        success: false,
        error: errorMsg
      };
    }
  }
});

"use strict";
const FormatResponseInputSchema = z.object({
  success: z.boolean(),
  expenseId: z.string().optional(),
  parsedExpense: ParsedExpenseSchema,
  splits: z.array(z.object({
    userId: z.string(),
    name: z.string().nullable(),
    amount: z.number()
  })).optional(),
  error: z.string().optional(),
  userLanguage: z.enum(["th", "en"]).default("th")
});
const formatResponseStep = createStep({
  id: "format-response",
  description: "Format the final response message",
  inputSchema: FormatResponseInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] format-response`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Success: ${inputData.success}`);
    console.log(`  ExpenseId: ${inputData.expenseId || "none"}`);
    console.log(`${"=".repeat(60)}
`);
    const { parsedExpense, splits, userLanguage } = inputData;
    if (!inputData.success || !inputData.expenseId) {
      const errorMessage = userLanguage === "th" ? `\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14: ${inputData.error || "\u0E44\u0E21\u0E48\u0E2A\u0E32\u0E21\u0E32\u0E23\u0E16\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E44\u0E14\u0E49"}` : `Error: ${inputData.error || "Could not save expense"}`;
      setState({
        ...state,
        responseMessage: errorMessage
      });
      return {
        success: false,
        status: "failed",
        message: errorMessage
      };
    }
    const formattedAmount = formatAmount(parsedExpense.amount, parsedExpense.currency);
    let message = `${parsedExpense.description} | ${formattedAmount}`;
    if (parsedExpense.category) {
      message += `
Category: ${parsedExpense.category}`;
    }
    if (parsedExpense.date) {
      const dateObj = new Date(parsedExpense.date);
      const today = /* @__PURE__ */ new Date();
      const isToday = dateObj.toDateString() === today.toDateString();
      if (!isToday) {
        const formattedDate = dateObj.toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric"
        });
        message += `
Date: ${formattedDate}`;
      }
    }
    if (parsedExpense.items && parsedExpense.items.length > 0) {
      message += `
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;
      for (const item of parsedExpense.items) {
        const qty = item.quantity || 1;
        const unitPrice = item.unitPrice || 0;
        const lineTotal = qty * unitPrice;
        message += `
- ${item.name} x${qty} @ ${formatAmount(unitPrice, parsedExpense.currency)} = ${formatAmount(lineTotal, parsedExpense.currency)}`;
      }
      message += `
\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`;
    }
    if (parsedExpense.payment?.method) {
      let paymentStr = `Paid: ${parsedExpense.payment.method}`;
      if (parsedExpense.payment.cardType && parsedExpense.payment.cardLast4) {
        paymentStr += ` (${parsedExpense.payment.cardType} **${parsedExpense.payment.cardLast4})`;
      } else if (parsedExpense.payment.cardLast4) {
        paymentStr += ` (**${parsedExpense.payment.cardLast4})`;
      }
      if (parsedExpense.payment.bankName) {
        paymentStr += ` - ${parsedExpense.payment.bankName}`;
      }
      message += `
${paymentStr}`;
    }
    message += `
EX:${inputData.expenseId}`;
    if (splits && splits.length > 0) {
      message += "\n" + splits.map(
        (s) => `   \u2192 @${s.name || "Unknown"} owes ${formatAmount(s.amount, parsedExpense.currency)}`
      ).join("\n");
    }
    console.log(`[format-response] \u2705 Message formatted`);
    setState({
      ...state,
      responseMessage: message
    });
    return {
      success: true,
      status: "completed",
      message,
      expenseId: inputData.expenseId
    };
  }
});

"use strict";
const DmWorkflowInputSchema = z.object({
  sourceInitialized: z.boolean(),
  isNewSource: z.boolean(),
  isNewUser: z.boolean()
});
const dmTextExpenseWorkflow = createWorkflow({
  id: "dm-text-expense",
  inputSchema: DmWorkflowInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema
}).map(async ({ getInitData }) => {
  const initData = getInitData();
  return {
    messageText: initData.messageText || "",
    userCurrency: initData.userCurrency,
    userLanguage: initData.userLanguage
  };
}).then(dmParseTextStep).map(async ({ inputData, getInitData }) => {
  const initData = getInitData();
  return {
    parsedExpense: inputData.parsedExpense,
    isValid: inputData.isValid,
    missingFields: inputData.missingFields,
    userLanguage: initData.userLanguage,
    userCurrency: initData.userCurrency
  };
}).then(dmValidateStep).map(async ({ inputData, getInitData }) => {
  const initData = getInitData();
  return {
    parsedExpense: inputData.parsedExpense,
    channel: initData.channel,
    senderChannelId: initData.senderChannelId,
    sourceChannelId: initData.sourceChannelId,
    isGroup: false
  };
}).then(createExpenseStep).map(async ({ inputData, getStepResult, getInitData }) => {
  const initData = getInitData();
  const validateResult = getStepResult("dm-validate");
  return {
    success: inputData.success,
    expenseId: inputData.expenseId,
    parsedExpense: validateResult.parsedExpense,
    splits: inputData.splits,
    error: inputData.error,
    userLanguage: initData.userLanguage
  };
}).then(formatResponseStep).commit();
const dmReceiptExpenseWorkflow = createWorkflow({
  id: "dm-receipt-expense",
  inputSchema: DmWorkflowInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema
}).map(async ({ getInitData }) => {
  const initData = getInitData();
  return {
    imageUrl: initData.imageUrl,
    imageBase64: initData.imageBase64,
    userCurrency: initData.userCurrency
  };
}).then(dmProcessReceiptStep).branch([
  // Not a receipt - return error
  [
    async ({ inputData }) => !inputData.isReceipt,
    createStep({
      id: "not-a-receipt",
      inputSchema: z.any(),
      outputSchema: MessageOutputSchema,
      execute: async ({ inputData, getInitData }) => {
        const initData = getInitData();
        const lang = initData.userLanguage;
        return {
          success: false,
          status: "failed",
          message: lang === "th" ? "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E43\u0E19\u0E23\u0E39\u0E1B \u0E01\u0E23\u0E38\u0E13\u0E32\u0E2A\u0E48\u0E07\u0E23\u0E39\u0E1B\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E17\u0E35\u0E48\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19" : "This does not appear to be a receipt. Please send a clear photo of a receipt."
        };
      }
    })
  ],
  // Is a receipt - continue with validation
  [
    async ({ inputData }) => inputData.isReceipt,
    createWorkflow({
      id: "dm-receipt-valid-path",
      inputSchema: z.any(),
      outputSchema: MessageOutputSchema,
      stateSchema: MessageWorkflowStateSchema
    }).map(async ({ inputData, getInitData }) => {
      const initData = getInitData();
      return {
        parsedExpense: inputData.parsedExpense,
        isValid: inputData.isValid,
        missingFields: inputData.missingFields,
        userLanguage: initData.userLanguage,
        userCurrency: initData.userCurrency
      };
    }).then(dmValidateStep).map(async ({ inputData, getInitData }) => {
      const initData = getInitData();
      return {
        parsedExpense: inputData.parsedExpense,
        channel: initData.channel,
        senderChannelId: initData.senderChannelId,
        sourceChannelId: initData.sourceChannelId,
        isGroup: false,
        imageUrl: initData.imageUrl
      };
    }).then(createExpenseStep).map(async ({ inputData, getStepResult, getInitData }) => {
      const initData = getInitData();
      const validateResult = getStepResult("dm-validate");
      return {
        success: inputData.success,
        expenseId: inputData.expenseId,
        parsedExpense: validateResult.parsedExpense,
        splits: inputData.splits,
        error: inputData.error,
        userLanguage: initData.userLanguage
      };
    }).then(formatResponseStep).commit()
  ]
]).commit();
const dmWorkflow = createWorkflow({
  id: "dm-workflow",
  inputSchema: DmWorkflowInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema
}).branch([
  // Text expense path
  [
    async ({ getInitData }) => {
      const initData = getInitData();
      return !initData.imageUrl && !initData.imageBase64 && !!initData.messageText;
    },
    dmTextExpenseWorkflow
  ],
  // Receipt expense path
  [
    async ({ getInitData }) => {
      const initData = getInitData();
      return !!(initData.imageUrl || initData.imageBase64);
    },
    dmReceiptExpenseWorkflow
  ],
  // No content - fallback
  [
    async () => true,
    // Default case
    createStep({
      id: "dm-no-content",
      inputSchema: z.any(),
      outputSchema: MessageOutputSchema,
      execute: async ({ getInitData }) => {
        const initData = getInitData();
        const lang = initData.userLanguage;
        return {
          success: false,
          status: "fallback",
          message: lang === "th" ? '\u0E44\u0E21\u0E48\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21 \u0E25\u0E2D\u0E07\u0E1E\u0E34\u0E21\u0E1E\u0E4C "\u0E01\u0E32\u0E41\u0E1F 65" \u0E2B\u0E23\u0E37\u0E2D\u0E2A\u0E48\u0E07\u0E23\u0E39\u0E1B\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08' : `I don't understand. Try "coffee 65" or send a receipt photo.`,
          fallbackReason: "no_content"
        };
      }
    })
  ]
]).commit();

"use strict";
const SyncMembersInputSchema = z.object({
  channel: ChannelSchema,
  sourceChannelId: z.string(),
  senderChannelId: z.string()
});
const SyncMembersOutputSchema = z.object({
  success: z.boolean(),
  members: z.array(z.object({
    id: z.string(),
    name: z.string().nullable(),
    nickname: z.string().nullable(),
    channelId: z.string()
  })),
  error: z.string().optional()
});
const syncMembersStep = createStep({
  id: "sync-members",
  description: "Fetch group members for @all resolution",
  inputSchema: SyncMembersInputSchema,
  outputSchema: SyncMembersOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] sync-members`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Channel:  ${inputData.channel}`);
    console.log(`  Source:   ${inputData.sourceChannelId}`);
    console.log(`${"=".repeat(60)}
`);
    const context = {
      channel: inputData.channel,
      senderChannelId: inputData.senderChannelId,
      sourceChannelId: inputData.sourceChannelId,
      sourceType: "GROUP"
    };
    try {
      const response = await apiRequest("GET", `/sources/${inputData.sourceChannelId}/members`, context);
      const members = response.members || [];
      console.log(`[sync-members] \u2705 Fetched ${members.length} members`);
      setState({
        ...state,
        groupMembers: members.map((m) => ({
          id: m.id,
          name: m.name,
          nickname: m.nickname
        }))
      });
      return {
        success: true,
        members
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[sync-members] \u274C Error: ${errorMsg}`);
      return {
        success: false,
        members: [],
        error: errorMsg
      };
    }
  }
});

"use strict";
const GroupParseTextInputSchema = z.object({
  messageText: z.string(),
  userCurrency: z.string().default("THB"),
  userLanguage: z.enum(["th", "en"]).default("th"),
  members: z.array(z.object({
    id: z.string(),
    name: z.string().nullable(),
    nickname: z.string().nullable(),
    channelId: z.string()
  })).default([])
});
const GroupParseTextOutputSchema = z.object({
  success: z.boolean(),
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  needsSplitInfo: z.boolean()
  // True if no @mentions found but might need split
});
const groupParseTextStep = createStep({
  id: "group-parse-text",
  description: "Parse text message into expense data (Group - with splits)",
  inputSchema: GroupParseTextInputSchema,
  outputSchema: GroupParseTextOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] group-parse-text`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  Text: "${inputData.messageText}"`);
    console.log(`  Members: ${inputData.members.length}`);
    console.log(`${"=".repeat(60)}
`);
    const parsed = parseExpenseText(inputData.messageText);
    if (parsed.currency === "THB" && inputData.userCurrency !== "THB") {
      const hasExplicitCurrency = /[฿$€¥]|\b(THB|USD|EUR|JPY|AUD)\b/i.test(inputData.messageText);
      if (!hasExplicitCurrency) {
        parsed.currency = inputData.userCurrency;
      }
    }
    const validatedTargets = [];
    const invalidTargets = [];
    for (const target of parsed.splitTargets) {
      if (target.toLowerCase() === "all") {
        validatedTargets.push("all");
      } else {
        const memberMatch = inputData.members.find(
          (m) => m.name?.toLowerCase() === target.toLowerCase() || m.nickname?.toLowerCase() === target.toLowerCase()
        );
        if (memberMatch) {
          validatedTargets.push(target);
        } else {
          invalidTargets.push(target);
        }
      }
    }
    if (invalidTargets.length > 0) {
      console.log(`[group-parse-text] Invalid targets: ${invalidTargets.join(", ")}`);
    }
    const needsSplitInfo = false;
    parsed.splitTargets = validatedTargets;
    if (validatedTargets.length === 0) {
      parsed.splitType = null;
    }
    const { isValid, missingFields } = validateParsedExpense(parsed);
    console.log(`[group-parse-text] Parsed: ${JSON.stringify(parsed)}`);
    console.log(`[group-parse-text] Valid: ${isValid}, Missing: ${missingFields.join(", ") || "none"}`);
    console.log(`[group-parse-text] Split targets: ${validatedTargets.join(", ") || "none (personal)"}`);
    const parsedExpense = {
      description: parsed.description,
      amount: parsed.amount,
      currency: parsed.currency,
      category: parsed.category,
      date: parsed.date,
      splitType: parsed.splitType,
      splitTargets: parsed.splitTargets,
      items: [],
      payment: null,
      metadata: void 0
    };
    setState({
      ...state,
      messageType: "expense_text",
      parsedExpense,
      isValid,
      missingFields
    });
    return {
      success: true,
      parsedExpense,
      isValid,
      missingFields,
      needsSplitInfo
    };
  }
});

"use strict";
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const categoryList = Object.keys(CATEGORIES).join("|");
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function downloadImage(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Accept": "image/*,*/*;q=0.8" }
  });
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const buffer = await response.arrayBuffer();
  return {
    data: Buffer.from(buffer).toString("base64"),
    mimeType: response.headers.get("content-type") || "image/jpeg"
  };
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
        await sleep(Math.pow(2, attempt) * 1e3);
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
const GroupProcessReceiptInputSchema = z.object({
  imageUrl: z.string().optional(),
  imageBase64: z.string().optional(),
  userCurrency: z.string().default("THB"),
  splitType: z.enum(["equal", "exact", "percentage", "item"]).nullable().default(null),
  splitTargets: z.array(z.string()).default([])
});
const GroupProcessReceiptOutputSchema = z.object({
  success: z.boolean(),
  isReceipt: z.boolean(),
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  needsSplitInfo: z.boolean(),
  error: z.string().optional()
});
const groupProcessReceiptStep = createStep({
  id: "group-process-receipt",
  description: "Process receipt image using OCR (Group - with split support)",
  inputSchema: GroupProcessReceiptInputSchema,
  outputSchema: GroupProcessReceiptOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] group-process-receipt`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  ImageURL: ${inputData.imageUrl || "(base64 provided)"}`);
    if (inputData.splitTargets.length > 0) {
      console.log(`  Splits: ${inputData.splitTargets.join(", ")}`);
    }
    console.log(`${"=".repeat(60)}
`);
    if (!inputData.imageUrl && !inputData.imageBase64) {
      setState({ ...state, messageType: "expense_receipt", isReceipt: false, error: "No image provided" });
      return { success: false, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [], needsSplitInfo: false, error: "No image provided" };
    }
    try {
      let imageData;
      if (inputData.imageBase64) {
        imageData = { data: inputData.imageBase64.replace(/^data:image\/\w+;base64,/, ""), mimeType: "image/jpeg" };
      } else {
        imageData = await downloadImage(inputData.imageUrl);
      }
      console.log("[OCR] Processing receipt...");
      const analysisText = await callGemini("gemini-2.0-flash", [
        OCR_PROMPT,
        { inlineData: { data: imageData.data, mimeType: imageData.mimeType } }
      ]);
      const ocrResult = parseJSON(analysisText);
      if (!ocrResult.isReceipt) {
        setState({ ...state, messageType: "expense_receipt", isReceipt: false });
        return { success: true, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [], needsSplitInfo: false };
      }
      const items = (ocrResult.items || []).map((item) => ({
        name: item.name || "Unknown",
        nameLocalized: item.nameLocalized || null,
        quantity: item.quantity || 1,
        unitPrice: item.unitPrice || 0,
        ingredientType: null
      }));
      const payment = ocrResult.payment;
      const metadata = ocrResult.metadata;
      const parsedExpense = {
        description: ocrResult.storeName || ocrResult.storeNameLocalized || null,
        amount: ocrResult.total || null,
        currency: ocrResult.currency || "THB",
        category: ocrResult.category || null,
        date: metadata?.transactionDate || null,
        splitType: inputData.splitType,
        splitTargets: inputData.splitTargets,
        items,
        payment: payment ? {
          method: payment.method || null,
          cardType: payment.cardType || null,
          cardLast4: payment.cardLast4 || null,
          bankName: payment.bankName || null
        } : null,
        metadata: {
          receiptNo: metadata?.receiptNo,
          subtotal: ocrResult.subtotal,
          tax: ocrResult.tax
        }
      };
      const missingFields = [];
      if (!parsedExpense.amount) missingFields.push("amount");
      if (!parsedExpense.description) missingFields.push("description");
      const isValid = missingFields.length === 0;
      const needsSplitInfo = false;
      console.log(`[OCR] \u2705 ${parsedExpense.description} | ${parsedExpense.amount} ${parsedExpense.currency}`);
      console.log(`[OCR] Split targets: ${parsedExpense.splitTargets.join(", ") || "none"}`);
      setState({ ...state, messageType: "expense_receipt", isReceipt: true, parsedExpense, isValid, missingFields });
      return { success: true, isReceipt: true, parsedExpense, isValid, missingFields, needsSplitInfo };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`[OCR] \u274C Error: ${errorMsg}`);
      setState({ ...state, messageType: "expense_receipt", isReceipt: false, error: errorMsg });
      return { success: false, isReceipt: false, parsedExpense: null, isValid: false, missingFields: [], needsSplitInfo: false, error: errorMsg };
    }
  }
});

"use strict";
const GroupValidateInputSchema = z.object({
  parsedExpense: ParsedExpenseSchema.nullable(),
  isValid: z.boolean(),
  missingFields: z.array(z.string()),
  needsSplitInfo: z.boolean().default(false),
  userLanguage: z.enum(["th", "en"]).default("th"),
  userCurrency: z.string().default("THB")
});
const GroupValidateOutputSchema = z.object({
  isValid: z.boolean(),
  parsedExpense: ParsedExpenseSchema
});
const GroupValidateSuspendSchema = z.object({
  prompt: z.string(),
  missingFields: z.array(z.string())
});
function generateGroupMissingPrompt(parsedExpense, missingFields, needsSplitInfo, language) {
  const prompts = [];
  if (language === "th") {
    if (missingFields.includes("amount") && missingFields.includes("description")) {
      prompts.push('\u0E1A\u0E2D\u0E01\u0E27\u0E48\u0E32\u0E0B\u0E37\u0E49\u0E2D\u0E2D\u0E30\u0E44\u0E23 \u0E23\u0E32\u0E04\u0E32\u0E40\u0E17\u0E48\u0E32\u0E44\u0E2B\u0E23\u0E48? \u0E40\u0E0A\u0E48\u0E19 "\u0E01\u0E32\u0E41\u0E1F 65"');
    } else if (missingFields.includes("amount")) {
      prompts.push(`"${parsedExpense.description}" \u0E23\u0E32\u0E04\u0E32\u0E40\u0E17\u0E48\u0E32\u0E44\u0E2B\u0E23\u0E48?`);
    } else if (missingFields.includes("description")) {
      prompts.push(`${parsedExpense.amount} ${parsedExpense.currency} - \u0E08\u0E48\u0E32\u0E22\u0E04\u0E48\u0E32\u0E2D\u0E30\u0E44\u0E23?`);
    }
    if (needsSplitInfo) {
      prompts.push("\u0E2B\u0E32\u0E23\u0E01\u0E31\u0E1A\u0E43\u0E04\u0E23? \u0E43\u0E0A\u0E49 @all \u0E2B\u0E23\u0E37\u0E2D @\u0E0A\u0E37\u0E48\u0E2D");
    }
  } else {
    if (missingFields.includes("amount") && missingFields.includes("description")) {
      prompts.push('What did you buy and how much? Example: "coffee 65"');
    } else if (missingFields.includes("amount")) {
      prompts.push(`How much was "${parsedExpense.description}"?`);
    } else if (missingFields.includes("description")) {
      prompts.push(`What did you spend ${parsedExpense.amount} ${parsedExpense.currency} on?`);
    }
    if (needsSplitInfo) {
      prompts.push("Split with whom? Use @all or @name");
    }
  }
  return prompts.join("\n");
}
const groupValidateStep = createStep({
  id: "group-validate",
  description: "Validate group expense and suspend for missing info (HITL)",
  inputSchema: GroupValidateInputSchema,
  outputSchema: GroupValidateOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  resumeSchema: ExpenseResumeSchema,
  suspendSchema: GroupValidateSuspendSchema,
  execute: async ({ inputData, resumeData, suspend, setState, state }) => {
    console.log(`
${"=".repeat(60)}`);
    console.log(`[STEP] group-validate`);
    console.log(`${"=".repeat(60)}`);
    console.log(`  IsValid: ${inputData.isValid}`);
    console.log(`  Missing: ${inputData.missingFields.join(", ") || "none"}`);
    console.log(`  NeedsSplitInfo: ${inputData.needsSplitInfo}`);
    if (resumeData) {
      console.log(`  ResumeData: ${JSON.stringify(resumeData)}`);
    }
    console.log(`${"=".repeat(60)}
`);
    let parsedExpense = inputData.parsedExpense || {
      description: null,
      amount: null,
      currency: inputData.userCurrency,
      category: "Other",
      date: null,
      splitType: null,
      splitTargets: [],
      items: [],
      payment: null,
      metadata: void 0
    };
    if (resumeData) {
      console.log(`[group-validate] Processing resume data...`);
      if (resumeData.description) {
        parsedExpense = { ...parsedExpense, description: resumeData.description };
      }
      if (resumeData.amount) {
        parsedExpense = { ...parsedExpense, amount: resumeData.amount };
      }
      if (resumeData.splitTargets && resumeData.splitTargets.length > 0) {
        parsedExpense = {
          ...parsedExpense,
          splitType: "equal",
          splitTargets: resumeData.splitTargets
        };
      }
      console.log(`[group-validate] After merge: ${JSON.stringify(parsedExpense)}`);
    }
    const missingFields = [];
    if (!parsedExpense.amount) missingFields.push("amount");
    if (!parsedExpense.description) missingFields.push("description");
    const isValid = missingFields.length === 0;
    const needsSplitInfo = inputData.needsSplitInfo && parsedExpense.splitTargets.length === 0;
    if (!isValid || needsSplitInfo) {
      const prompt = generateGroupMissingPrompt(
        {
          description: parsedExpense.description,
          amount: parsedExpense.amount,
          currency: parsedExpense.currency
        },
        missingFields,
        needsSplitInfo,
        inputData.userLanguage
      );
      console.log(`[group-validate] Suspending for: ${missingFields.join(", ")}${needsSplitInfo ? ", splitInfo" : ""}`);
      console.log(`[group-validate] Prompt: "${prompt}"`);
      setState({
        ...state,
        parsedExpense,
        isValid: false,
        missingFields
      });
      return await suspend({
        prompt,
        missingFields: needsSplitInfo ? [...missingFields, "splitInfo"] : missingFields
      });
    }
    console.log(`[group-validate] \u2705 Validation passed`);
    setState({
      ...state,
      parsedExpense,
      isValid: true,
      missingFields: []
    });
    return {
      isValid: true,
      parsedExpense
    };
  }
});

"use strict";
const GroupWorkflowInputSchema = z.object({
  sourceInitialized: z.boolean(),
  isNewSource: z.boolean(),
  isNewUser: z.boolean()
});
const groupTextExpenseWorkflow = createWorkflow({
  id: "group-text-expense",
  inputSchema: z.any(),
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema
}).map(async ({ inputData, getInitData }) => {
  const initData = getInitData();
  return {
    messageText: initData.messageText || "",
    userCurrency: initData.userCurrency,
    userLanguage: initData.userLanguage,
    members: inputData.members || []
  };
}).then(groupParseTextStep).map(async ({ inputData, getInitData }) => {
  const initData = getInitData();
  return {
    parsedExpense: inputData.parsedExpense,
    isValid: inputData.isValid,
    missingFields: inputData.missingFields,
    needsSplitInfo: inputData.needsSplitInfo,
    userLanguage: initData.userLanguage,
    userCurrency: initData.userCurrency
  };
}).then(groupValidateStep).map(async ({ inputData, getInitData }) => {
  const initData = getInitData();
  return {
    parsedExpense: inputData.parsedExpense,
    channel: initData.channel,
    senderChannelId: initData.senderChannelId,
    sourceChannelId: initData.sourceChannelId,
    isGroup: true
  };
}).then(createExpenseStep).map(async ({ inputData, getStepResult, getInitData }) => {
  const initData = getInitData();
  const validateResult = getStepResult("group-validate");
  return {
    success: inputData.success,
    expenseId: inputData.expenseId,
    parsedExpense: validateResult.parsedExpense,
    splits: inputData.splits,
    error: inputData.error,
    userLanguage: initData.userLanguage
  };
}).then(formatResponseStep).commit();
const groupReceiptExpenseWorkflow = createWorkflow({
  id: "group-receipt-expense",
  inputSchema: z.any(),
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema
}).map(async ({ getInitData }) => {
  const initData = getInitData();
  const splitTargets = [];
  const text = initData.messageText || "";
  const splitMatches = text.match(/@(\w+)/g);
  if (splitMatches) {
    for (const m of splitMatches) {
      splitTargets.push(m.slice(1));
    }
  }
  if (/หารกัน|แบ่งกัน|ทุกคน/i.test(text) && !splitTargets.includes("all")) {
    splitTargets.push("all");
  }
  return {
    imageUrl: initData.imageUrl,
    imageBase64: initData.imageBase64,
    userCurrency: initData.userCurrency,
    splitType: splitTargets.length > 0 ? "equal" : null,
    splitTargets
  };
}).then(groupProcessReceiptStep).branch([
  // Not a receipt - return error
  [
    async ({ inputData }) => !inputData.isReceipt,
    createStep({
      id: "group-not-a-receipt",
      inputSchema: z.any(),
      outputSchema: MessageOutputSchema,
      execute: async ({ getInitData }) => {
        const initData = getInitData();
        const lang = initData.userLanguage;
        return {
          success: false,
          status: "failed",
          message: lang === "th" ? "\u0E44\u0E21\u0E48\u0E1E\u0E1A\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E43\u0E19\u0E23\u0E39\u0E1B \u0E01\u0E23\u0E38\u0E13\u0E32\u0E2A\u0E48\u0E07\u0E23\u0E39\u0E1B\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08\u0E17\u0E35\u0E48\u0E0A\u0E31\u0E14\u0E40\u0E08\u0E19" : "This does not appear to be a receipt. Please send a clear photo of a receipt."
        };
      }
    })
  ],
  // Is a receipt - continue with validation
  [
    async ({ inputData }) => inputData.isReceipt,
    createWorkflow({
      id: "group-receipt-valid-path",
      inputSchema: z.any(),
      outputSchema: MessageOutputSchema,
      stateSchema: MessageWorkflowStateSchema
    }).map(async ({ inputData, getInitData }) => {
      const initData = getInitData();
      return {
        parsedExpense: inputData.parsedExpense,
        isValid: inputData.isValid,
        missingFields: inputData.missingFields,
        needsSplitInfo: inputData.needsSplitInfo,
        userLanguage: initData.userLanguage,
        userCurrency: initData.userCurrency
      };
    }).then(groupValidateStep).map(async ({ inputData, getInitData }) => {
      const initData = getInitData();
      return {
        parsedExpense: inputData.parsedExpense,
        channel: initData.channel,
        senderChannelId: initData.senderChannelId,
        sourceChannelId: initData.sourceChannelId,
        isGroup: true,
        imageUrl: initData.imageUrl
      };
    }).then(createExpenseStep).map(async ({ inputData, getStepResult, getInitData }) => {
      const initData = getInitData();
      const validateResult = getStepResult("group-validate");
      return {
        success: inputData.success,
        expenseId: inputData.expenseId,
        parsedExpense: validateResult.parsedExpense,
        splits: inputData.splits,
        error: inputData.error,
        userLanguage: initData.userLanguage
      };
    }).then(formatResponseStep).commit()
  ]
]).commit();
const groupWorkflow = createWorkflow({
  id: "group-workflow",
  inputSchema: GroupWorkflowInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema
}).map(async ({ getInitData }) => {
  const initData = getInitData();
  return {
    channel: initData.channel,
    sourceChannelId: initData.sourceChannelId,
    senderChannelId: initData.senderChannelId
  };
}).then(syncMembersStep).branch([
  // Text expense path
  [
    async ({ getInitData }) => {
      const initData = getInitData();
      return !initData.imageUrl && !initData.imageBase64 && !!initData.messageText;
    },
    groupTextExpenseWorkflow
  ],
  // Receipt expense path
  [
    async ({ getInitData }) => {
      const initData = getInitData();
      return !!(initData.imageUrl || initData.imageBase64);
    },
    groupReceiptExpenseWorkflow
  ],
  // No content - fallback
  [
    async () => true,
    createStep({
      id: "group-no-content",
      inputSchema: z.any(),
      outputSchema: MessageOutputSchema,
      execute: async ({ getInitData }) => {
        const initData = getInitData();
        const lang = initData.userLanguage;
        return {
          success: false,
          status: "fallback",
          message: lang === "th" ? '\u0E44\u0E21\u0E48\u0E40\u0E02\u0E49\u0E32\u0E43\u0E08\u0E02\u0E49\u0E2D\u0E04\u0E27\u0E32\u0E21 \u0E25\u0E2D\u0E07\u0E1E\u0E34\u0E21\u0E1E\u0E4C "\u0E01\u0E32\u0E41\u0E1F 65 @all" \u0E2B\u0E23\u0E37\u0E2D\u0E2A\u0E48\u0E07\u0E23\u0E39\u0E1B\u0E43\u0E1A\u0E40\u0E2A\u0E23\u0E47\u0E08' : `I don't understand. Try "coffee 65 @all" or send a receipt photo.`,
          fallbackReason: "no_content"
        };
      }
    })
  ]
]).commit();

"use strict";
const messageWorkflow = createWorkflow({
  id: "message-workflow",
  inputSchema: MessageInputSchema,
  outputSchema: MessageOutputSchema,
  stateSchema: MessageWorkflowStateSchema
}).then(ensureSourceInitStep).branch([
  // DM path
  [
    async ({ getInitData }) => {
      const initData = getInitData();
      return !initData.isGroup;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    dmWorkflow
  ],
  // Group path
  [
    async ({ getInitData }) => {
      const initData = getInitData();
      return initData.isGroup;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    groupWorkflow
  ]
]).commit();
function shouldUseWorkflow(message) {
  if (message.imageUrl || message.imageBase64) {
    return true;
  }
  const text = message.text?.toLowerCase() || "";
  const agentPatterns = [
    // Balance queries
    /ใครเป็นหนี้|who\s+owes|balance|ยอด|เท่าไหร่/i,
    // Summary queries
    /summary|สรุป|รายงาน|report/i,
    // Settlement
    /จ่ายแล้ว|paid|settle|โอน|transfer/i,
    // Help
    /^help$|^ช่วย|วิธีใช้|how\s+to/i,
    // Status
    /status|สถานะ/i,
    // List/history
    /list|รายการ|history|ประวัติ/i,
    // Delete/cancel
    /delete|ลบ|cancel|ยกเลิก/i,
    // Reconcile/adjust
    /adjust|แก้|reconcile|ปรับ/i
  ];
  for (const pattern of agentPatterns) {
    if (pattern.test(text)) {
      return false;
    }
  }
  return true;
}

"use strict";

"use strict";
function getMastraDbUrl() {
  if (process.env.MASTRA_DATABASE_URL) {
    return process.env.MASTRA_DATABASE_URL;
  }
  if (process.env.NODE_ENV === "production") {
    return "file:/app/data/mastra.db";
  }
  return `file:${path.join(process.cwd(), "data", "mastra.db")}`;
}
const UPLOADS_DIR = process.env.UPLOADS_DIR || "./uploads";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const gatewayConfig = {
  billogApiUrl: process.env.BILLOG_API_URL || "http://localhost:8000",
  // LINE configuration (optional)
  ...process.env.LINE_CHANNEL_ACCESS_TOKEN && {
    line: {
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: process.env.LINE_CHANNEL_SECRET || "",
      uploadsDir: UPLOADS_DIR,
      baseUrl: BASE_URL
    }
  },
  // WhatsApp configuration (optional)
  ...process.env.WHATSAPP_ENABLED === "true" && {
    whatsapp: {
      sessionPath: process.env.WHATSAPP_SESSION_PATH || "./data/whatsapp"
    }
  },
  // Group activation settings
  groupActivation: {
    mode: process.env.GROUP_ACTIVATION_MODE || "mention",
    mentionPatterns: process.env.GROUP_MENTION_PATTERNS?.split(",") || ["@billog", "billog"]
  }
};
const gateway = createGateway(gatewayConfig);
let gatewayInitialized = false;
async function ensureGatewayInitialized(mastra2) {
  if (!gatewayInitialized) {
    await gateway.initialize(mastra2);
    gatewayInitialized = true;
  }
}
const mastraDbUrl = getMastraDbUrl();
console.log(`[Mastra] Database URL: ${mastraDbUrl}`);
const storage = new LibSQLStore({
  id: "billog-mastra",
  url: mastraDbUrl
});
const mastra = new Mastra({
  agents: {
    billog: billogAgent,
    insights: insightsAgent
  },
  workflows: {
    messageWorkflow
  },
  storage
});

export { BASE_URL, CATEGORIES, GatewayRouter, OcrResultSchema, ParseResultSchema, ResponseBuilder, TEMPLATES, UPLOADS_DIR, billogAgent, checkDuplicatePurchaseTool, createExpenseTool, createGateway, deleteExpenseTool, detectCategory, detectItemTypeTool, dmWorkflow, ensureGatewayInitialized, extractRawTextTool, extractReceiptTool, formatAmount, gateway, gatewayConfig, generateMissingFieldsPrompt, getBalancesTool, getCategoryByNameTool, getExpenseByIdTool, getExpensesTool, getMyBalanceTool, getPerishableWindowTool, getSpendingSummaryTool, getUserPreferencesTool, groupWorkflow, initSourceTool, insightsAgent, listCategoriesTool, mastra, messageWorkflow, ocrReceiptTool, parseExpenseText, parseTextTool, processReceiptTool, processTextExpenseTool, reconcileExpenseTool, recordSettlementTool, responses, searchSimilarPurchasesTool, setNicknameTool, setUserLanguageTool, shouldUseWorkflow, syncMembersTool, validateParsedExpense };
