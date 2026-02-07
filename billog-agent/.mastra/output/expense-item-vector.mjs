import { Index } from '@upstash/vector';

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
  console.log(`[Vector] \u{1F4E6} Saving ${items.length} items for ${expenseId}`);
  if (!isVectorStoreConfigured()) {
    console.log("[Vector] \u26A0\uFE0F Skipping save - UPSTASH_VECTOR_REST_URL not configured");
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
    const itemNames = items.map((i) => i.name).join(", ");
    console.log(`[Vector] \u2705 Saved ${embeddings.length} items: ${itemNames.substring(0, 80)}`);
  } catch (error) {
    console.error(`[Vector] \u274C Failed to save embeddings:`, error);
  }
}
function daysBetween(dateStr, now) {
  const date = new Date(dateStr);
  const diffTime = now.getTime() - date.getTime();
  return Math.floor(diffTime / (1e3 * 60 * 60 * 24));
}
async function searchSimilarItems(query, sourceId, lookbackDays = 14, topK = 10) {
  console.log(`[Vector] \u{1F50D} Searching for "${query}" in source ${sourceId.substring(0, 12)}...`);
  if (!isVectorStoreConfigured()) {
    console.log("[Vector] \u26A0\uFE0F Search skipped - UPSTASH_VECTOR_REST_URL not configured");
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
      console.log(`[Vector] \u{1F50D} No matches found for "${query}"`);
      return { found: false, matches: [] };
    }
    matches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    console.log(`[Vector] \u2705 Found ${matches.length} matches, best: "${matches[0].name}" (${matches[0].daysSince} days ago)`);
    return {
      found: true,
      matches,
      lastPurchase: matches[0]
    };
  } catch (error) {
    console.error(`[Vector] \u274C Search failed:`, error);
    return { found: false, matches: [] };
  }
}

export { saveExpenseItemEmbeddings as a, detectItemType as d, getPerishableWindow as g, isVectorStoreConfigured as i, searchSimilarItems as s };
