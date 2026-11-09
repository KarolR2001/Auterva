import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ActivationFlow } from "@/components/auth/activation-flow";
import { prisma } from "@/lib/prisma";
import { resolveAuthHost } from "@/modules/auth/authorization";

export const dynamic = "force-dynamic";
// The token is part of the path: never leak it through the Referer header.
export const metadata: Metadata = { title: "Aktywacja konta", referrer: "no-referrer", robots: { index: false, follow: false } };

/**
 * Invitation landing page (#26). Rendering never activates anything: the page only shows the form, and the
 * token is checked by the read-only GET API from the browser. Activation is a deliberate POST by the user.
 */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const scope = await resolveAuthHost(prisma, new Headers(await headers()).get("host"));
  if (scope?.area !== "COMPANY_ADMIN" || !scope.organizationId) notFound();
  const { token } = await params;
  return <ActivationFlow token={token} />;
}
