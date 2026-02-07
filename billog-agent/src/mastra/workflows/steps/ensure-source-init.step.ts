/**
 * Ensure Source Init Step
 *
 * Guarantees that source, user, and membership exist before any operation.
 * This step runs FIRST on every message to ensure the user is "registered".
 *
 * Creates (idempotent):
 * - Source (group or DM)
 * - User
 * - Membership (user <-> source)
 * - Ledger accounts
 */

import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { apiRequest } from '../../tools/api-client.js';
import {
  MessageInputSchema,
  MessageWorkflowStateSchema,
  buildApiContext,
  type MessageInput,
} from '../schemas.js';

// Output schema - passes through input with init status
const EnsureSourceInitOutputSchema = z.object({
  sourceInitialized: z.boolean(),
  isNewSource: z.boolean(),
  isNewUser: z.boolean(),
});

export const ensureSourceInitStep = createStep({
  id: 'ensure-source-init',
  description: 'Initialize source, user, and membership in the system',
  inputSchema: MessageInputSchema,
  outputSchema: EnsureSourceInitOutputSchema,
  stateSchema: MessageWorkflowStateSchema,
  execute: async ({ inputData, setState, state }) => {
    const input = inputData as MessageInput;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`[STEP] ensure-source-init`);
    console.log(`${'='.repeat(60)}`);
    console.log(`  Channel:    ${input.channel}`);
    console.log(`  Source:     ${input.sourceChannelId} (${input.isGroup ? 'GROUP' : 'DM'})`);
    console.log(`  Sender:     ${input.senderChannelId}`);
    console.log(`${'='.repeat(60)}\n`);

    const context = buildApiContext(input);

    try {
      const response = await apiRequest<{
        isNewSource?: boolean;
        isNewUser?: boolean;
        source?: { id: string; name: string };
        user?: { id: string; name: string };
      }>('POST', '/sources/init', context, {
        channel: input.channel,
        sourceChannelId: input.sourceChannelId,
        sourceType: input.isGroup ? 'GROUP' : 'DM',
        sourceName: input.sourceName,
        senderChannelId: input.senderChannelId,
        senderDisplayName: input.senderName,
        currency: input.userCurrency,
      });

      const isNewSource = response.isNewSource ?? false;
      const isNewUser = response.isNewUser ?? false;

      if (isNewSource) {
        console.log(`[ensure-source-init] New source: ${response.source?.name}`);
      }
      if (isNewUser) {
        console.log(`[ensure-source-init] New user: ${response.user?.name}`);
      }

      // Update workflow state
      setState({
        ...state,
        sourceInitialized: true,
        isNewSource,
        isNewUser,
      });

      console.log(`[ensure-source-init] ✅ Source initialized`);

      return {
        sourceInitialized: true,
        isNewSource,
        isNewUser,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[ensure-source-init] ❌ Error: ${errorMsg}`);

      // Don't fail the workflow - continue without guaranteed init
      // The API tools will handle missing context gracefully
      setState({
        ...state,
        sourceInitialized: false,
        isNewSource: false,
        isNewUser: false,
        error: `Source init failed: ${errorMsg}`,
      });

      return {
        sourceInitialized: false,
        isNewSource: false,
        isNewUser: false,
      };
    }
  },
});
