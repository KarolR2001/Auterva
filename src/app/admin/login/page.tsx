import { AuthPage } from "@/components/auth/auth-page";
export const dynamic = "force-dynamic";
export default function Page({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | string[] }>;
}) {
  return <AuthPage area="company" stage="login" searchParams={searchParams} />;
}
