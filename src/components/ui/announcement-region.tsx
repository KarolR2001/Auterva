import styles from "./ui.module.css";

type AnnouncementRegionProps = {
  politeness: "polite" | "assertive";
  message: string;
};

export function AnnouncementRegion({
  politeness,
  message,
}: AnnouncementRegionProps) {
  return (
    <div
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-atomic="true"
      className={styles.visuallyHidden}
    >
      {message}
    </div>
  );
}
