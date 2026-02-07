import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { a as searchSimilarItems, g as getPerishableWindow, d as detectItemType } from '../expense-item-vector.mjs';
import '@upstash/vector';

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

export { checkDuplicatePurchaseTool, detectItemTypeTool, getPerishableWindowTool, searchSimilarPurchasesTool };
