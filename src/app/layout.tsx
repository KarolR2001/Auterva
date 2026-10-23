import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Auterva",
  description: "Auterva",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="pl"><body>{children}</body></html>;
}
