import type { ReactNode } from "react";

import { PageHeader } from "../ui/page-header";

/** Superadmin company screens (PLT-03/PLT-04) keep their import path; the header itself is the shared PageHeader. */
export function PlatformPageHeader({ trail, title, subtitle, actions, className }: {
  className?: string;
  trail: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return <PageHeader trail={trail} title={title} description={subtitle} actions={actions} className={className} />;
}
