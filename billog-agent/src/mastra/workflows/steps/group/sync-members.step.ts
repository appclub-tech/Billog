/**
 * Sync Members Step
 *
 * Fetches current group members for @all resolution.
 * Called at the start of group workflows to ensure we have accurate member list.
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { apiRequest, type ApiContext } from '../../../tools/api-client.js';
import {
  MessageWorkflowStateSchema,
  ChannelSchema,
} from '../../schemas.js';

const SyncMembersInputSchema = z.object({
  channel: ChannelSchema,
  sourceChannelId: z.string(),
  senderChannelId: z.string(),
});

const SyncMembersOutputSchema = z.object({
  success: z.boolean(),
  members: z.array(z.object({
    id: z.string(),
    name: z.string().nullable(),
    nickname: z.string().nullable(),
    channelId: z.string(),
  })),
  error: z.string().optional(),
});

export const syncMembersStep = createStep({
  id: 'sync-members',
  description: 'Fetch group members for @all resolution',
  inputSchema: SyncMembersInputSchema,
  outputSchema: SyncMembersOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] sync-members`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Channel:  ${inputData.channel}`);
    console.log(`  Source:   ${inputData.sourceChannelId}`);
    console.log(`${'='.repeat(60)}\n`);

    const context: ApiContext = {
      channel: inputData.channel,
      senderChannelId: inputData.senderChannelId,
      sourceChannelId: inputData.sourceChannelId,
      sourceType: 'GROUP',
    };

    try {
      // Fetch members from API
      const response = await apiRequest<{
        members: Array<{
          id: string;
          name: string | null;
          nickname: string | null;
          channelId: string;
        }>;
      }>('GET', `/sources/${inputData.sourceChannelId}/members`, context);

      const members = response.members || [];

      console.log(`[sync-members] ✅ Fetched ${members.length} members`);

      setState({
        ...state,
        groupMembers: members.map(m => ({
          id: m.id,
          name: m.name,
          nickname: m.nickname,
        })),
      });

      return {
        success: true,
        members,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[sync-members] ❌ Error: ${errorMsg}`);

      // Don't fail - continue with empty members
      // The API will handle @all resolution
      return {
        success: false,
        members: [],
        error: errorMsg,
      };
    }
  },
});
