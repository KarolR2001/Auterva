import qrcode from "qrcode-generator";

export function createMfaQr(uri: string) {
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  const count = qr.getModuleCount();
  const modules = Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
  const path = modules.flatMap((row, y) =>
    row.flatMap((dark, x) => (dark ? [`M${x + 4} ${y + 4}h1v1h-1z`] : [])),
  ).join("");
  return { count, modules, path };
}

export function MfaQr({ uri }: { uri: string }) {
  const { count, path } = createMfaQr(uri);
  return (
    <svg
      role="img"
      aria-label="Kod QR do konfiguracji MFA"
      viewBox={`0 0 ${count + 8} ${count + 8}`}
      width="192"
      height="192"
      shapeRendering="crispEdges"
    >
      <rect width={count + 8} height={count + 8} fill="#ffffff" />
      <path d={path} fill="#151515" />
    </svg>
  );
}
