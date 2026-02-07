/**
 * Vector Store Module
 *
 * Exports vector utilities for the Insights Agent.
 * Uses Upstash Vector for semantic search of expense items.
 */

// Expense item vector operations
export {
  getExpenseItemVectorIndex,
  isVectorStoreConfigured,
  saveExpenseItemEmbeddings,
  searchSimilarItems,
  deleteExpenseEmbeddings,
  type ExpenseItemEmbeddingMetadata,
  type ExpenseItemInput,
  type SimilarItemMatch,
} from './expense-item-vector.js';

// Item type detection
export {
  PERISHABLE_WINDOWS,
  detectItemType,
  getPerishableWindow,
  getPerishableWindowForItem,
  shouldCheckFreshness,
  type ItemType,
} from './item-type-detector.js';
