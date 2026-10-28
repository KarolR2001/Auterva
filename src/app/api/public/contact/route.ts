import { routeContext } from "@/modules/observability/route-context";
import { readContact } from "@/modules/public-offer/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Read only: contact never creates a lead, a customer, a reservation or a block, so there is no POST.
export const GET = routeContext(readContact);
