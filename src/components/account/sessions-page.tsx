import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireAuthorizedActor } from "@/modules/auth/authorization";

import type { AuthArea } from "../auth/auth-destination";
import { requireAreaHost } from "../auth/auth-host";
import { SessionsView } from "./sessions-view";

// Only the account's own full session sees this screen; the list itself is read from the API (#72).
export async function SessionsPage({ area }: { area: AuthArea }) {
  const { incoming, scope } = await requireAreaHost(area);
  const login = area === "company" ? "/admin/login" : "/login";
  const here = area === "company" ? "/admin/konto/sesje" : "/konto/sesje";
  const actor = await requireAuthorizedActor(prisma, auth, incoming, scope);
  if (!actor) redirect(`${login}?returnTo=${encodeURIComponent(here)}`);
  return <SessionsView area={area} />;
}
