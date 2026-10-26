import type { ComponentPropsWithoutRef } from "react";

import styles from "./ui.module.css";

type SkipLinkProps = Omit<
  ComponentPropsWithoutRef<"a">,
  "children" | "href"
> & {
  target: "content" | "navigation";
};

export function SkipLink({ target, className, ...props }: SkipLinkProps) {
  return (
    <a
      {...props}
      href={target === "content" ? "#main-content" : "#main-navigation"}
      className={[styles.skipLink, className].filter(Boolean).join(" ")}
    >
      {target === "content" ? "Przejdź do treści" : "Przejdź do nawigacji"}
    </a>
  );
}
