import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { Index } from '@upstash/vector';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

const genAI$2 = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
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
const categoryList$2 = Object.keys(CATEGORIES).join("|");
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
      const image = await downloadImage$2(input.imageUrl);
      console.log("[OCR] Step 1: Extracting text...");
      const rawText = await callGemini$2("gemini-2.0-flash", [
        EXTRACT_TEXT_PROMPT$1,
        { inlineData: { data: image.data, mimeType: image.mimeType } }
      ]);
      console.log(`[OCR] Extracted ${rawText.length} chars`);
      console.log("[OCR] Step 2: Analyzing text...");
      const analyzePrompt = ANALYZE_TEXT_PROMPT$1.replace("{TEXT}", rawText);
      const analysisText = await callGemini$2("gemini-2.0-flash", [analyzePrompt]);
      const result = parseJSON$2(analysisText);
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

const genAI$1 = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const categoryList$1 = Object.keys(CATEGORIES).join("|");
const OCR_PROMPT = `Extract and analyze this receipt image. Return JSON only.

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
function sleep$1(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function downloadImage$1(url) {
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
async function callGemini$1(model, content, maxRetries = 3) {
  const geminiModel = genAI$1.getGenerativeModel({ model });
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await geminiModel.generateContent(content);
      return response.response.text();
    } catch (error) {
      const isRateLimit = error instanceof Error && (error.message.includes("429") || error.message.includes("Resource exhausted"));
      if (isRateLimit && attempt < maxRetries) {
        const delay = Math.pow(2, attempt) * 1e3;
        console.log(`[Receipt] Rate limited, retry in ${delay / 1e3}s (${attempt}/${maxRetries})`);
        await sleep$1(delay);
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
      const image = await downloadImage$1(input.imageUrl);
      console.log("[Receipt] Processing receipt...");
      const analysisText = await callGemini$1("gemini-2.0-flash", [
        OCR_PROMPT,
        { inlineData: { data: image.data, mimeType: image.mimeType } }
      ]);
      const ocrResult = parseJSON$1(analysisText);
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

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || "");
const EXTRACT_TEXT_PROMPT = `Extract ALL text from this image exactly as shown.
Include every word, number, and symbol visible.
Return ONLY the raw text, no formatting or explanation.`;
const categoryList = Object.keys(CATEGORIES).join("|");
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
        imageData = await downloadImage(input.imageUrl);
      } else {
        return {
          success: false,
          error: "No image provided (need imageUrl or imageBase64)"
        };
      }
      console.log("[OCR] Extracting text...");
      const rawText = await callGemini("gemini-2.0-flash", [
        EXTRACT_TEXT_PROMPT,
        { inlineData: { data: imageData.data, mimeType: imageData.mimeType } }
      ]);
      console.log(`[OCR] Extracted ${rawText.length} chars`);
      console.log("[OCR] Analyzing text...");
      const analyzePrompt = ANALYZE_TEXT_PROMPT.replace("{TEXT}", rawText);
      const analysisText = await callGemini("gemini-2.0-flash", [analyzePrompt]);
      const ocrResult = parseJSON(analysisText);
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

const bundler = {};

export { CATEGORIES, OcrResultSchema, ParseResultSchema, ResponseBuilder, TEMPLATES, bundler, checkDuplicatePurchaseTool, createExpenseTool, deleteExpenseTool, detectCategory, detectItemTypeTool, extractRawTextTool, extractReceiptTool, formatAmount, generateMissingFieldsPrompt, getBalancesTool, getCategoryByNameTool, getExpenseByIdTool, getExpensesTool, getMyBalanceTool, getPerishableWindowTool, getSpendingSummaryTool, getUserPreferencesTool, initSourceTool, listCategoriesTool, ocrReceiptTool, parseExpenseText, parseTextTool, processReceiptTool, processTextExpenseTool, reconcileExpenseTool, recordSettlementTool, responses, searchSimilarPurchasesTool, setNicknameTool, setUserLanguageTool, syncMembersTool, validateParsedExpense };
