import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  requireAuthorizedActor,
  requireScopedActor,
  resolveAuthHost,
} from "@/modules/auth/authorization";

import { safeReturnTo, type AuthArea } from "./auth-destination";
import { LoginForm, MfaFlow } from "./auth-flow";

type SearchParams = Promise<{
  returnTo?: string | string[];
  recoverCodes?: string | string[];
  session?: string | string[];
}>;

// Better Auth keeps a pending MFA challenge in a short-lived `*.two_factor` cookie.
// Its absence only routes the user to the login screen; every MFA call is still decided by the API.
function hasPendingChallenge(cookieHeader: string | null): boolean {
  return (cookieHeader ?? "").split(";").some((part) => {
    const [name, ...value] = part.trim().split("=");
    return Boolean(name?.endsWith(".two_factor") && value.join("="));
  });
}

export async function AuthPage({
  area,
  stage,
  searchParams,
}: {
  area: AuthArea;
  stage: "login" | "mfa";
  searchParams: SearchParams;
}) {
  const incoming = new Headers(await headers());
  const scope = await resolveAuthHost(prisma, incoming.get("host"));
  if (
    !scope ||
    (area === "company"
      ? scope.area !== "COMPANY_ADMIN" || !scope.organizationId
      : scope.area !== "PLATFORM" || scope.organizationId !== null)
  )
    notFound();
  const params = await searchParams;
  const recoverCodes = params.recoverCodes === "1";
  const loginPath = area === "company" ? "/admin/login" : "/login";
  const mfaPath = area === "company" ? "/admin/mfa" : "/mfa";
  const value = params.returnTo;
  const returnTo = safeReturnTo(
    area,
    typeof value === "string" ? value : undefined,
  );
  const companyName = scope.organizationId
    ? ((
        await prisma.organization.findUnique({
          where: { id: scope.organizationId },
          select: { name: true },
        })
      )?.name ?? undefined)
    : undefined;
  const authorized = await requireAuthorizedActor(
    prisma,
    auth,
    incoming,
    scope,
  );
  if (authorized) {
    if (stage === "mfa" && recoverCodes)
      return (
        <MfaFlow
          area={area}
          companyName={companyName}
          initialMode="restore"
          returnTo={returnTo}
          recoverCodes
        />
      );
    if (recoverCodes)
      redirect(
        `${mfaPath}?returnTo=${encodeURIComponent(returnTo)}&recoverCodes=1`,
      );
    redirect(returnTo);
  }
  const scoped = await requireScopedActor(prisma, auth, incoming, scope);
  if (stage === "login" && scoped && !scoped.twoFactorEnabled)
    redirect(
      `${mfaPath}?returnTo=${encodeURIComponent(returnTo)}${recoverCodes ? "&recoverCodes=1" : ""}`,
    );
  if (stage === "mfa" && scoped?.twoFactorEnabled) {
    // A verified factor is required for the panel; an unverified scoped session is not enrollment.
    redirect(
      `${loginPath}?returnTo=${encodeURIComponent(returnTo)}${recoverCodes ? "&recoverCodes=1" : ""}`,
    );
  }
  if (stage === "mfa" && !scoped && !hasPendingChallenge(incoming.get("cookie")))
    // Neither a limited session nor a pending challenge: the sign-in attempt expired or was revoked.
    redirect(
      `${loginPath}?returnTo=${encodeURIComponent(returnTo)}&session=expired${recoverCodes ? "&recoverCodes=1" : ""}`,
    );
  if (stage === "login")
    return (
      <LoginForm
        area={area}
        companyName={companyName}
        returnTo={returnTo}
        recoverCodes={recoverCodes}
        sessionExpired={params.session === "expired"}
      />
    );
  return (
    <MfaFlow
      area={area}
      companyName={companyName}
      initialMode={scoped && !scoped.twoFactorEnabled ? "enroll" : "challenge"}
      returnTo={returnTo}
      recoverCodes={recoverCodes}
    />
  );
}
