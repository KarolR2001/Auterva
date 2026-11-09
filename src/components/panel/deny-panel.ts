import { notFound, redirect } from "next/navigation";

import type { auth } from "@/lib/auth";
import type { prisma } from "@/lib/prisma";
import { requireScopedActor } from "@/modules/auth/authorization";

type Scope = Parameters<typeof requireScopedActor>[3];

// Called only on a host that is already known to be the panel area, after authorization failed.
// A request with no valid session (PWA cold start, expired cookie) goes to the login of the same host;
// no private HTML or RSC payload is rendered.
// The actor's own limited session (password given, MFA not yet enrolled) goes on to MFA enrolment of the same host
// (#14: panel -> login -> full MFA -> back); it carries no panel data and reveals nothing the actor does not own.
// Any other valid but unauthorized session (foreign role/company, unverified existing factor) stays a neutral 404.
export async function denyPanel(
  db: typeof prisma,
  instance: typeof auth,
  headers: Headers,
  scope: Scope,
): Promise<never> {
  const company = scope.area === "COMPANY_ADMIN";
  const session = await instance.api.getSession({ headers });
  if (session) {
    const actor = await requireScopedActor(db, instance, headers, scope);
    if (actor && !actor.twoFactorEnabled)
      redirect(company ? "/admin/mfa?returnTo=%2Fadmin" : "/mfa?returnTo=%2F");
    notFound();
  }
  redirect(company ? "/admin/login?returnTo=%2Fadmin" : "/login");
}
