import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auterva",
  description: "Auterva",
};

// #57: every document, the not-found page included, is rendered per request so Next can tag its scripts with the
// nonce of the CSP that Proxy set. A prerendered page carries no nonce and would be blocked by that policy.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  return <html lang="pl"><body>{children}</body></html>;
}
