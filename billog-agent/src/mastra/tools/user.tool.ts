import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { apiRequest, getApiContext } from './api-client.js';

/**
 * Get User Preferences Tool
 * Fetches user's language and other preferences
 */
export const getUserPreferencesTool = createTool({
  id: 'get-user-preferences',
  description: `Get user's preferences including language setting.
Call this to know which language (th/en) to use for responses.`,
  inputSchema: z.object({
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    language: z.enum(['th', 'en']).describe('User language preference'),
    timezone: z.string().optional(),
    name: z.string().optional(),
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      // Default to Thai if no context
      return { success: true, language: 'th' as const };
    }

    try {
      const response = await apiRequest<{
        user: {
          id: string;
          name: string | null;
          language: string;
          timezone: string;
        };
      }>('GET', '/users/me', context);

      return {
        success: true,
        language: (response.user.language === 'en' ? 'en' : 'th') as 'th' | 'en',
        timezone: response.user.timezone,
        name: response.user.name || undefined,
      };
    } catch (error) {
      // Default to Thai if can't fetch preferences
      return {
        success: true,
        language: 'th' as const,
      };
    }
  },
});

/**
 * Set User Language Tool
 * Updates user's language preference
 */
export const setUserLanguageTool = createTool({
  id: 'set-user-language',
  description: `Set user's preferred language for responses.
Use when user says "speak English", "speak Thai", "use Thai", etc.`,
  inputSchema: z.object({
    language: z.enum(['th', 'en']).describe('Language: th (Thai) or en (English)'),
    // Context (optional - auto-injected from RequestContext)
    channel: z.enum(['LINE', 'WHATSAPP', 'TELEGRAM']).optional().describe('Chat channel (auto-injected)'),
    senderChannelId: z.string().optional().describe('User channel ID (auto-injected)'),
    sourceChannelId: z.string().optional().describe('Group/DM channel ID (auto-injected)'),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
  }),
  execute: async (input, ctx) => {
    const context = getApiContext(input, ctx?.requestContext);
    if (!context) {
      return { success: false, message: 'Error: Missing context' };
    }

    try {
      await apiRequest<{ success: boolean }>('PATCH', '/users/me', context, {
        language: input.language,
      });

      const message = input.language === 'th'
        ? 'Language set to Thai'
        : 'Language set to English';

      return {
        success: true,
        message,
      };
    } catch (error) {
      return {
        success: false,
        message: `Error: ${error instanceof Error ? error.message : 'Failed to update language'}`,
      };
    }
  },
});
