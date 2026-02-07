import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getApiContext, apiRequest } from './5aaadd57-6742-4f80-91d8-d525c91493b6.mjs';
import 'jsonwebtoken';

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

export { getUserPreferencesTool, setUserLanguageTool };
