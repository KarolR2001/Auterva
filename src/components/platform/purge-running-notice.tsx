import { Alert } from "../ui/alert";
import { PURGE_DONE_PAGE, PURGE_RUNNING_PAGE } from "./platform-api";
import styles from "./platform.module.css";

export type PurgeNoticeState = "running" | "done";

/** The state of a company's pages from its purge columns: finished wins over started; null while data is still served. */
export function purgeNoticeState(company: { purgeStartedAt: Date | null; purgedAt: Date | null }): PurgeNoticeState | null {
  if (company.purgedAt) return "done";
  return company.purgeStartedAt ? "running" : null;
}

/** Name the shell shows for the company: the skeleton of a purged company has no name to show. */
export function purgeCompanyName(state: PurgeNoticeState | null, name: string | null) {
  return state === "done" ? PURGE_DONE_PAGE.title : (name ?? "Firma");
}

/** Neutral replacement of a company page while the permanent deletion runs or after it: no fleet, settings, feeds or save
 *  controls. The way back to the company card stays in the shell's company context. */
export function PurgeRunningNotice({ state }: { state: PurgeNoticeState }) {
  const page = state === "done" ? PURGE_DONE_PAGE : PURGE_RUNNING_PAGE;
  return (
    <div className={styles.page}>
      <Alert tone="info" title={page.title}>{page.text}</Alert>
    </div>
  );
}
