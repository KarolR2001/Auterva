import { observeAuthResponse } from "@/modules/observability/http-observe";
import { toNextJsHandler } from "better-auth/next-js";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { auth, createAuth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { recordVerifiedMfaSession, sessionFromResponse } from "@/lib/mfa-session";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor, requireScopedActor, resolveAuthHost } from "@/modules/auth/authorization";
import { MfaFactorBusyError, withMfaFactorLock } from "@/modules/auth/mfa-factor-lock";
import { completeAuthAttempt, reserveAuthAttempt, takeRateLimit } from "@/modules/auth/rate-limit";
import { trustedClientAddress } from "@/modules/auth/trusted-address";
import { appendAudit } from "@/modules/audit/append";
import { parseHostAuthority } from "@/modules/tenancy/host-registry";
import { currentTrustedClientAddress } from "@/modules/ingress/client-address";
import { apiRateLimitResponse, takeAuthenticatedApiLimit } from "@/modules/tenancy/api-rate-limit";
import { bodyExceeds, MAX_AUTH_BODY_BYTES } from "@/modules/tenancy/json-body";
import { withErrorRequestId } from "@/modules/tenancy/request-id";
import { changeAccountPassword, requestPasswordReset, resetPassword, updateAccountProfile } from "@/modules/auth/account-operations";
import { parseMailPayloadKey } from "@/modules/jobs/config";
import { z } from "zod";

export const runtime = "nodejs";
const allowed = new Set([
  "/api/auth/get-session", "/api/auth/sign-in/email", "/api/auth/two-factor/enable",
  "/api/auth/two-factor/verify-totp", "/api/auth/two-factor/verify-backup-code", "/api/auth/sign-out",
  "/api/auth/mfa/reauth", "/api/auth/mfa/rotate-backup-codes",
  "/api/auth/password/request-reset", "/api/auth/password/reset",
  "/api/auth/password/change", "/api/auth/profile",
]);
const refusal = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
const neutral = () => Response.json({ code: "INVALID_CREDENTIALS" }, { status: 401, headers: { "Cache-Control": "no-store" } });

function sameCanonicalOrigin(raw: string | null, expected: URL): boolean {
  if (!raw) return false;
  try {
    const origin = new URL(raw);
    const suppliedHost = parseHostAuthority(origin.host);
    const expectedHost = parseHostAuthority(expected.host);
    return origin.origin === raw && origin.protocol === expected.protocol
      && suppliedHost?.hostname === expectedHost?.hostname && suppliedHost?.port === expectedHost?.port;
  } catch {
    return false;
  }
}
const busy = () => Response.json({ code: "MFA_BUSY" }, { status: 409, headers: { "Retry-After": "1", "Cache-Control": "no-store" } });
const retryableMfaError = (error: unknown) => error instanceof MfaFactorBusyError
  || (typeof error === "object" && error !== null && "code" in error && ["P2024", "P2028", "P2034"].includes(String(error.code)));
const mfaRetry = () => Response.json({ code: "MFA_RETRY" }, { status: 503, headers: { "Retry-After": "1", "Cache-Control": "no-store" } });
const resetRequestBody = z.object({ email: z.email().max(254), idempotencyKey: z.uuid() }).strict();
const resetBody = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  newPassword: z.string().min(12).max(256) }).strict();
const profileBody = z.object({ name: z.string().trim().min(1).max(100) }).strict();
const passwordChangeBody = z.object({ currentPassword: z.string().min(1).max(256),
  newPassword: z.string().min(12).max(256) }).strict();
const signInBody = z.object({ email: z.email(), password: z.string().max(256) }).strict();
const noStore = { "Cache-Control": "no-store" };
class SignInScopeDenied extends Error {}

async function loginCredentials(request: Request) {
  const body = await request.clone().json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email : "";
  // The gateway supports only email/password. Validate the entire DTO before
  // choosing an account-dependent KDF path; Better Auth checks optional fields
  // earlier than credentials and would otherwise expose an inverse timing gap.
  const parsed = signInBody.safeParse(body);
  return { email, valid: parsed.success };
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

async function matchingMfaAccount(db: PrismaClient | Prisma.TransactionClient, userId: string, scope: NonNullable<Awaited<ReturnType<typeof resolveAuthHost>>>) {
  const user = await db.user.findUnique({ where: { id: userId }, select: {
    id: true, email: true, role: true, organizationId: true, disabledAt: true, emailVerified: true, twoFactorEnabled: true,
    organization: { select: { archivedAt: true } },
  } });
  if (!user || !user.emailVerified || user.disabledAt) return null;
  if (scope.area === "PLATFORM") return user.role === "SUPERADMIN_AUTERVA" && user.organizationId === null ? user : null;
  return user.role === "ADMIN_FIRMY" && user.organizationId === scope.organizationId && !user.organization?.archivedAt ? user : null;
}

async function lockCredentialAccount(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
  const held = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "account" WHERE "userId" = ${userId} AND "providerId" = 'credential' FOR UPDATE`;
  return held.length === 1;
}

async function handleMfaManagement(request: Request, pathname: string, instance: typeof auth, scope: NonNullable<Awaited<ReturnType<typeof resolveAuthHost>>>, sourceIp: string, baseURL: string, auditRequestId: string) {
  const actor = await requireAuthorizedActor(prisma, instance, request.headers, scope);
  if (!actor) return neutral();
  const isReauth = pathname.endsWith("/reauth");
  const email = isReauth ? (await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } })).email : null;
  // The limiter commits independently: a rejected credential must still count,
  // while the factor and its audit/proof remain in one rollback-safe transaction.
  const reservation = email === null ? null : await reserveAuthAttempt(prisma, email, sourceIp);
  if (reservation && !reservation.allowed) return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: {
    "Retry-After": String(reservation.retryAfter), "Cache-Control": "no-store",
  } });
  let response: Response;
  try {
    response = await withMfaFactorLock(prisma, actor.userId, async (tx) => {
      if (!await lockCredentialAccount(tx, actor.userId)) return neutral();
      const txInstance = createAuth(tx, false, baseURL);
      const currentActor = await requireAuthorizedActor(tx, txInstance, request.headers, scope);
      if (currentActor?.sessionId !== actor.sessionId) return neutral();
      const body = await request.clone().json().catch(() => null) as { method?: unknown; code?: unknown; proof?: unknown; password?: unknown } | null;
      if (isReauth) {
        if (!body || (body.method !== "totp" && body.method !== "recovery") || typeof body.code !== "string" || body.code.length > 32) {
          return neutral();
        }
        let valid = false;
        try {
          if (body.method === "totp" && /^\d{6}$/.test(body.code)) {
            await txInstance.api.verifyTOTP({ body: { code: body.code, trustDevice: false }, headers: request.headers });
            valid = true;
          } else if (body.method === "recovery") {
            await txInstance.api.verifyBackupCode({ body: { code: body.code, trustDevice: false }, headers: request.headers });
            valid = true;
          }
        } catch {
          valid = false;
        }
        if (!valid) return neutral();
        if (body.method === "recovery") await appendAudit(tx, {
          actorId: actor.userId, sessionId: actor.sessionId, organizationId: actor.organizationId,
          action: "MFA_RECOVERY_CODE_USED", entityId: actor.userId, eventKey: randomUUID(), requestId: auditRequestId,
        });
        const proof = randomBytes(32).toString("hex");
        await tx.verification.create({ data: {
          id: randomUUID(), identifier: challengeKey(`reauth:${proof}`),
          value: JSON.stringify({ userId: actor.userId, sessionId: actor.sessionId, purpose: "rotate-backup-codes" }),
          expiresAt: new Date(Date.now() + 5 * 60_000),
        } });
        return Response.json({ proof }, { headers: { "Cache-Control": "no-store" } });
      }
      if (!body || typeof body.proof !== "string" || !/^[a-f0-9]{64}$/.test(body.proof)
        || typeof body.password !== "string" || body.password.length > 256) return neutral();
      const identifier = challengeKey(`reauth:${body.proof}`);
      const expectedValue = JSON.stringify({ userId: actor.userId, sessionId: actor.sessionId, purpose: "rotate-backup-codes" });
      const proof = await tx.verification.findFirst({ where: { identifier, value: expectedValue, expiresAt: { gt: new Date() } } });
      const consumed = Boolean(proof);
      if (consumed) await tx.verification.deleteMany({ where: { identifier: { startsWith: "auterva:mfa:" }, value: { contains: `"userId":"${actor.userId}"` } } });
      if (!consumed) return neutral();
      // Existing sessions lose access before any factor material changes. An invalid
      // password can cause an extra logout, but cannot leave stale sessions active.
      const revoked = await tx.session.deleteMany({ where: { userId: actor.userId, id: { not: actor.sessionId } } });
      await appendAudit(tx, {
        actorId: actor.userId, sessionId: actor.sessionId, organizationId: actor.organizationId,
        action: "AUTH_SESSIONS_REVOKED", entityId: actor.userId, eventKey: randomUUID(), requestId: auditRequestId,
        revokedSessions: revoked.count,
      });
      let rotated: Awaited<ReturnType<typeof instance.api.generateBackupCodes>>;
      try {
        rotated = await txInstance.api.generateBackupCodes({ body: { password: body.password }, headers: request.headers });
      } catch {
        return neutral();
      }
      await appendAudit(tx, {
        actorId: actor.userId, sessionId: actor.sessionId, organizationId: actor.organizationId,
        action: "MFA_BACKUP_CODES_ROTATED", entityId: actor.userId, eventKey: randomUUID(), requestId: auditRequestId,
      });
      return Response.json({ status: true, backupCodes: rotated.backupCodes }, { headers: { "Cache-Control": "no-store" } });
    });
  } catch (error) {
    if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, false);
    if (error instanceof MfaFactorBusyError) return busy();
    if (retryableMfaError(error)) return mfaRetry();
    throw error;
  }
  if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, !response.ok);
  return response;
}

async function revokeIssuedSession(instance: typeof auth, response: Response) {
  const issued = response.headers.getSetCookie().map((entry) => entry.split(";", 1)[0]).filter((entry) => entry.split("=", 1)[0].endsWith(".session_token"));
  if (!issued.length) return;
  const session = await instance.api.getSession({ headers: new Headers({ cookie: issued.join("; ") }) });
  if (session) await prisma.session.deleteMany({ where: { id: session.session.id } });
}

async function guarded(request: Request, method: "GET" | "POST", auditRequestId: string) {
  const externalUrl = new URL(request.url);
  const pathname = externalUrl.pathname.replace(/\/$/, "");
  const requestHost = request.headers.get("host");
  const authority = requestHost && parseHostAuthority(requestHost);
  if (authority) {
    externalUrl.hostname = authority.hostname;
    externalUrl.port = authority.port?.toString() ?? "";
  }
  const configuredHost = new URL(getServerEnv().BETTER_AUTH_URL).host;
  const probe = process.env.NODE_ENV === "test" && process.env.AUTERVA_AUTH_PROBE === "1"
    && ["127.0.0.1", "localhost"].includes(new URL(getServerEnv().BETTER_AUTH_URL).hostname)
    && request.headers.get("host") === configuredHost;
  const scope = probe ? null : await resolveAuthHost(prisma, request.headers.get("host"));
  if ((!probe && !scope) || !allowed.has(pathname)) return refusal();
  if (method === "POST" && !sameCanonicalOrigin(request.headers.get("origin"), externalUrl)) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  // The gateway reads its JSON several times (clones); bound it first so no unauthenticated body is parsed unbounded.
  if (method === "POST" && await bodyExceeds(request, MAX_AUTH_BODY_BYTES)) {
    return Response.json({ code: "PAYLOAD_TOO_LARGE" }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }
  if (method === "GET" && pathname !== "/api/auth/get-session") return new Response(null, { status: 405 });
  if (method === "POST" && pathname === "/api/auth/get-session") return new Response(null, { status: 405 });
  let sourceIp: string;
  try {
    sourceIp = trustedClientAddress(currentTrustedClientAddress());
  } catch {
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  const instance = probe ? auth : createAuth(prisma, false, externalUrl.origin);
  if (pathname === "/api/auth/password/request-reset" || pathname === "/api/auth/password/reset") {
    if (!scope || method !== "POST") return refusal();
    const body = await request.clone().json().catch(() => null);
    if (pathname.endsWith("/request-reset")) {
      const parsed = resetRequestBody.safeParse(body);
      if (!parsed.success) return Response.json({ code: "INVALID_REQUEST" }, { status: 400, headers: noStore });
      let mailKey: Buffer;
      try { mailKey = parseMailPayloadKey(process.env.MAIL_PAYLOAD_KEY); }
      catch { return Response.json({ code: "MAIL_NOT_CONFIGURED" }, { status: 503, headers: noStore }); }
      const email = parsed.data.email.trim().toLowerCase();
      const limit = await takeRateLimit(prisma, [
        { key: `reset:account:${email}`, limit: 3, windowMs: 60 * 60_000 },
        { key: `reset:ip:${sourceIp}`, limit: 20, windowMs: 60 * 60_000 },
      ]);
      if (!limit.allowed) return Response.json({ code: "RATE_LIMITED" }, { status: 429,
        headers: { ...noStore, "Retry-After": String(limit.retryAfter) } });
      return Response.json(await requestPasswordReset(prisma, { email,
        idempotencyKey: parsed.data.idempotencyKey, scope, hostname: externalUrl.hostname,
        now: new Date(), mailKey }), { headers: noStore });
    }
    const parsed = resetBody.safeParse(body);
    if (!parsed.success) return Response.json({ code: "INVALID_REQUEST" }, { status: 400, headers: noStore });
    const limit = await takeRateLimit(prisma, [
      { key: `reset:token:${createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET).update(parsed.data.token).digest("hex")}`,
        limit: 3, windowMs: 60 * 60_000 },
      { key: `reset:ip:${sourceIp}`, limit: 20, windowMs: 60 * 60_000 },
    ]);
    if (!limit.allowed) return Response.json({ code: "RATE_LIMITED" }, { status: 429,
      headers: { ...noStore, "Retry-After": String(limit.retryAfter) } });
    const changed = await resetPassword(prisma, { token: parsed.data.token,
      newPassword: parsed.data.newPassword, scope, hostname: externalUrl.hostname,
      now: new Date(), requestId: auditRequestId });
    return changed ? Response.json({ status: true, signInRequired: true }, { headers: noStore }) : neutral();
  }
  if (pathname === "/api/auth/profile" || pathname === "/api/auth/password/change") {
    if (!scope || method !== "POST") return refusal();
    const actor = await requireAuthorizedActor(prisma, instance, request.headers, scope);
    if (!actor) return neutral();
    const limit = await takeAuthenticatedApiLimit(prisma, { actorId: actor.userId,
      organizationId: actor.organizationId }, "write");
    if (!limit.allowed) return apiRateLimitResponse(limit.retryAfter);
    const body = await request.clone().json().catch(() => null);
    if (pathname === "/api/auth/profile") {
      const parsed = profileBody.safeParse(body);
      if (!parsed.success) return Response.json({ code: "INVALID_REQUEST" }, { status: 400, headers: noStore });
      const result = await updateAccountProfile(prisma, { headers: request.headers, scope,
        baseURL: externalUrl.origin, name: parsed.data.name, requestId: auditRequestId });
      return result ? Response.json(result, { headers: noStore }) : neutral();
    }
    const parsed = passwordChangeBody.safeParse(body);
    if (!parsed.success) return Response.json({ code: "INVALID_REQUEST" }, { status: 400, headers: noStore });
    const account = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { email: true } });
    const reservation = await reserveAuthAttempt(prisma, account.email, sourceIp);
    if (!reservation.allowed) return Response.json({ code: "RATE_LIMITED" }, { status: 429,
      headers: { ...noStore, "Retry-After": String(reservation.retryAfter) } });
    let changed: boolean;
    try {
      changed = await changeAccountPassword(prisma, { headers: request.headers, scope,
        baseURL: externalUrl.origin, currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword, requestId: auditRequestId });
    } catch (error) {
      await completeAuthAttempt(prisma, reservation.reservationId, !retryableMfaError(error));
      throw error;
    }
    await completeAuthAttempt(prisma, reservation.reservationId, !changed);
    return changed ? Response.json({ status: true, signInRequired: true }, { headers: noStore }) : neutral();
  }
  if (scope && pathname !== "/api/auth/sign-in/email") {
    const scoped = await requireScopedActor(prisma, instance, request.headers, scope);
    if (scoped) {
      const limit = await takeAuthenticatedApiLimit(prisma, {
        actorId: scoped.userId, organizationId: scoped.organizationId,
      }, pathname === "/api/auth/get-session" ? "read" : "write");
      if (!limit.allowed) return apiRateLimitResponse(limit.retryAfter);
    }
  }
  const handlers = toNextJsHandler(instance);
  if (pathname.startsWith("/api/auth/mfa/")) {
    if (!scope || method !== "POST") return refusal();
    return handleMfaManagement(request, pathname, instance, scope, sourceIp, externalUrl.origin, auditRequestId);
  }
  const enrollmentActor = pathname === "/api/auth/two-factor/verify-totp" && scope
    ? await requireScopedActor(prisma, instance, request.headers, scope) : null;
  const enableActor = pathname === "/api/auth/two-factor/enable" && scope
    ? await requireScopedActor(prisma, instance, request.headers, scope) : null;
  if (pathname === "/api/auth/two-factor/verify-totp" && enrollmentActor
    && await requireAuthorizedActor(prisma, instance, request.headers, scope!)) return neutral();
  if (pathname === "/api/auth/two-factor/enable" && scope && !enableActor) return neutral();
  let invalidEnable = false;
  if (pathname === "/api/auth/two-factor/enable") {
    const body = await request.clone().json().catch(() => null) as { method?: unknown; password?: unknown } | null;
    invalidEnable = !body || body.method !== "totp" || typeof body.password !== "string";
  }
  const mfaPath = pathname === "/api/auth/two-factor/verify-totp" || pathname === "/api/auth/two-factor/verify-backup-code";
  let invalidMfa = false;
  if (mfaPath) {
    const body = await request.clone().json().catch(() => null) as { code?: unknown; trustDevice?: unknown; disableSession?: unknown } | null;
    invalidMfa = !body || typeof body.code !== "string" || (pathname.endsWith("verify-totp") && !/^\d{6}$/.test(body.code))
      || body.trustDevice === true || body.disableSession === true;
  }
  const rawChallenge = mfaPath && !enrollmentActor ? challengeCookie(request.headers.get("cookie")) : null;
  const challenge = rawChallenge ? await prisma.verification.findFirst({ where: { identifier: challengeKey(rawChallenge), expiresAt: { gt: new Date() } } }) : null;
  const challengeData = challenge ? JSON.parse(challenge.value) as { userId: string; hostname: string } : null;
  const challengeUser = scope && challengeData?.hostname === externalUrl.hostname
    ? await matchingMfaAccount(prisma, challengeData.userId, scope) : null;
  if (mfaPath && scope && !enrollmentActor && !challengeUser) {
    const ipLimit = await takeRateLimit(prisma, [{ key: `auth:ip:${sourceIp}`, limit: 20, windowMs: 15 * 60_000 }]);
    if (!ipLimit.allowed) return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Retry-After": String(ipLimit.retryAfter), "Cache-Control": "no-store" } });
    return neutral();
  }
  // Next redirects to trailing-slash URLs for the PWA scope; Better Auth matches paths without it.
  const normalized = new URL(externalUrl);
  normalized.pathname = pathname;
  const authRequest = () => {
    const forwarded = new Request(normalized, request);
    if (method === "POST") forwarded.headers.set("origin", externalUrl.origin);
    return forwarded;
  };
  const credentials = pathname === "/api/auth/sign-in/email" ? await loginCredentials(request) : null;
  const email = credentials?.email ?? null;
  const scopedUser = enrollmentActor ?? enableActor;
  const mfaEmail = challengeUser?.email ?? (scopedUser ? (await prisma.user.findUnique({ where: { id: scopedUser.userId }, select: { email: true } }))?.email : null);
  const reservation = email === null && !mfaEmail ? null : await reserveAuthAttempt(prisma, email ?? mfaEmail ?? "", sourceIp);
  if (reservation && !reservation.allowed) {
    return Response.json({ code: "RATE_LIMITED" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(reservation.retryAfter) } });
  }
  if (invalidEnable || invalidMfa || (credentials && !credentials.valid)) {
    if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, true);
    return invalidMfa
      ? Response.json({ code: "INVALID_MFA_PROBE" }, { status: 400, headers: { "Cache-Control": "no-store" } })
      : neutral();
  }
  let response: Response;
  try {
    if (pathname === "/api/auth/two-factor/enable" && enableActor) {
      response = await withMfaFactorLock(prisma, enableActor.userId, async (tx) => {
        if (!await lockCredentialAccount(tx, enableActor.userId)) return neutral();
        const txInstance = createAuth(tx, false, externalUrl.origin);
        const current = await requireScopedActor(tx, txInstance, request.headers, scope!);
        if (current?.sessionId !== enableActor.sessionId || current.twoFactorEnabled) return neutral();
        const factor = await tx.twoFactor.findFirst({ where: { userId: enableActor.userId }, select: { verified: true } });
        if (factor?.verified) return neutral();
        return toNextJsHandler(txInstance)[method](authRequest());
      });
    } else if (pathname === "/api/auth/two-factor/verify-backup-code" && challengeUser) {
      response = await withMfaFactorLock(prisma, challengeUser.id, async (tx) => {
        if (!await lockCredentialAccount(tx, challengeUser.id)) return neutral();
        const txInstance = createAuth(tx, false, externalUrl.origin);
        const current = await tx.user.findUnique({ where: { id: challengeUser.id }, select: { twoFactorEnabled: true } });
        const activeChallenge = challenge && await tx.verification.findFirst({ where: { id: challenge.id, expiresAt: { gt: new Date() } } });
        if (!current?.twoFactorEnabled || !activeChallenge) return neutral();
        const verified = await toNextJsHandler(txInstance)[method](authRequest());
        if (!verified.ok) return verified;
        const session = await sessionFromResponse(txInstance, request, verified);
        if (!session || session.user.id !== challengeUser.id) throw new Error("Recovery session mismatch");
        await recordVerifiedMfaSession(tx, txInstance, request, verified);
        const revoked = await tx.session.deleteMany({ where: { userId: challengeUser.id, id: { not: session.session.id } } });
        await appendAudit(tx, {
          actorId: challengeUser.id, sessionId: session.session.id, organizationId: challengeUser.organizationId,
          action: "MFA_RECOVERY_STARTED", entityId: challengeUser.id, eventKey: randomUUID(), requestId: auditRequestId,
          revokedSessions: revoked.count,
        });
        await tx.twoFactor.deleteMany({ where: { userId: challengeUser.id } });
        await tx.user.update({ where: { id: challengeUser.id }, data: { twoFactorEnabled: false } });
        await tx.verification.deleteMany({ where: { identifier: { startsWith: "auterva:mfa:" }, value: { contains: `"userId":"${challengeUser.id}"` } } });
        return Response.json({ enrollmentRequired: true }, { status: verified.status, headers: verified.headers });
      });
    } else if (pathname === "/api/auth/two-factor/verify-totp" && (challengeUser || enrollmentActor)) {
      response = await withMfaFactorLock(prisma, challengeUser?.id ?? enrollmentActor!.userId, async (tx) => {
        if (!await lockCredentialAccount(tx, challengeUser?.id ?? enrollmentActor!.userId)) return neutral();
        const txInstance = createAuth(tx, false, externalUrl.origin);
        if (challengeUser) {
          const current = await tx.user.findUnique({ where: { id: challengeUser.id }, select: { twoFactorEnabled: true } });
          const activeChallenge = challenge && await tx.verification.findFirst({ where: { id: challenge.id, expiresAt: { gt: new Date() } } });
          if (!current?.twoFactorEnabled || !activeChallenge || !await matchingMfaAccount(tx, challengeUser.id, scope!)) return neutral();
        }
        if (enrollmentActor) {
          const current = await requireScopedActor(tx, txInstance, request.headers, scope!);
          if (current?.sessionId !== enrollmentActor.sessionId || current.twoFactorEnabled !== enrollmentActor.twoFactorEnabled) return neutral();
          const proof = await tx.session.findUnique({ where: { id: enrollmentActor.sessionId }, select: { mfaVerifiedAt: true } });
          if (current.twoFactorEnabled && proof?.mfaVerifiedAt) return neutral();
        }
        const verified = await toNextJsHandler(txInstance)[method](authRequest());
        await recordVerifiedMfaSession(tx, txInstance, request, verified);
        if (verified.ok) {
          const fullSession = await sessionFromResponse(txInstance, request, verified);
          if (!fullSession) throw new Error("Verified login has no session");
          await appendAudit(tx, {
            actorId: fullSession.user.id, sessionId: fullSession.session.id,
            organizationId: scope!.organizationId, action: "AUTH_LOGIN_COMPLETED",
            entityId: fullSession.user.id, eventKey: randomUUID(), requestId: auditRequestId,
          });
        }
        if (verified.ok && challenge) await tx.verification.deleteMany({ where: { id: challenge.id } });
        if (verified.ok && enrollmentActor && !enrollmentActor.twoFactorEnabled) {
          const codes = await txInstance.api.viewBackupCodes({ body: { userId: enrollmentActor.userId } });
          return Response.json({ status: true, backupCodes: codes.backupCodes }, { status: verified.status, headers: verified.headers });
        }
        return verified.ok ? Response.json({ status: true }, { status: verified.status, headers: verified.headers }) : verified;
      });
    } else if (pathname === "/api/auth/sign-out" && scope) {
      const exiting = await requireAuthorizedActor(prisma, instance, request.headers, scope);
      if (!exiting) {
        response = await handlers[method](authRequest());
      } else {
        response = await prisma.$transaction(async (tx) => {
          const txInstance = createAuth(tx, false, externalUrl.origin);
          // Serialize two logout requests for the same session before writing either audit row.
          const held = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "session" WHERE id = ${exiting.sessionId} FOR UPDATE`;
          if (!held.length) return neutral();
          const current = await requireAuthorizedActor(tx, txInstance, request.headers, scope);
          if (current?.sessionId !== exiting.sessionId) return neutral();
          await appendAudit(tx, {
            actorId: exiting.userId, sessionId: exiting.sessionId, organizationId: exiting.organizationId,
            action: "AUTH_LOGOUT", entityId: exiting.userId, eventKey: randomUUID(), requestId: auditRequestId,
          });
          const signedOut = await toNextJsHandler(txInstance)[method](authRequest());
          if (!signedOut.ok) throw new Error("Sign-out failed after audit");
          return signedOut;
        });
      }
    } else if (pathname === "/api/auth/sign-in/email" && scope && email) {
      response = await prisma.$transaction(async (tx) => {
        const candidate = await tx.user.findFirst({ where: {
          email: { equals: email.trim(), mode: "insensitive" },
        }, select: { id: true } });
        const account = candidate && await tx.account.findFirst({ where: {
          userId: candidate.id, providerId: "credential",
        }, select: { id: true } });
        // Password changes hold this same account row until all old sessions
        // are revoked. A login cannot commit an old-password session later.
        const held = account ? await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM "account" WHERE id = ${account.id} FOR UPDATE` : [];
        const permitted = candidate && held.length ? await matchingMfaAccount(tx, candidate.id, scope) : null;
        // Every account state traverses the same Better Auth transport, Origin,
        // CSRF, schema and credential pipeline. If a credential appears between
        // our lookup and BA's read, its success still rolls back without a cookie.
        const signedIn = await toNextJsHandler(createAuth(tx, false, externalUrl.origin))[method](authRequest());
        if (!permitted) throw new SignInScopeDenied();
        if (signedIn.ok) {
          const result = await signedIn.clone().json().catch(() => null) as { twoFactorRedirect?: boolean } | null;
          if (permitted.twoFactorEnabled && !result?.twoFactorRedirect) throw new SignInScopeDenied();
          if (result?.twoFactorRedirect) {
            const issued = challengeCookie(signedIn.headers.getSetCookie().map((item) => item.split(";", 1)[0]).join("; "));
            if (!permitted.twoFactorEnabled) throw new SignInScopeDenied();
            if (!issued) throw new Error("Invalid MFA challenge at login");
            await tx.verification.create({ data: {
              id: randomUUID(), identifier: challengeKey(issued),
              value: JSON.stringify({ userId: permitted.id, hostname: externalUrl.hostname }),
              expiresAt: new Date(Date.now() + 10 * 60_000),
            } });
          }
        }
        return signedIn;
      }, { maxWait: 5_000, timeout: 20_000 });
    } else {
      response = await handlers[method](authRequest());
    }
  } catch (error) {
    if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, !retryableMfaError(error));
    if (error instanceof SignInScopeDenied) return neutral();
    if (error instanceof MfaFactorBusyError) return busy();
    if (retryableMfaError(error)) return mfaRetry();
    throw error;
  }
  if (probe && pathname === "/api/auth/two-factor/verify-totp") {
    await recordVerifiedMfaSession(prisma, instance, request, response);
    if (response.ok) response = Response.json({ status: true }, { status: response.status, headers: response.headers });
  }
  if (email !== null) {
    if (!response.ok) {
      if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, true);
      return neutral();
    }
    if (scope) {
      const user = await prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: "insensitive" } }, select: { id: true, role: true, organizationId: true, disabledAt: true, emailVerified: true, twoFactorEnabled: true, organization: { select: { archivedAt: true } } } });
      const expectedRole = scope.area === "PLATFORM" ? "SUPERADMIN_AUTERVA" : "ADMIN_FIRMY";
      if (!user || user.role !== expectedRole || user.organizationId !== scope.organizationId || !user.emailVerified || user.disabledAt || user.organization?.archivedAt) {
        await revokeIssuedSession(instance, response);
        if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, true);
        return neutral();
      }
      const result = await response.clone().json().catch(() => null) as { twoFactorRedirect?: boolean } | null;
      if (user.twoFactorEnabled && !result?.twoFactorRedirect) {
        await revokeIssuedSession(instance, response);
        if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, true);
        return neutral();
      }
    }
    if (reservation?.allowed) await completeAuthAttempt(prisma, reservation.reservationId, false);
  }
  if (email !== null && response.ok) {
    const result = await response.clone().json().catch(() => null) as { twoFactorRedirect?: boolean } | null;
    response = Response.json(result?.twoFactorRedirect ? { twoFactorRedirect: true } : { enrollmentRequired: true },
      { status: response.status, headers: response.headers });
  }
  if ((mfaPath || pathname === "/api/auth/two-factor/enable") && reservation?.allowed) {
    await completeAuthAttempt(prisma, reservation.reservationId, !response.ok);
  }
  if (pathname === "/api/auth/two-factor/enable" && !response.ok) return neutral();
  if (pathname === "/api/auth/two-factor/enable" && response.ok) {
    const body = await response.json() as { method?: string; totpURI?: string };
    response = Response.json({ method: body.method, totpURI: body.totpURI }, { status: response.status, headers: response.headers });
  }
  if (pathname === "/api/auth/get-session" && scope) {
    const actor = await requireAuthorizedActor(prisma, instance, request.headers, scope);
    if (!actor) return neutral();
    const [user, session] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, email: true } }),
      prisma.session.findUniqueOrThrow({ where: { id: actor.sessionId }, select: { expiresAt: true } }),
    ]);
    response = Response.json({
      session: { id: actor.sessionId, expiresAt: session.expiresAt },
      user: { id: actor.userId, name: user.name, email: user.email, role: actor.role, organizationId: actor.organizationId },
    }, { status: response.status, headers: response.headers });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export const GET = async (request: Request) => {
  const requestId = randomUUID();
  return withErrorRequestId(await guarded(request, "GET", requestId), requestId);
};
export const POST = async (request: Request) => {
  const requestId = randomUUID();
  return observeAuthResponse(request, withErrorRequestId(await guarded(request, "POST", requestId), requestId));
};
