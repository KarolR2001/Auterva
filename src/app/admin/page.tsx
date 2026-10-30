import type { Metadata } from "next";
import { Dashboard } from "@/components/admin/dashboard";
import { PwaRegistration } from "./pwa-registration";
import { requireCompanyAdminPage } from "./guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Panel Auterva" };

export default async function AdminDashboardPage() {
  await requireCompanyAdminPage();
  return <main><Dashboard /><PwaRegistration /></main>;
}
