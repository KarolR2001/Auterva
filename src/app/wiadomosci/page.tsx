import { PanelShell } from "@/components/panel/panel-shell";
import { MessageInbox, type InboxSelection } from "@/components/platform/message-inbox";
import { requirePlatformPage } from "@/components/platform/platform-gate";
import { prisma } from "@/lib/prisma";
import { getPlatformCompany } from "@/modules/organizations/read";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ firma?: string | string[] }> };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Superadmin inbox (#53): the platform gate runs on every request. `?firma=` opens exactly that company's conversation
// (entry from the company card, C-F135); an unknown or malformed value opens the plain list, never another company.
export default async function MessagesPage({ searchParams }: Props) {
  const actor = await requirePlatformPage();
  const raw = (await searchParams).firma;
  const id = typeof raw === "string" && uuid.test(raw) ? raw.toLowerCase() : null;
  const company = id ? await getPlatformCompany(prisma, id) : null;
  const initialSelected: InboxSelection | null = company
    ? { organizationId: company.organizationId, name: company.name?.trim() || "Firma", archived: company.archivedAt !== null,
        conversationId: company.conversationId }
    : null;
  return (
    <PanelShell area="platform" accessState="allowed" expectedSessionId={actor.sessionId} title="Wiadomości" currentPath="/wiadomosci">
      <MessageInbox accountId={actor.userId} initialSelected={initialSelected} />
    </PanelShell>
  );
}
