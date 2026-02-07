import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getApiContext, apiRequest } from './c6e0983a-3be3-4b60-875a-a96a14c18c25.mjs';
import 'jsonwebtoken';

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

export { initSourceTool, setNicknameTool, syncMembersTool };
