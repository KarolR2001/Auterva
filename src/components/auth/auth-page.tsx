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

type SearchParams = Promise<{ returnTo?: string | string[] }>;

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
  const value = (await searchParams).returnTo;
  const returnTo = safeReturnTo(
    area,
    typeof value === "string" ? value : undefined,
  );
  const authorized = await requireAuthorizedActor(
    prisma,
    auth,
    incoming,
    scope,
  );
  if (authorized) redirect(returnTo);
  const scoped = await requireScopedActor(prisma, auth, incoming, scope);
  const loginPath = area === "company" ? "/admin/login" : "/login";
  const mfaPath = area === "company" ? "/admin/mfa" : "/mfa";
  if (stage === "login" && scoped && !scoped.twoFactorEnabled)
    redirect(`${mfaPath}?returnTo=${encodeURIComponent(returnTo)}`);
  if (stage === "mfa" && scoped?.twoFactorEnabled) {
    // A verified factor is required for the panel; an unverified scoped session is not enrollment.
    redirect(`${loginPath}?returnTo=${encodeURIComponent(returnTo)}`);
  }
  const companyName = scope.organizationId
    ? ((
        await prisma.organization.findUnique({
          where: { id: scope.organizationId },
          select: { name: true },
        })
      )?.name ?? undefined)
    : undefined;
  if (stage === "login")
    return (
      <LoginForm area={area} companyName={companyName} returnTo={returnTo} />
    );
  return (
    <MfaFlow
      area={area}
      companyName={companyName}
      initialMode={scoped && !scoped.twoFactorEnabled ? "enroll" : "challenge"}
      returnTo={returnTo}
    />
  );
}
