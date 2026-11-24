import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getServerEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";
import { listOwnSessions } from "@/modules/auth/sessions";

import type { AuthArea } from "../auth/auth-destination";
import { requireAreaHost } from "../auth/auth-host";
import { renderAccountFrame } from "./account-frame";
import { AccountView, type SessionsSummary } from "./account-view";

/**
 * ADM-15 profile card and tab count: the account's own sessions, read like `GET /api/auth/sessions`. Only the count and
 * the current device leave the server; a failed read just hides them (the sessions tab stays the source of truth).
 */
async function sessionsSummary(actor: { userId: string; sessionId: string; organizationId: string | null }): Promise<SessionsSummary | null> {
  try {
    const sessions = await listOwnSessions(prisma, actor, getServerEnv().BETTER_AUTH_SECRET);
    const current = sessions.find((session) => session.current);
    return { count: sessions.length, current: current ? { device: current.device, createdAt: current.createdAt } : null };
  } catch {
    return null;
  }
}

// Account works for a full session only; an expired service period does not matter here,
// while an archived company or a revoked session has no actor and goes back to login.
export async function AccountPage({ area }: { area: AuthArea }) {
  const { incoming, scope } = await requireAreaHost(area);
  const login = area === "company" ? "/admin/login" : "/login";
  const here = area === "company" ? "/admin/konto" : "/konto";
  const actor = await requireAuthorizedActor(prisma, auth, incoming, scope);
  if (!actor) redirect(`${login}?returnTo=${encodeURIComponent(here)}`);
  const user = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: { name: true, email: true, role: true },
  });
  if (!user) redirect(`${login}?returnTo=${encodeURIComponent(here)}`);
  const sessions = await sessionsSummary(actor);
  return renderAccountFrame(area, actor, here,
    <AccountView area={area} account={{ ...user, role: user.role ?? "" }} sessions={sessions} />);
}
