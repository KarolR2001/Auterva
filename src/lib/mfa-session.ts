import type { PrismaClient } from "../generated/prisma/client";
import type { auth } from "./auth";

function responseCookies(request: Request, response: Response) {
  const entries = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const entry = part.trim();
    if (entry) entries.set(entry.split("=", 1)[0], entry);
  }
  for (const setCookie of response.headers.getSetCookie()) {
    const entry = setCookie.split(";", 1)[0];
    entries.set(entry.split("=", 1)[0], entry);
  }
  return [...entries.values()].join("; ");
}

export async function recordVerifiedMfaSession(db: PrismaClient, instance: typeof auth, request: Request, response: Response) {
  if (!response.ok) return;
  const cookie = responseCookies(request, response);
  const session = await instance.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error("TOTP verification did not create or retain a session");
  await db.session.update({ where: { id: session.session.id }, data: { mfaVerifiedAt: new Date() } });
}
