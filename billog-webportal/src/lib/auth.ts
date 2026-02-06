/**
 * NextAuth configuration with LINE Login provider
 */

import type { NextAuthOptions } from "next-auth";

// API base URL for server-side calls (use internal Docker network URL)
const API_BASE = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export const authOptions: NextAuthOptions = {
  providers: [
    {
      id: "line",
      name: "LINE",
      type: "oauth",
      authorization: {
        url: "https://access.line.me/oauth2/v2.1/authorize",
        params: {
          scope: "profile",  // Removed openid to avoid HS256 vs RS256 JWT issue
          response_type: "code",
        },
      },
      token: "https://api.line.me/oauth2/v2.1/token",
      // Skip ID token validation since LINE uses HS256 which NextAuth doesn't support by default
      idToken: false,
      userinfo: "https://api.line.me/v2/profile",
      clientId: process.env.LINE_LOGIN_CHANNEL_ID,
      clientSecret: process.env.LINE_LOGIN_CHANNEL_SECRET,
      profile(profile) {
        return {
          id: profile.userId,
          name: profile.displayName,
          image: profile.pictureUrl,
        };
      },
    },
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      // On initial sign in, register/lookup user in backend
      if (user && account) {
        // Generic channel user ID (works for LINE, WhatsApp, etc.)
        token.channelUserId = user.id;
        token.channel = account.provider; // 'line', 'whatsapp', etc.
        token.name = user.name;
        token.picture = user.image;

        // Call backend to register/lookup internal user
        // Note: We only store userId in session, not sourceId
        // Users may have multiple sources (LINE DM, WhatsApp DM, groups)
        // which can be fetched dynamically via /api/users/:userId/sources
        // Future: phone number can be used to link identities across channels
        try {
          const res = await fetch(`${API_BASE}/api/auth/${account.provider}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              channelUserId: user.id,
              displayName: user.name,
              channel: account.provider,
            }),
          });

          if (res.ok) {
            const data = await res.json();
            token.userId = data.user?.id;
            console.log(`[Auth] Registered user: userId=${data.user?.id}, channel=${account.provider}`);
          }
        } catch (error) {
          console.error("[Auth] Failed to register user with backend:", error);
        }
      }

      return token;
    },
    async session({ session, token }) {
      // Pass user info to session
      // Note: Only userId is stored - sources are fetched dynamically
      if (session.user) {
        const user = session.user as {
          userId?: number;
          channelUserId?: string;
          channel?: string;
        };
        user.userId = token.userId as number;
        user.channelUserId = token.channelUserId as string;
        user.channel = token.channel as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
