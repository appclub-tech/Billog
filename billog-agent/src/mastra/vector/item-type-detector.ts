/**
 * Item Type Detector
 *
 * Detects perishable item types for Insights Agent.
 * Maps items to their freshness windows.
 */

/**
 * Perishable item types with their freshness windows (days)
 */
export const PERISHABLE_WINDOWS = {
  fresh_produce: 7,   // banana, vegetables, leafy greens
  dairy: 14,          // milk, yogurt, cheese
  bread: 5,           // bread, pastries
  meat_seafood: 3,    // chicken, fish, shrimp
  eggs: 21,           // eggs
  frozen: 60,         // frozen items
  pantry: 180,        // rice, pasta, canned goods
  non_food: 0,        // household items (no check)
} as const;

export type ItemType = keyof typeof PERISHABLE_WINDOWS;

/**
 * Keyword patterns for item type detection
 * Supports both English and Thai
 */
const ITEM_TYPE_PATTERNS: Record<ItemType, RegExp[]> = {
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
    /fresh|สด/i,
  ],
  dairy: [
    /milk|นม/i,
    /yogurt|โยเกิร์ต/i,
    /cheese|ชีส/i,
    /cream|ครีม/i,
    /butter|เนย/i,
    /dairy|นม/i,
    /kefir/i,
  ],
  bread: [
    /bread|ขนมปัง/i,
    /bakery|เบเกอรี่/i,
    /pastry|เพสตรี้/i,
    /croissant|ครัวซองต์/i,
    /donut|โดนัท/i,
    /cake|เค้ก/i,
    /bun|ซาลาเปา|ปัง/i,
    /toast|โทสต์/i,
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
    /tuna|ทูน่า/i,
  ],
  eggs: [
    /egg|ไข่/i,
  ],
  frozen: [
    /frozen|แช่แข็ง/i,
    /ice cream|ไอศกรีม/i,
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
    /cereal|ซีเรียล/i,
  ],
  non_food: [
    /soap|สบู่/i,
    /shampoo|แชมพู/i,
    /detergent|ผงซักฟอก/i,
    /tissue|ทิชชู่|กระดาษ/i,
    /toothpaste|ยาสีฟัน/i,
    /cleaning|ทำความสะอาด/i,
    /household|ของใช้/i,
  ],
};

/**
 * Detect item type from item name
 * Uses keyword matching with bilingual support
 *
 * @param itemName - The item name (English or Thai)
 * @returns The detected item type, defaults to 'pantry' if unknown
 */
export function detectItemType(itemName: string): ItemType {
  const normalizedName = itemName.toLowerCase().trim();

  for (const [type, patterns] of Object.entries(ITEM_TYPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalizedName)) {
        return type as ItemType;
      }
    }
  }

  // Default to pantry for unrecognized food items
  return 'pantry';
}

/**
 * Get freshness window for an item type
 *
 * @param itemType - The item type
 * @returns Number of days for freshness check
 */
export function getPerishableWindow(itemType: ItemType): number {
  return PERISHABLE_WINDOWS[itemType];
}

/**
 * Get freshness window for an item name
 *
 * @param itemName - The item name
 * @returns Number of days for freshness check
 */
export function getPerishableWindowForItem(itemName: string): number {
  const itemType = detectItemType(itemName);
  return getPerishableWindow(itemType);
}

/**
 * Check if an item type should be checked for freshness
 *
 * @param itemType - The item type
 * @returns true if item should be checked, false for non_food
 */
export function shouldCheckFreshness(itemType: ItemType): boolean {
  return itemType !== 'non_food';
}
