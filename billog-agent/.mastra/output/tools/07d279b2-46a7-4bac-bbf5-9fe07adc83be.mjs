import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { apiRequest } from './68251daa-bc82-4965-8592-33499397cad4.mjs';

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
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    sourceChannelId: z.string().describe("Group/DM channel ID"),
    sourceType: z.enum(["GROUP", "DM"]).default("GROUP").describe("Source type"),
    sourceName: z.string().optional().describe("Group name"),
    senderChannelId: z.string().describe("User channel ID"),
    senderDisplayName: z.string().optional().describe("User display name"),
    members: z.array(MemberInputSchema).optional().describe("Initial member list (for WhatsApp)"),
    currency: z.string().default("THB").describe("Default currency")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string(),
    isNewSource: z.boolean().optional(),
    isNewUser: z.boolean().optional()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId,
      sourceType: input.sourceType
    };
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
        message = `\u2705 \u0E01\u0E25\u0E38\u0E48\u0E21\u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27!
`;
        message += `   Source: ${source.name}
`;
        message += `   \u0E2A\u0E21\u0E32\u0E0A\u0E34\u0E01: ${source.memberCount} \u0E04\u0E19

`;
        message += `   \u0E1E\u0E34\u0E21\u0E1E\u0E4C "\u0E0A\u0E48\u0E27\u0E22\u0E14\u0E49\u0E27\u0E22" \u0E2B\u0E23\u0E37\u0E2D "help" \u0E40\u0E1E\u0E37\u0E48\u0E2D\u0E14\u0E39\u0E04\u0E33\u0E2A\u0E31\u0E48\u0E07`;
      } else if (isNewUser) {
        message = `\u2705 \u0E25\u0E07\u0E17\u0E30\u0E40\u0E1A\u0E35\u0E22\u0E19\u0E2A\u0E33\u0E40\u0E23\u0E47\u0E08!
`;
        message += `   \u0E0A\u0E37\u0E48\u0E2D: ${user.name}
`;
        if (user.nickname) {
          message += `   \u0E23\u0E2B\u0E31\u0E2A: @${user.nickname}
`;
        }
        message += `
   \u0E40\u0E23\u0E34\u0E48\u0E21\u0E1A\u0E31\u0E19\u0E17\u0E36\u0E01\u0E04\u0E48\u0E32\u0E43\u0E0A\u0E49\u0E08\u0E48\u0E32\u0E22\u0E44\u0E14\u0E49\u0E40\u0E25\u0E22 \u0E40\u0E0A\u0E48\u0E19 "\u0E01\u0E32\u0E41\u0E1F 65"`;
      } else {
        message = `\u2705 \u0E1E\u0E23\u0E49\u0E2D\u0E21\u0E43\u0E0A\u0E49\u0E07\u0E32\u0E19\u0E41\u0E25\u0E49\u0E27
`;
        message += `   Source: ${source.name} (${source.memberCount} \u0E04\u0E19)`;
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
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group channel ID"),
    members: z.array(MemberInputSchema).describe("Current member list")
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
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      const sourceResponse = await apiRequest("GET", `/sources?channel=${input.channel}&channelId=${input.sourceChannelId}`, context);
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
- "\u0E15\u0E31\u0E49\u0E07\u0E0A\u0E37\u0E48\u0E2D\u0E40\u0E25\u0E48\u0E19 boss"
- "call me boss"
- "set nickname tom"`,
  inputSchema: z.object({
    nickname: z.string().describe("New nickname (without @)"),
    channel: z.enum(["LINE", "WHATSAPP", "TELEGRAM"]).describe("Chat channel"),
    senderChannelId: z.string().describe("User channel ID"),
    sourceChannelId: z.string().describe("Group/DM channel ID")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string()
  }),
  execute: async (input) => {
    const context = {
      channel: input.channel,
      senderChannelId: input.senderChannelId,
      sourceChannelId: input.sourceChannelId
    };
    try {
      await apiRequest("PATCH", "/users/me", context, {
        nickname: input.nickname
      });
      return {
        success: true,
        message: `\u2705 \u0E15\u0E31\u0E49\u0E07\u0E0A\u0E37\u0E48\u0E2D\u0E40\u0E25\u0E48\u0E19\u0E41\u0E25\u0E49\u0E27: @${input.nickname}`
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
