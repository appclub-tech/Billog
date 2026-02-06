import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { apiRequest, getApiContext } from './api-client.js';

/**
 * Category schema with Zod validation
 */
const CategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  nameLocalized: z.string().nullable(),
  icon: z.string().nullable(),
  color: z.string().nullable(),
});

export type Category = z.infer<typeof CategorySchema>;

/**
 * Simple in-memory cache for categories
 * Categories rarely change, so we cache for 1 hour
 */
interface CategoryCache {
  data: Category[];
  timestamp: number;
}
let categoryCache: CategoryCache | null = null;
const CATEGORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * List Categories Tool
 * Fetches all available expense categories from the API
 */
export const listCategoriesTool = createTool({
  id: 'list-categories',
  description: `List all available expense categories. Use this to get category IDs for creating expenses.
Returns categories with id, name, nameLocalized (Thai name), icon, and color.`,
  inputSchema: z.object({
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    categories: z.array(CategorySchema),
    message: z.string(),
  }),
  execute: async (input, ctx) => {
    // Check cache first (categories rarely change)
    if (categoryCache && Date.now() - categoryCache.timestamp < CATEGORY_CACHE_TTL) {
      console.log('[CategoryTool] Using cached categories');
      const categoryList = categoryCache.data
        .map((c) => `${c.icon || '📦'} ${c.name} (${c.nameLocalized || c.name}) - ID: ${c.id}`)
        .join('\n');

      return {
        success: true,
        categories: categoryCache.data,
        message: `Available categories:\n${categoryList}`,
      };
    }

    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, categories: [], message: 'Error: Missing context' };
    }

    try {
      const response = await apiRequest<{
        categories: Category[];
      }>('GET', '/categories', context);

      // Cache the result
      categoryCache = {
        data: response.categories,
        timestamp: Date.now(),
      };
      console.log('[CategoryTool] Fetched and cached categories');

      // Format message with category list
      const categoryList = response.categories
        .map((c) => `${c.icon || '📦'} ${c.name} (${c.nameLocalized || c.name}) - ID: ${c.id}`)
        .join('\n');

      return {
        success: true,
        categories: response.categories,
        message: `Available categories:\n${categoryList}`,
      };
    } catch (error) {
      return {
        success: false,
        categories: [],
        message: `Failed to list categories: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});

/**
 * Get Category by Name Tool
 * Finds a category by name and returns its ID
 */
export const getCategoryByNameTool = createTool({
  id: 'get-category-by-name',
  description: `Find a category by name to get its ID. Use before creating an expense to get the correct categoryId.
Common categories: Food, Transport, Groceries, Utilities, Entertainment, Shopping, Health, Education, Travel, Housing, Personal, Gift, Other`,
  inputSchema: z.object({
    name: z.string().describe('Category name (English): Food, Transport, etc.'),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    category: CategorySchema.nullable(),
    message: z.string(),
  }),
  execute: async (input, ctx) => {
    // Check cache first (avoid API call if we have categories cached)
    if (categoryCache && Date.now() - categoryCache.timestamp < CATEGORY_CACHE_TTL) {
      const nameLower = input.name.toLowerCase();
      const found = categoryCache.data.find(
        (c) =>
          c.name.toLowerCase() === nameLower ||
          c.nameLocalized?.toLowerCase() === nameLower
      );

      if (found) {
        console.log(`[CategoryTool] Found "${input.name}" in cache`);
        return {
          success: true,
          category: found,
          message: `Found: ${found.icon || '📦'} ${found.name} (ID: ${found.id})`,
        };
      }
      // Not found in cache, but cache is valid - category doesn't exist
      console.log(`[CategoryTool] "${input.name}" not in cache`);
      return {
        success: false,
        category: null,
        message: `Category "${input.name}" not found. Use "Other" as default.`,
      };
    }

    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, category: null, message: 'Error: Missing context' };
    }

    try {
      const response = await apiRequest<{
        category: Category | null;
      }>('GET', `/categories/by-name/${encodeURIComponent(input.name)}`, context);

      if (response.category) {
        return {
          success: true,
          category: response.category,
          message: `Found: ${response.category.icon || '📦'} ${response.category.name} (ID: ${response.category.id})`,
        };
      } else {
        return {
          success: false,
          category: null,
          message: `Category "${input.name}" not found. Use "Other" as default.`,
        };
      }
    } catch (error) {
      return {
        success: false,
        category: null,
        message: `Failed to find category: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  },
});
