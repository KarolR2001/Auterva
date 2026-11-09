import { ResetPage } from "@/components/auth/reset-page";
export const dynamic = "force-dynamic";
export default function Page({ params }: { params: Promise<{ token: string }> }) {
  return <ResetPage area="company" token={params} />;
}
