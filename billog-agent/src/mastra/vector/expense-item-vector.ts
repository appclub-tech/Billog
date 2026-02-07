/**
 * Expense Item Vector Store
 *
 * Manages expense item embeddings in Upstash Vector for the Insights Agent.
 * Each ExpenseItem gets its own embedding for semantic search.
 */

import { Index } from '@upstash/vector';
import { detectItemType, type ItemType } from './item-type-detector.js';

// ============================================
// Types
// ============================================

/**
 * Metadata stored with each expense item embedding
 */
export interface ExpenseItemEmbeddingMetadata {
  name: string;              // "banana" or item name
  nameLocalized?: string;    // "กล้วย" (original language)
  sourceId: string;          // Group/DM ID (whole group scope)
  date: string;              // ISO date of purchase
  expenseId: string;         // Parent expense EX:xxx
  quantity: number;          // 2
  unit?: string;             // "bunch", "kg", "หวี"
  unitPrice: number;         // 25
  totalPrice: number;        // 50
  itemType: ItemType;        // "fresh_produce", "dairy", etc.
  paidBy?: string;           // Who paid for this item
}

/**
 * Input for saving an expense item
 */
export interface ExpenseItemInput {
  name: string;
  nameLocalized?: string;
  quantity: number;
  unit?: string;
  unitPrice: number;
  totalPrice?: number;
}

/**
 * Search result from vector query
 */
export interface SimilarItemMatch {
  id: string;
  name: string;
  nameLocalized?: string;
  date: string;
  quantity: number;
  unit?: string;
  totalPrice: number;
  expenseId: string;
  itemType: ItemType;
  similarity: number;
  daysSince: number;
  paidBy?: string;
}

// ============================================
// Vector Index Singleton
// ============================================

let vectorIndex: Index | null = null;

/**
 * Get or create the Upstash Vector index
 * Uses environment variables for configuration
 */
export function getExpenseItemVectorIndex(): Index {
  if (vectorIndex) {
    return vectorIndex;
  }

  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;

  if (!url || !token) {
    throw new Error(
      'Missing Upstash Vector configuration. Set UPSTASH_VECTOR_REST_URL and UPSTASH_VECTOR_REST_TOKEN.'
    );
  }

  vectorIndex = new Index({
    url,
    token,
  });

  console.log('[Vector] Upstash Vector index initialized');
  return vectorIndex;
}

/**
 * Check if vector store is configured
 */
export function isVectorStoreConfigured(): boolean {
  return !!(process.env.UPSTASH_VECTOR_REST_URL && process.env.UPSTASH_VECTOR_REST_TOKEN);
}

// ============================================
// Save Operations
// ============================================

/**
 * Save expense item embeddings to vector store
 *
 * Each item from an expense gets its own embedding for semantic search.
 * Combines name + localized name for better multilingual matching.
 *
 * @param expenseId - Parent expense ID
 * @param items - Array of expense items
 * @param sourceId - Group/DM source ID
 * @param date - Transaction date (ISO string)
 * @param paidBy - Who paid (optional)
 */
export async function saveExpenseItemEmbeddings(
  expenseId: string,
  items: ExpenseItemInput[],
  sourceId: string,
  date: string,
  paidBy?: string
): Promise<void> {
  console.log(`[Vector] 📦 Saving ${items.length} items for ${expenseId}`);

  if (!isVectorStoreConfigured()) {
    console.log('[Vector] ⚠️ Skipping save - UPSTASH_VECTOR_REST_URL not configured');
    return;
  }

  const index = getExpenseItemVectorIndex();

  const embeddings = items.map((item, idx) => {
    // Combine name + localized for better semantic matching
    const searchText = item.nameLocalized
      ? `${item.name} ${item.nameLocalized}`
      : item.name;

    const metadata: ExpenseItemEmbeddingMetadata = {
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
      paidBy,
    };

    return {
      id: `${expenseId}-item-${idx}`,
      data: searchText,
      metadata: metadata as unknown as Record<string, unknown>,
    };
  });

  try {
    // Batch upsert all items
    await index.upsert(embeddings);
    const itemNames = items.map(i => i.name).join(', ');
    console.log(`[Vector] ✅ Saved ${embeddings.length} items: ${itemNames.substring(0, 80)}`);
  } catch (error) {
    console.error(`[Vector] ❌ Failed to save embeddings:`, error);
    // Don't throw - embedding save is non-critical
  }
}

/**
 * Save a single expense as one item
 * Used when expense doesn't have itemized line items
 *
 * @param expenseId - Expense ID
 * @param description - Expense description (used as item name)
 * @param amount - Total amount
 * @param sourceId - Group/DM source ID
 * @param date - Transaction date (ISO string)
 * @param paidBy - Who paid (optional)
 */
export async function saveSimpleExpenseEmbedding(
  expenseId: string,
  description: string,
  amount: number,
  sourceId: string,
  date: string,
  paidBy?: string
): Promise<void> {
  await saveExpenseItemEmbeddings(
    expenseId,
    [{
      name: description,
      quantity: 1,
      unitPrice: amount,
      totalPrice: amount,
    }],
    sourceId,
    date,
    paidBy
  );
}

// ============================================
// Search Operations
// ============================================

/**
 * Calculate days between two dates
 */
function daysBetween(dateStr: string, now: Date): number {
  const date = new Date(dateStr);
  const diffTime = now.getTime() - date.getTime();
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Search for similar items in purchase history
 * Uses semantic search to match across languages
 *
 * @param query - Item to search for ("banana", "กล้วย", etc.)
 * @param sourceId - Group/DM source ID (whole group scope)
 * @param lookbackDays - Days to look back (filters by date)
 * @param topK - Number of results to return
 * @returns Array of matching items with similarity scores
 */
export async function searchSimilarItems(
  query: string,
  sourceId: string,
  lookbackDays: number = 14,
  topK: number = 10
): Promise<{
  found: boolean;
  matches: SimilarItemMatch[];
  lastPurchase?: SimilarItemMatch;
}> {
  console.log(`[Vector] 🔍 Searching for "${query}" in source ${sourceId.substring(0, 12)}...`);

  if (!isVectorStoreConfigured()) {
    console.log('[Vector] ⚠️ Search skipped - UPSTASH_VECTOR_REST_URL not configured');
    return { found: false, matches: [] };
  }

  const index = getExpenseItemVectorIndex();
  const now = new Date();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - lookbackDays);

  try {
    const results = await index.query({
      data: query,
      topK,
      filter: `sourceId = '${sourceId}'`,
      includeMetadata: true,
    });

    // Filter by date and format results
    const matches: SimilarItemMatch[] = results
      .filter((r) => {
        const metadata = r.metadata as unknown as ExpenseItemEmbeddingMetadata;
        const itemDate = new Date(metadata.date);
        return itemDate >= cutoffDate;
      })
      .filter((r) => r.score >= 0.7) // Only relevant matches
      .map((r) => {
        const metadata = r.metadata as unknown as ExpenseItemEmbeddingMetadata;
        return {
          id: r.id as string,
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
          paidBy: metadata.paidBy,
        };
      });

    if (matches.length === 0) {
      console.log(`[Vector] 🔍 No matches found for "${query}"`);
      return { found: false, matches: [] };
    }

    // Sort by date (most recent first)
    matches.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    console.log(`[Vector] ✅ Found ${matches.length} matches, best: "${matches[0].name}" (${matches[0].daysSince} days ago)`);

    return {
      found: true,
      matches,
      lastPurchase: matches[0],
    };
  } catch (error) {
    console.error(`[Vector] ❌ Search failed:`, error);
    return { found: false, matches: [] };
  }
}

/**
 * Delete all embeddings for an expense
 * Called when expense is deleted
 *
 * @param expenseId - Expense ID
 */
export async function deleteExpenseEmbeddings(expenseId: string): Promise<void> {
  if (!isVectorStoreConfigured()) {
    return;
  }

  const index = getExpenseItemVectorIndex();

  try {
    // Delete by prefix pattern (expense items are named: {expenseId}-item-{idx})
    // Upstash doesn't have prefix delete, so we query first then delete
    const results = await index.query({
      data: 'expense item', // Generic query to find items
      topK: 100,
      filter: `expenseId = '${expenseId}'`,
      includeMetadata: true,
    });

    if (results.length > 0) {
      const ids = results.map((r) => r.id as string);
      await index.delete(ids);
      console.log(`[Vector] Deleted ${ids.length} embeddings for expense ${expenseId}`);
    }
  } catch (error) {
    console.error(`[Vector] Failed to delete embeddings:`, error);
  }
}
