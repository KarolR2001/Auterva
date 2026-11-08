// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import jsQR from "jsqr";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MfaQr, QR_QUIET_ZONE } from "../../src/components/auth/mfa-qr";
import styles from "../../src/components/auth/auth.module.css";

const palette = ["#151515", "#424242", "#737373", "#a5a5a5", "#f2f2f2"];
const tokens = readFileSync("design/tokens/auterva.tokens.css", "utf8");
const moduleCss = readFileSync("src/components/auth/auth.module.css", "utf8");

function resolveToken(value: string): string {
  const name = /^var\((--[\w-]+)\)$/.exec(value.trim())?.[1];
  if (!name) return value.trim();
  const declared = new RegExp(`${name}:\\s*([^;]+);`).exec(tokens)?.[1];
  if (!declared) throw new Error(`Missing token ${name}`);
  return resolveToken(declared);
}

function classFill(className: string): string {
  const rule = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(moduleCss)?.[1] ?? "";
  const fill = /fill:\s*([^;]+);/.exec(rule)?.[1];
  if (!fill) throw new Error(`No fill for .${className}`);
  expect(fill).toMatch(/^var\(--/);
  return resolveToken(fill);
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe("lokalny kod QR enrollmentu MFA", () => {
  it("dekoduje URI TOTP z renderowanego SVG w kolorach tokenów, z kontrastem i strefą ciszy", () => {
    const uri = "otpauth://totp/Auterva%3Atest%40example.com?secret=ABCDEF123456&issuer=Auterva";
    const markup = renderToStaticMarkup(<MfaQr uri={uri} />);
    const document = new DOMParser().parseFromString(markup, "image/svg+xml");
    const svg = document.querySelector("svg")!;
    const rect = svg.querySelector("rect")!;
    const path = svg.querySelector("path")!;

    // No literal colors in the markup: both fills come from semantic tokens.
    expect(markup).not.toMatch(/#[0-9a-f]{3,8}\b|fill="/i);
    expect(rect.getAttribute("class")).toBe(styles.qrBackground);
    expect(path.getAttribute("class")).toBe(styles.qrModules);
    const light = classFill("qrBackground").toLowerCase();
    const dark = classFill("qrModules").toLowerCase();
    expect(palette).toContain(light);
    expect(palette).toContain(dark);
    const contrast = (luminance(light) + 0.05) / (luminance(dark) + 0.05);
    expect(contrast).toBeGreaterThanOrEqual(7);

    // Rasterize exactly what the SVG path draws.
    const size = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
    expect(Number(rect.getAttribute("width"))).toBe(size);
    const cells = [...path.getAttribute("d")!.matchAll(/M(\d+) (\d+)h1v1h-1z/g)]
      .map((m) => [Number(m[1]), Number(m[2])] as const);
    expect(cells.length).toBeGreaterThan(0);
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    expect(Math.min(...xs)).toBe(QR_QUIET_ZONE);
    expect(Math.min(...ys)).toBe(QR_QUIET_ZONE);
    expect(size - 1 - Math.max(...xs)).toBe(QR_QUIET_ZONE);
    expect(size - 1 - Math.max(...ys)).toBe(QR_QUIET_ZONE);

    const dark8 = new Set(cells.map(([x, y]) => `${x},${y}`));
    const scale = 6;
    const px = size * scale;
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [lightRgb, darkRgb] = [rgb(light), rgb(dark)];
    const pixels = new Uint8ClampedArray(px * px * 4);
    for (let y = 0; y < px; y++)
      for (let x = 0; x < px; x++) {
        const color = dark8.has(`${Math.floor(x / scale)},${Math.floor(y / scale)}`) ? darkRgb : lightRgb;
        pixels.set([...color, 255], (y * px + x) * 4);
      }
    expect(jsQR(pixels, px, px, { inversionAttempts: "dontInvert" })?.data).toBe(uri);
  });
});
