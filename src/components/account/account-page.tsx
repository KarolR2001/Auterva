import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";

import type { AuthArea } from "../auth/auth-destination";
import { requireAreaHost } from "../auth/auth-host";
import { renderAccountFrame } from "./account-frame";
import { AccountView } from "./account-view";

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
  return renderAccountFrame(area, actor, here,
    <AccountView area={area} account={{ ...user, role: user.role ?? "" }} />);
}
