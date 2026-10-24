import { PwaRegistration } from "./pwa-registration";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { requireRequestContext, resolveRequestArea } from "@/modules/tenancy/request-context";

export const dynamic = "force-dynamic";

export default async function AdminPlaceholder() {
  const incoming = new Headers(await headers());
  const area = await resolveRequestArea(prisma, incoming.get("host"));
  if (area?.area !== "COMPANY_ADMIN" || !area.organizationId
    || !await requireRequestContext(prisma, auth, incoming, area.organizationId)) notFound();
  return <main><h1>Panel Auterva</h1><p>Panel jest w przygotowaniu.</p><PwaRegistration /></main>;
}
