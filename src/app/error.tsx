"use client";

import { ErrorBlock } from "@/components/public/state-page";

// PUB-08 safe shell: no data, no company, no cause. The digest is Next's hash of the error, not its message.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main id="main-content"><ErrorBlock digest={error.digest} onRetry={reset} /></main>;
}
