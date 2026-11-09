import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PwaProvider } from "@/components/pwa/pwa-provider";

export const metadata: Metadata = {
  manifest: "/admin/manifest.webmanifest",
  icons: { icon: [{ url: "/admin/icon.svg", type: "image/svg+xml" }, { url: "/admin/icon-192.png", sizes: "192x192", type: "image/png" }], apple: "/admin/apple-touch-icon.png" },
  robots: { index: false, follow: false },
};

// The layout exists only under /admin, which only the company host serves (host-route-policy), so the worker is
// registered from here and nowhere else.
export default function AdminLayout({ children }: { children: ReactNode }) {
  return <PwaProvider>{children}</PwaProvider>;
}
