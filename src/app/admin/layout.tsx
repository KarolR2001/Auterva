import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { manifest: "/admin/manifest.webmanifest", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: ReactNode }) { return children; }
