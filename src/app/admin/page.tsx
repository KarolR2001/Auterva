import { CompanyPanelPage } from "./company-panel";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  return CompanyPanelPage({
    currentPath: "/admin",
    children: <p>Panel jest w przygotowaniu.</p>,
  });
}
