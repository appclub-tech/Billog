import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getApiContext, apiRequest } from './5aaadd57-6742-4f80-91d8-d525c91493b6.mjs';
import 'jsonwebtoken';

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

export { getCategoryByNameTool, listCategoriesTool };
