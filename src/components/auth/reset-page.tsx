import type { AuthArea } from "./auth-destination";
import { requireAreaHost } from "./auth-host";
import { ResetRequestForm, SetNewPasswordForm } from "./reset-flow";

export async function ResetPage({
  area,
  token,
}: {
  area: AuthArea;
  token?: Promise<{ token: string }>;
}) {
  await requireAreaHost(area);
  if (!token) return <ResetRequestForm area={area} />;
  return <SetNewPasswordForm area={area} token={(await token).token} />;
}
