import type { Metadata } from "next";
import { connection } from "next/server";
import type { ReactNode } from "react";
import { CspNonce } from "@/components/csp-nonce";
import { WebVitalsReporter } from "@/components/vitals/web-vitals-reporter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auterva",
  description: "Auterva",
};

// #57: every document, the not-found page included, is rendered per request so Next can tag its scripts with the
// nonce of the CSP that Proxy set. A prerendered page carries no nonce and would be blocked by that policy.
export default async function RootLayout({ children }: { children: ReactNode }) {
  await connection();
  // #234: client libraries that inject <style> (Radix scroll lock) need the nonce of the document's CSP; CspNonce reads it from the document.
  return <html lang="pl"><body><CspNonce /><WebVitalsReporter />{children}</body></html>;
}
