import { notFound, redirect } from "next/navigation";

import type { auth } from "@/lib/auth";

// Called only on a host that is already known to be the panel area, after authorization failed.
// A request with no valid session (PWA cold start, expired cookie) goes to the login of the same host;
// no private HTML or RSC payload is rendered. A valid but unauthorized session (foreign role/company, limited MFA)
// stays a neutral 404, so the answer reveals nothing about the account.
export async function denyPanel(
  instance: typeof auth,
  headers: Headers,
  area: "company" | "platform",
): Promise<never> {
  const session = await instance.api.getSession({ headers });
  if (session) notFound();
  redirect(area === "company" ? "/admin/login?returnTo=%2Fadmin" : "/login");
}
