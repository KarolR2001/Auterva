import qrcode from "qrcode-generator";

import styles from "./auth.module.css";

/** Quiet zone required around the symbol, in modules. */
export const QR_QUIET_ZONE = 4;

export function createMfaQr(uri: string) {
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  const count = qr.getModuleCount();
  const modules = Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
  const path = modules
    .flatMap((row, y) =>
      row.flatMap((dark, x) =>
        dark ? [`M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h1v1h-1z`] : [],
      ),
    )
    .join("");
  return { count, modules, path };
}

export function MfaQr({ uri }: { uri: string }) {
  const { count, path } = createMfaQr(uri);
  const size = count + QR_QUIET_ZONE * 2;
  // Colors come from semantic tokens (surface-default, text-primary) via CSS classes.
  return (
    <svg
      role="img"
      aria-label="Kod QR do konfiguracji MFA"
      className={styles.qr}
      viewBox={`0 0 ${size} ${size}`}
      width="192"
      height="192"
      shapeRendering="crispEdges"
    >
      <rect className={styles.qrBackground} width={size} height={size} />
      <path className={styles.qrModules} d={path} />
    </svg>
  );
}
