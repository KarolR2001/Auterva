import jsQR from "jsqr";
import { describe, expect, it } from "vitest";

import { createMfaQr } from "../../src/components/auth/mfa-qr";

describe("lokalny kod QR enrollmentu MFA", () => {
  it("dekoduje dokładnie URI TOTP z czteromodułową białą ramką", () => {
    const uri = "otpauth://totp/Auterva%3Atest%40example.com?secret=ABCDEF123456&issuer=Auterva";
    const { count, modules } = createMfaQr(uri);
    const scale = 8;
    const size = (count + 8) * scale;
    const pixels = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const moduleY = Math.floor(y / scale) - 4;
        const moduleX = Math.floor(x / scale) - 4;
        const dark = modules[moduleY]?.[moduleX] ?? false;
        const offset = (y * size + x) * 4;
        pixels.fill(dark ? 21 : 255, offset, offset + 3);
        pixels[offset + 3] = 255;
      }
    }
    expect(jsQR(pixels, size, size, { inversionAttempts: "dontInvert" })?.data).toBe(uri);
  });
});
