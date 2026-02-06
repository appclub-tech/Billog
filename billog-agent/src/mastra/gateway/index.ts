/**
 * Billog Gateway
 *
 * Unified channel interface for LINE, WhatsApp, and Telegram.
 * Provides session isolation per source (group/DM).
 */

export * from './types.js';
export * from './router.js';
export { LineAdapter } from './adapters/line.js';
export { WhatsAppAdapter } from './adapters/whatsapp.js';
