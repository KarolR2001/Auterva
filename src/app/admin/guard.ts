import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";

/** Every admin page checks host, session, role and company itself; the client components only render. */
export async function requireCompanyAdminPage() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId
    || !await requireRequestContext(prisma, auth, incoming, area.organizationId)) notFound();
}
