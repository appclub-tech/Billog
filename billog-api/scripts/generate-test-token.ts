/**
 * Generate Test JWT Token
 *
 * Usage: pnpm tsx scripts/generate-test-token.ts [userId] [name]
 *
 * Examples:
 *   pnpm tsx scripts/generate-test-token.ts
 *   pnpm tsx scripts/generate-test-token.ts 1 TAWAN
 *   pnpm tsx scripts/generate-test-token.ts 2 "John Doe"
 */

import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config();

const secret = process.env.NEXTAUTH_SECRET || "your-nextauth-secret-change-me";
const userId = parseInt(process.argv[2] || "1", 10);
const name = process.argv[3] || "TAWAN";

const payload = {
  userId,
  name,
  lineUserId: `test-line-user-${userId}`,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + (60 * 60 * 24), // 24 hours
};

const token = jwt.sign(payload, secret);

console.log(`🔐 JWT Token for User ${userId} (${name}):\n`);
console.log(token);
console.log("\n📋 Copy this token:\n");
console.log(`export TOKEN="${token}"`);
console.log("\n📝 Test with curl:\n");
console.log(`curl -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/expenses/recent?limit=5"`);
console.log("\n✅ Token expires in 24 hours");
