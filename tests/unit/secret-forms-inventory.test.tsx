// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SecretForm } from "../../src/components/ui/secret-form";

afterEach(cleanup);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx$/.test(name) ? [path] : [];
  });
}

/** Pliki z polem sekretu (hasło lub kod jednorazowy) — każdy ich formularz musi być SecretForm. */
const SECRET_FIELD = /PasswordInput|type="password"|autoComplete="one-time-code"|autoComplete=\{[^}]*one-time-code/;

describe("inwentarz formularzy z sekretem (#440)", () => {
  const files = sources("src").filter((file) => !file.endsWith("secret-form.tsx") && !file.endsWith("password-input.tsx"));
  const secretFiles = files.filter((file) => SECRET_FIELD.test(readFileSync(file, "utf8")));

  it("znajduje formularze logowania, MFA, aktywacji, resetu i zmiany hasła", () => {
    const names = secretFiles.map((file) => file.split("/").pop());
    expect(names).toEqual(expect.arrayContaining(["auth-flow.tsx", "reset-flow.tsx", "activation-flow.tsx", "account-view.tsx"]));
  });

  it.each(secretFiles)("%s nie używa gołego <form> (natywna wysyłka mogłaby iść GET-em z sekretem w URL)", (file) => {
    const source = readFileSync(file, "utf8");
    expect(source.match(/<form[\s>]/g) ?? []).toEqual([]);
  });

  it("SecretForm zawsze wysyła natywnie metodą POST i nie pozwala tego nadpisać", () => {
    const { container } = render(<SecretForm {...({ method: "get", action: "/x?code=1" } as object)} aria-label="x" />);
    const form = container.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBeNull();
    expect(form).toHaveAttribute("novalidate");
  });
});
