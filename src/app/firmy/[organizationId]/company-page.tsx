import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { PanelShell } from "@/components/panel/panel-shell";
import { requirePlatformPage } from "@/components/platform/platform-gate";
import { Alert } from "@/components/ui/alert";
import { prisma } from "@/lib/prisma";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Server frame of the superadmin's pages in one company (#47). The company comes from the URL, so it is checked here on every
 * request: host, role, MFA (platform gate) and the existence of the company. An unknown or malformed id is the neutral 404.
 * The superadmin acts as themselves; the page shows whose company it is and keeps the way back to its card.
 */
export async function PlatformCompanyPage({ organizationId, currentPath, title, children }: {
  organizationId: string;
  currentPath: string;
  title: string;
  children: (company: { name: string; archived: boolean }) => ReactNode | Promise<ReactNode>;
}) {
  if (!uuid.test(organizationId)) notFound();
  const actor = await requirePlatformPage();
  const company = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true, archivedAt: true } });
  if (!company) notFound();
  const name = company.name ?? "Firma";
  const archived = company.archivedAt !== null;
  return (
    <PanelShell area="platform" accessState="allowed" expectedSessionId={actor.sessionId} title={title} currentPath={currentPath}
      companyContext={{ id: organizationId, name }}>
      {archived && (
        <Alert tone="info" title="Firma jest zarchiwizowana">
          Administrator firmy nie ma dostępu, a strona publiczna jest wyłączona. Jako superadmin nadal zarządzasz flotą i zdjęciami tej firmy.
        </Alert>
      )}
      {await children({ name, archived })}
    </PanelShell>
  );
}
