import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { recordVerifiedMfaSession } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
const handlers = toNextJsHandler(auth);
const allowed = new Set(["/api/auth/get-session", "/api/auth/sign-in/email", "/api/auth/two-factor/verify-totp", "/api/auth/sign-out"]);

async function guarded(request: Request, method: "GET" | "POST") {
  const pathname = new URL(request.url).pathname.replace(/\/$/, "");
  const configuredHost = new URL(getServerEnv().BETTER_AUTH_URL).host;
  if (process.env.AUTERVA_AUTH_PROBE !== "1" || request.headers.get("host") !== configuredHost || !allowed.has(pathname)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  if (method === "GET" && pathname !== "/api/auth/get-session") return new Response(null, { status: 405 });
  if (method === "POST" && pathname === "/api/auth/get-session") return new Response(null, { status: 405 });
  if (pathname === "/api/auth/two-factor/verify-totp") {
    const body = await request.clone().json().catch(() => null) as { code?: unknown; trustDevice?: unknown } | null;
    if (!body || typeof body.code !== "string" || !/^\d{6}$/.test(body.code) || body.trustDevice === true) {
      return Response.json({ code: "INVALID_MFA_PROBE" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  // Next redirects to trailing-slash URLs for the PWA scope; Better Auth matches paths without it.
  const normalized = new URL(request.url);
  normalized.pathname = pathname;
  const response = await handlers[method](new Request(normalized, request));
  if (pathname === "/api/auth/two-factor/verify-totp") {
    await recordVerifiedMfaSession(prisma, auth, request, response);
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = (request: Request) => guarded(request, "GET");
export const POST = (request: Request) => guarded(request, "POST");
