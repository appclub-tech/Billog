import jwt from 'jsonwebtoken';

const BILLOG_API_URL = process.env.BILLOG_API_URL || "http://localhost:8000";
const BILLOG_JWT_SECRET = process.env.BILLOG_JWT_SECRET || "billog-jwt-secret-2024";
function generateJwt(context) {
  const payload = {
    channel: context.channel,
    senderChannelId: context.senderChannelId,
    sourceChannelId: context.sourceChannelId,
    sourceType: context.sourceType || "GROUP",
    // Agent identifier for audit trail
    iss: "billog-agent",
    iat: Math.floor(Date.now() / 1e3)
  };
  return jwt.sign(payload, BILLOG_JWT_SECRET, { expiresIn: "1h" });
}
async function apiRequest(method, path, context, body) {
  const url = `${BILLOG_API_URL}/api${path}`;
  const token = generateJwt(context);
  const requestId = Math.random().toString(36).substring(2, 10);
  console.log(`[API] ${method} ${path}`);
  const startTime = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Request-Id": requestId
      },
      body: body ? JSON.stringify(body) : void 0
    });
    const duration = Date.now() - startTime;
    const responseText = await response.text();
    console.log(`[API] ${response.status} ${duration}ms`);
    if (!response.ok) {
      throw new Error(`API Error ${response.status}: ${responseText}`);
    }
    try {
      return JSON.parse(responseText);
    } catch {
      return {};
    }
  } catch (error) {
    const duration = Date.now() - startTime;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`[API] \u274C ${method} ${path} failed ${duration}ms: ${errMsg}`);
    throw error;
  }
}
const CATEGORIES = {
  Food: { nameLocalized: "\u0E2D\u0E32\u0E2B\u0E32\u0E23", icon: "\u{1F354}", keywords: ["lunch", "dinner", "breakfast", "restaurant", "meal", "snack", "coffee"] },
  Transport: { nameLocalized: "\u0E40\u0E14\u0E34\u0E19\u0E17\u0E32\u0E07", icon: "\u{1F697}", keywords: ["taxi", "grab", "bts", "mrt", "gas", "fuel", "uber"] },
  Groceries: { nameLocalized: "\u0E02\u0E2D\u0E07\u0E43\u0E0A\u0E49", icon: "\u{1F6D2}", keywords: ["7-11", "big c", "lotus", "supermarket", "mart"] },
  Utilities: { nameLocalized: "\u0E2A\u0E32\u0E18\u0E32\u0E23\u0E13\u0E39\u0E1B\u0E42\u0E20\u0E04", icon: "\u{1F4A1}", keywords: ["electric", "water", "internet", "phone", "bill"] },
  Entertainment: { nameLocalized: "\u0E1A\u0E31\u0E19\u0E40\u0E17\u0E34\u0E07", icon: "\u{1F3AC}", keywords: ["movie", "cinema", "game", "netflix", "concert"] },
  Shopping: { nameLocalized: "\u0E0A\u0E49\u0E2D\u0E1B\u0E1B\u0E34\u0E49\u0E07", icon: "\u{1F6CD}\uFE0F", keywords: ["clothes", "electronics", "online", "lazada", "shopee"] },
  Health: { nameLocalized: "\u0E2A\u0E38\u0E02\u0E20\u0E32\u0E1E", icon: "\u{1F48A}", keywords: ["medicine", "hospital", "clinic", "gym", "pharmacy"] },
  Education: { nameLocalized: "\u0E01\u0E32\u0E23\u0E28\u0E36\u0E01\u0E29\u0E32", icon: "\u{1F4DA}", keywords: ["course", "book", "tutor", "school"] },
  Travel: { nameLocalized: "\u0E17\u0E48\u0E2D\u0E07\u0E40\u0E17\u0E35\u0E48\u0E22\u0E27", icon: "\u2708\uFE0F", keywords: ["hotel", "flight", "tour", "agoda", "booking"] },
  Housing: { nameLocalized: "\u0E17\u0E35\u0E48\u0E2D\u0E22\u0E39\u0E48\u0E2D\u0E32\u0E28\u0E31\u0E22", icon: "\u{1F3E0}", keywords: ["rent", "repair", "furniture"] },
  Personal: { nameLocalized: "\u0E2A\u0E48\u0E27\u0E19\u0E15\u0E31\u0E27", icon: "\u{1F464}", keywords: ["haircut", "salon", "personal"] },
  Gift: { nameLocalized: "\u0E02\u0E2D\u0E07\u0E02\u0E27\u0E31\u0E0D", icon: "\u{1F381}", keywords: ["gift", "present", "donation"] },
  Other: { nameLocalized: "\u0E2D\u0E37\u0E48\u0E19\u0E46", icon: "\u{1F4E6}", keywords: [] }
};
function detectCategory(description) {
  const lower = description.toLowerCase();
  for (const [category, data] of Object.entries(CATEGORIES)) {
    if (data.keywords.some((keyword) => lower.includes(keyword))) {
      return category;
    }
  }
  return "Other";
}
function formatAmount(amount, currency = "THB") {
  const symbols = {
    THB: "\u0E3F",
    USD: "$",
    EUR: "\u20AC",
    JPY: "\xA5",
    AUD: "A$"
  };
  return `${symbols[currency] || currency}${amount.toLocaleString()}`;
}
function getApiContext(input, requestContext) {
  const channel = input.channel || requestContext?.get("channel");
  const senderChannelId = input.senderChannelId || requestContext?.get("senderChannelId");
  const sourceChannelId = input.sourceChannelId || requestContext?.get("sourceChannelId");
  const isGroup = requestContext?.get("isGroup");
  const sourceType = input.sourceType || (isGroup === false ? "DM" : "GROUP");
  if (!channel || !senderChannelId || !sourceChannelId) {
    console.error("[API] Missing context:", { channel, senderChannelId, sourceChannelId });
    return null;
  }
  return { channel, senderChannelId, sourceChannelId, sourceType };
}

export { CATEGORIES, apiRequest, detectCategory, formatAmount, getApiContext };
