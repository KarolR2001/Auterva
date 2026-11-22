import { Alert } from "../ui/alert";
import { PURGE_RUNNING_PAGE } from "./platform-api";
import styles from "./platform.module.css";

/** Neutral replacement of a company page while the permanent deletion runs: no fleet, settings or save controls.
 *  The way back to the company card stays in the shell's company context. */
export function PurgeRunningNotice() {
  return (
    <div className={styles.page}>
      <Alert tone="info" title={PURGE_RUNNING_PAGE.title}>{PURGE_RUNNING_PAGE.text}</Alert>
    </div>
  );
}
