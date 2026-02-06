/**
 * Unit tests for gateway types and utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  makeSessionKey,
  parseSessionKey,
  shouldActivate,
  type InboundMessage,
  type ActivationMode,
} from '../../../src/mastra/gateway/types.js';

describe('Gateway Types', () => {
  describe('makeSessionKey', () => {
    it('creates key for LINE DM', () => {
      expect(makeSessionKey('LINE', 'U1234567890')).toBe('LINE:U1234567890');
    });

    it('creates key for LINE group', () => {
      expect(makeSessionKey('LINE', 'C1234567890')).toBe('LINE:C1234567890');
    });

    it('creates key for WhatsApp DM', () => {
      expect(makeSessionKey('WHATSAPP', '6281234567890')).toBe('WHATSAPP:6281234567890');
    });

    it('creates key for WhatsApp group (with special chars)', () => {
      expect(makeSessionKey('WHATSAPP', '120363403215116621@g.us')).toBe(
        'WHATSAPP:120363403215116621@g.us'
      );
    });
  });

  describe('parseSessionKey', () => {
    it('parses LINE DM key', () => {
      expect(parseSessionKey('LINE:U1234567890')).toEqual({
        channel: 'LINE',
        sourceId: 'U1234567890',
      });
    });

    it('parses WhatsApp group key with special chars', () => {
      expect(parseSessionKey('WHATSAPP:120363403215116621@g.us')).toEqual({
        channel: 'WHATSAPP',
        sourceId: '120363403215116621@g.us',
      });
    });

    it('handles sourceId containing colons', () => {
      // Edge case: some platforms might have colons in IDs
      expect(parseSessionKey('TELEGRAM:user:12345')).toEqual({
        channel: 'TELEGRAM',
        sourceId: 'user:12345',
      });
    });

    it('returns null for invalid key (no colon)', () => {
      expect(parseSessionKey('INVALID')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(parseSessionKey('')).toBeNull();
    });
  });

  describe('shouldActivate', () => {
    const createMessage = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
      id: 'msg-1',
      channel: 'LINE',
      text: 'hello',
      sender: { id: 'user-1', name: 'Test User' },
      source: { id: 'group-1', type: 'group', name: 'Test Group' },
      timestamp: new Date(),
      ...overrides,
    });

    describe('DM messages', () => {
      it('always activates for DM regardless of mode', () => {
        const dmMessage = createMessage({
          source: { id: 'user-1', type: 'dm' },
        });

        expect(shouldActivate(dmMessage, 'mention', [])).toBe(true);
        expect(shouldActivate(dmMessage, 'always', [])).toBe(true);
      });
    });

    describe('Group messages with "always" mode', () => {
      it('activates for any group message', () => {
        const groupMessage = createMessage({ text: 'random message' });
        expect(shouldActivate(groupMessage, 'always', [])).toBe(true);
      });
    });

    describe('Group messages with "mention" mode', () => {
      it('activates when mentions array has values', () => {
        const groupMessage = createMessage({ mentions: ['billog'] });
        expect(shouldActivate(groupMessage, 'mention', [])).toBe(true);
      });

      it('activates when text contains @billog', () => {
        const groupMessage = createMessage({ text: '@billog coffee 65' });
        expect(shouldActivate(groupMessage, 'mention', ['@billog', 'billog'])).toBe(true);
      });

      it('activates when text contains billog (case insensitive)', () => {
        const groupMessage = createMessage({ text: 'BILLOG lunch 200' });
        expect(shouldActivate(groupMessage, 'mention', ['@billog', 'billog'])).toBe(true);
      });

      it('activates when text contains billog anywhere', () => {
        const groupMessage = createMessage({ text: 'hey billog record this' });
        expect(shouldActivate(groupMessage, 'mention', ['billog'])).toBe(true);
      });

      it('does NOT activate when no mention pattern matches', () => {
        const groupMessage = createMessage({ text: 'random group chat' });
        expect(shouldActivate(groupMessage, 'mention', ['@billog', 'billog'])).toBe(false);
      });

      it('does NOT activate when text is empty', () => {
        const groupMessage = createMessage({ text: undefined });
        expect(shouldActivate(groupMessage, 'mention', ['@billog'])).toBe(false);
      });

      it('does NOT activate when mention patterns array is empty', () => {
        const groupMessage = createMessage({ text: '@billog test' });
        expect(shouldActivate(groupMessage, 'mention', [])).toBe(false);
      });
    });

    describe('Thai language patterns', () => {
      it('activates with Thai mention pattern', () => {
        const groupMessage = createMessage({ text: 'บิลล็อก กาแฟ 65' });
        expect(shouldActivate(groupMessage, 'mention', ['บิลล็อก', 'billog'])).toBe(true);
      });
    });
  });
});
