/**
 * Billog API Client
 * Handles HTTP communication with the Billog API server
 */

import jwt from 'jsonwebtoken';

const BILLOG_API_URL = process.env.BILLOG_API_URL || 'http://localhost:8000';
const BILLOG_JWT_SECRET = process.env.BILLOG_JWT_SECRET || 'billog-jwt-secret-2024';

export interface ApiContext {
  channel: 'LINE' | 'WHATSAPP' | 'TELEGRAM';
  senderChannelId: string;
  sourceChannelId: string;
  sourceType?: 'GROUP' | 'DM';
}

/**
 * Generate a signed JWT token for API authentication
 * The token carries context about the channel/sender/source for auto-registration
 */
function generateJwt(context: ApiContext): string {
  const payload = {
    channel: context.channel,
    senderChannelId: context.senderChannelId,
    sourceChannelId: context.sourceChannelId,
    sourceType: context.sourceType || 'GROUP',
    // Agent identifier for audit trail
    iss: 'billog-agent',
    iat: Math.floor(Date.now() / 1000),
  };

  return jwt.sign(payload, BILLOG_JWT_SECRET, { expiresIn: '1h' });
}

/**
 * Make an authenticated request to the Billog API
 */
export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  context: ApiContext,
  body?: unknown
): Promise<T> {
  const url = `${BILLOG_API_URL}/api${path}`;
  const token = generateJwt(context);
  const requestId = Math.random().toString(36).substring(2, 10);

  // Log outbound request
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`[API] 📤 REQUEST [${requestId}]`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`  Method:     ${method}`);
  console.log(`  URL:        ${url}`);
  console.log(`  Context:    ${JSON.stringify(context)}`);
  if (body) {
    console.log(`  Body:       ${JSON.stringify(body, null, 2).substring(0, 500)}`);
  }
  console.log(`${'─'.repeat(50)}`);

  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Request-Id': requestId,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const duration = Date.now() - startTime;
    const responseText = await response.text();

    // Log response
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`[API] 📥 RESPONSE [${requestId}] ${response.status} ${duration}ms`);
    console.log(`${'─'.repeat(50)}`);
    console.log(`  Status:     ${response.status} ${response.statusText}`);
    console.log(`  Duration:   ${duration}ms`);
    console.log(`  Body:       ${responseText.substring(0, 500)}${responseText.length > 500 ? '...' : ''}`);
    console.log(`${'─'.repeat(50)}\n`);

    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${responseText}`);
    }

    // Parse JSON response
    try {
      return JSON.parse(responseText) as T;
    } catch {
      // Return empty object if no JSON body
      return {} as T;
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`[API] ❌ ERROR [${requestId}] ${duration}ms`);
    console.log(`${'─'.repeat(50)}`);
    console.log(`  Error:      ${error instanceof Error ? error.message : String(error)}`);
    console.log(`${'─'.repeat(50)}\n`);
    throw error;
  }
}

/**
 * Category definitions for expense categorization
 */
export const CATEGORIES = {
  Food: { nameLocalized: 'อาหาร', icon: '🍔', keywords: ['lunch', 'dinner', 'breakfast', 'restaurant', 'meal', 'snack', 'coffee'] },
  Transport: { nameLocalized: 'เดินทาง', icon: '🚗', keywords: ['taxi', 'grab', 'bts', 'mrt', 'gas', 'fuel', 'uber'] },
  Groceries: { nameLocalized: 'ของใช้', icon: '🛒', keywords: ['7-11', 'big c', 'lotus', 'supermarket', 'mart'] },
  Utilities: { nameLocalized: 'สาธารณูปโภค', icon: '💡', keywords: ['electric', 'water', 'internet', 'phone', 'bill'] },
  Entertainment: { nameLocalized: 'บันเทิง', icon: '🎬', keywords: ['movie', 'cinema', 'game', 'netflix', 'concert'] },
  Shopping: { nameLocalized: 'ช้อปปิ้ง', icon: '🛍️', keywords: ['clothes', 'electronics', 'online', 'lazada', 'shopee'] },
  Health: { nameLocalized: 'สุขภาพ', icon: '💊', keywords: ['medicine', 'hospital', 'clinic', 'gym', 'pharmacy'] },
  Education: { nameLocalized: 'การศึกษา', icon: '📚', keywords: ['course', 'book', 'tutor', 'school'] },
  Travel: { nameLocalized: 'ท่องเที่ยว', icon: '✈️', keywords: ['hotel', 'flight', 'tour', 'agoda', 'booking'] },
  Housing: { nameLocalized: 'ที่อยู่อาศัย', icon: '🏠', keywords: ['rent', 'repair', 'furniture'] },
  Personal: { nameLocalized: 'ส่วนตัว', icon: '👤', keywords: ['haircut', 'salon', 'personal'] },
  Gift: { nameLocalized: 'ของขวัญ', icon: '🎁', keywords: ['gift', 'present', 'donation'] },
  Other: { nameLocalized: 'อื่นๆ', icon: '📦', keywords: [] },
} as const;

export type CategoryName = keyof typeof CATEGORIES;

/**
 * Auto-detect category from description
 */
export function detectCategory(description: string): CategoryName {
  const lower = description.toLowerCase();

  for (const [category, data] of Object.entries(CATEGORIES)) {
    if (data.keywords.some(keyword => lower.includes(keyword))) {
      return category as CategoryName;
    }
  }

  return 'Other';
}

/**
 * Format currency amount for display
 */
export function formatAmount(amount: number, currency = 'THB'): string {
  const symbols: Record<string, string> = {
    THB: '฿',
    USD: '$',
    EUR: '€',
    JPY: '¥',
    AUD: 'A$',
  };
  return `${symbols[currency] || currency}${amount.toLocaleString()}`;
}

/**
 * Extract API context from tool input or RequestContext
 * Tools can receive context from either source - input takes precedence
 */
export function getApiContext(
  input: {
    channel?: 'LINE' | 'WHATSAPP' | 'TELEGRAM';
    senderChannelId?: string;
    sourceChannelId?: string;
    sourceType?: 'GROUP' | 'DM';
  },
  requestContext?: { get: (key: string) => unknown }
): ApiContext | null {
  const channel = input.channel || requestContext?.get('channel') as 'LINE' | 'WHATSAPP' | 'TELEGRAM' | undefined;
  const senderChannelId = input.senderChannelId || requestContext?.get('senderChannelId') as string | undefined;
  const sourceChannelId = input.sourceChannelId || requestContext?.get('sourceChannelId') as string | undefined;
  const isGroup = requestContext?.get('isGroup') as boolean | undefined;
  const sourceType = input.sourceType || (isGroup === false ? 'DM' : 'GROUP');

  if (!channel || !senderChannelId || !sourceChannelId) {
    console.error('[API] Missing context:', { channel, senderChannelId, sourceChannelId });
    return null;
  }

  return { channel, senderChannelId, sourceChannelId, sourceType };
}
