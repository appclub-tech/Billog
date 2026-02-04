import { NextRequest, NextResponse } from "next/server";

/**
 * Redirect LINE Login callback to NextAuth handler
 * LINE callback URL: /callback/line/login
 * NextAuth callback URL: /api/auth/callback/line
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");

  // Build the NextAuth callback URL with all query params
  const callbackUrl = new URL("/api/auth/callback/line", request.nextUrl.origin);

  if (code) callbackUrl.searchParams.set("code", code);
  if (state) callbackUrl.searchParams.set("state", state);
  if (error) callbackUrl.searchParams.set("error", error);
  if (errorDescription) callbackUrl.searchParams.set("error_description", errorDescription);

  return NextResponse.redirect(callbackUrl);
}
