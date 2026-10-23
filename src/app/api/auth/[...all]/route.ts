import { toNextJsHandler } from "better-auth/next-js";
import { createHmac, randomUUID } from "node:crypto";
import { auth, createAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { recordVerifiedMfaSession } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor, requireScopedActor, resolveAuthHost } from "@/modules/auth/authorization";
import { completeAuthAttempt, reserveAuthAttempt, takeRateLimit } from "@/modules/auth/rate-limit";
import { trustedClientAddress } from "@/modules/auth/trusted-address";

export const runtime = "nodejs";
const allowed = new Set([
  "/api/auth/get-session", "/api/auth/sign-in/email", "/api/auth/two-factor/enable",
  "/api/auth/two-factor/verify-totp", "/api/auth/two-factor/verify-backup-code", "/api/auth/sign-out",
]);
const refusal = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
const neutral = () => Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401, headers: { "Cache-Control": "no-store" } });

async function loginEmail(request: Request) {
  const body = await request.clone().json().catch(() => null) as { email?: unknown } | null;
  return typeof body?.email === "string" ? body.email : "";
}

function challengeCookie(header: string | null) {
  for (const part of (header ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name?.endsWith(".two_factor") && value.length) return value.join("=");
  }
  return null;
}

function challengeKey(cookie: string) {
  return `auterva:mfa:${createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(cookie).digest("hex")}`;
}

async function matchingMfaAccount(userId: string, scope: NonNullable<Awaited<ReturnType<typeof resolveAuthHost>>>) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: {
    id: true, email: true, role: true, organizationId: true, disabledAt: true, emailVerified: true,
    organization: { select: { archivedAt: true } },
  } });
  if (!user || !user.emailVerified || user.disabledAt) return null;
  if (scope.area === "PLATFORM") return user.role === "SUPERADMIN_AUTERVA" && user.organizationId === null ? user : null;
  return user.role === "ADMIN_FIRMY" && user.organizationId === scope.organizationId && !user.organization?.archivedAt ? user : null;
}

async function revokeIssuedSession(instance: typeof auth, response: Response) {
  const issued = response.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).filter((entry) => entry.split("=", 1)[0].endsWith(".session_token"));
  if (!issued.length) return;
  const session = await instance.api.getSession({ headers: new Headers({ cookie: issued.join("; ") }) });
  if (session) await prisma.session.deleteMany({ where: { id: session.session.id } });
}

async function guarded(request: Request, method: "GET" | "POST") {
  const pathname = new URL(request.url).pathname.replace(/\/$/, "");
  const configuredHost = new URL(getServerEnv().BETTER_AUTH_URL).host;
  const probe = process.env.NODE_ENV !== "production" && process.env.AUTERVA_AUTH_PROBE === "1" && request.headers.get("host") === configuredHost;
  const scope = probe ? null : await resolveAuthHost(prisma, request.headers.get("host"), request.url);
  if ((!probe && !scope) || !allowed.has(pathname)) return refusal();
  if (method === "GET" && pathname !== "/api/auth/get-session") return new Response(null, { status: 405 });
  if (method === "POST" && pathname === "/api/auth/get-session") return new Response(null, { status: 405 });
  let sourceIp: string;
  try {
    // #13 replaces the absent transport adapter with a verified ingress address.
    sourceIp = trustedClientAddress(undefined);
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const instance = probe ? auth : createAuth(prisma, false, new URL(request.url).origin);
  const handlers = toNextJsHandler(instance);
  const enrollmentActor = pathname === "/api/auth/two-factor/verify-totp" && scope
    ? await requireScopedActor(prisma, instance, request.headers, scope) : null;
  if (pathname === "/api/auth/two-factor/enable" && scope && !(await requireScopedActor(prisma, instance, request.headers, scope))) return neutral();
  const mfaPath = pathname === "/api/auth/two-factor/verify-totp" || pathname === "/api/auth/two-factor/verify-backup-code";
  if (mfaPath) {
    const body = await request.clone().json().catch(() => null) as { code?: unknown; trustDevice?: unknown; disableSession?: unknown } | null;
    if (!body || typeof body.code !== "string" || (pathname.endsWith("verify-totp") && !/^\d{6}$/.test(body.code))
      || body.trustDevice === true || body.disableSession === true) {
      return Response.json({ code: "INVALID_MFA_PROBE" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  const rawChallenge = mfaPath && !enrollmentActor ? challengeCookie(request.headers.get("cookie")) : null;
  const challenge = rawChallenge ? await prisma.verification.findFirst({ where: { identifier: challengeKey(rawChallenge), expiresAt: { gt: new Date() } } }) : null;
  const challengeData = challenge ? JSON.parse(challenge.value) as { userId: string; hostname: string } : null;
  const challengeUser = scope && challengeData?.hostname === new URL(request.url).hostname
    ? await matchingMfaAccount(challengeData.userId, scope) : null;
  if (mfaPath && scope && !enrollmentActor && !challengeUser) {
    const ipLimit = await takeRateLimit(prisma, [{ key: `auth:ip:${sourceIp}`, limit: 20, windowMs: 15 * 60_000 }]);
    if (!ipLimit.allowed) return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter), "Cache-Control": "no-store" } });
    return neutral();
  }
  // Next redirects to trailing-slash URLs for the PWA scope; Better Auth matches paths without it.
  const normalized = new URL(request.url);
  normalized.pathname = pathname;
  const email = pathname === "/api/auth/sign-in/email" ? await loginEmail(request) : null;
  const mfaEmail = challengeUser?.email ?? (enrollmentActor ? (await prisma.user.findUnique({ where: { id: enrollmentActor.userId }, select: { email: true } }))?.email : null);
  const reservation = email === null && !mfaEmail ? null : await reserveAuthAttempt(prisma, email ?? mfaEmail ?? "", sourceIp);
  if (reservation && !reservation.allowed) {
    return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(reservation.retryAfter) } });
  }
  let response: Response;
  try {
    response = await handlers[method](new Request(normalized, request));
  } catch (error) {
    if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, true);
    throw error;
  }
  if (email !== null) {
    if (!response.ok) {
      if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, true);
      return neutral();
    }
    if (scope) {
      const user = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } }, select: { id: true, role: true, organizationId: true, disabledAt: true, organization: { select: { archivedAt: true } } } });
      const expectedRole = scope.area === "PLATFORM" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY";
      if (!user || user.role !== expectedRole || user.organizationId !== scope.organizationId || user.disabledAt || user.organization?.archivedAt) {
        await revokeIssuedSession(instance, response);
        if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, true);
        return neutral();
      }
      const result = await response.clone().json().catch(() => null) as { twoFactorRedirect?: boolean } | null;
      if (result?.twoFactorRedirect) {
        const issued = challengeCookie(response.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; "));
        if (!issued) throw new Error("MFA challenge cookie missing");
        await prisma.verification.create({ data: {
          id: randomUUID(), identifier: challengeKey(issued), value: JSON.stringify({ userId: user.id, hostname: new URL(request.url).hostname }),
          expiresAt: new Date(Date.now() + 10 * 60_000),
        } });
      }
    }
    if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, false);
  }
  if (mfaPath && reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, !response.ok);
  if (pathname === "/api/auth/two-factor/enable" && response.ok) {
    const body = await response.json() as { method?: string; totpURI?: string };
    response = Response.json({ method: body.method, totpURI: body.totpURI }, { status: response.status, headers: response.headers });
  }
  if (mfaPath) {
    await recordVerifiedMfaSession(prisma, instance, request, response);
    if (response.ok && challenge) await prisma.verification.deleteMany({ where: { id: challenge.id } });
    if (response.ok && pathname.endsWith("verify-totp") && enrollmentActor && !enrollmentActor.twoFactorEnabled) {
      const codes = await instance.api.viewBackupCodes({ body: { userId: enrollmentActor.userId } });
      response = Response.json({ status: true, backupCodes: codes.backupCodes }, { status: response.status, headers: response.headers });
    } else if (response.ok) {
      response = Response.json({ status: true }, { status: response.status, headers: response.headers });
    }
  }
  if (pathname === "/api/auth/get-session" && scope && !(await requireAuthorizedActor(prisma, instance, request.headers, scope))) return neutral();
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = (request: Request) => guarded(request, "GET");
export const POST = (request: Request) => guarded(request, "POST");
