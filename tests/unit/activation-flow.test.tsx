// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ActivationFlow } from "../../src/components/auth/activation-flow";

const token = "a".repeat(43);
const invitation = () => Response.json({ name: "Alfa Rent", recipientEmail: "a@example.test" });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function submit(post: () => Response | Promise<Response>, password = "correct horse battery") {
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
    init?.method === "POST" ? post() : invitation());
  const user = userEvent.setup();
  render(<ActivationFlow token={token} />);
  await screen.findByRole("heading", { name: "Aktywuj konto" });
  await user.type(screen.getByLabelText("Nowe hasło"), password);
  await user.type(screen.getByLabelText("Powtórz hasło"), password);
  await user.click(screen.getByRole("button", { name: "Aktywuj konto" }));
  return { user, request };
}

describe("aktywacja konta: wynik POST", () => {
  it("502 z bramy to stan niepewny: hasła zablokowane, ponowienie tym samym hasłem kończy sukcesem", async () => {
    let calls = 0;
    const { user, request } = await submit(() => (++calls === 1 ? new Response("bad gateway", { status: 502 }) : Response.json({ siteState: "READY" })));
    expect(await screen.findByText("Nie udało się potwierdzić aktywacji.")).toBeVisible();
    expect(screen.queryByText(/nie zostało zmienione/i)).toBeNull();
    expect(screen.getByLabelText("Nowe hasło")).toHaveAttribute("readonly");
    expect(screen.getByLabelText("Powtórz hasło")).toHaveAttribute("readonly");
    await user.click(screen.getByRole("button", { name: "Ponów aktywację" }));
    expect(await screen.findByRole("heading", { name: "Konto jest aktywne" })).toBeVisible();
    const bodies = request.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => init?.body);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });

  it("500 INTERNAL_ERROR i błąd sieci też są niepewne", async () => {
    await submit(() => Response.json({ code: "INTERNAL_ERROR" }, { status: 500 }));
    expect(await screen.findByText("Nie udało się potwierdzić aktywacji.")).toBeVisible();
    cleanup();
    await submit(() => { throw new TypeError("network"); });
    expect(await screen.findByText("Nie udało się połączyć.")).toBeVisible();
    expect(screen.getByLabelText("Nowe hasło")).toHaveAttribute("readonly");
  });

  it("503 INGRESS_NOT_CONFIGURED to pewny stan sprzed zapisu, hasła edytowalne", async () => {
    await submit(() => Response.json({ code: "INGRESS_NOT_CONFIGURED" }, { status: 503 }));
    expect(await screen.findByText(/Konto nie zostało zmienione/)).toBeVisible();
    expect(screen.getByLabelText("Nowe hasło")).not.toHaveAttribute("readonly");
  });

  it("429 pokazuje odliczanie, 403 i 400 własne komunikaty, 404 ślepy zaułek", async () => {
    await submit(() => new Response("{}", { status: 429, headers: { "Retry-After": "30" } }));
    expect(await screen.findByText("Zbyt wiele prób.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Ponów po limicie" })).toBeDisabled();
    cleanup();
    await submit(() => Response.json({ code: "FORBIDDEN" }, { status: 403 }));
    expect(await screen.findByText(/Otwórz link z zaproszenia bezpośrednio/)).toBeVisible();
    cleanup();
    await submit(() => Response.json({ code: "INVALID_REQUEST" }, { status: 400 }));
    expect(await screen.findByText("Hasło nie spełnia wymagań.")).toBeVisible();
    cleanup();
    await submit(() => Response.json({ code: "NOT_FOUND" }, { status: 404 }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Link jest nieaktualny" })).toBeVisible());
  });

  it("sukces nie obiecuje wpisanego hasła", async () => {
    await submit(() => Response.json({ siteState: "RESTORE_LOCKED" }));
    expect(await screen.findByText(/hasłem ustawionym przy aktywacji/)).toBeVisible();
    expect(window.location.pathname).toBe("/admin/login/");
    expect(screen.getByText("Publikacja strony czeka na odblokowanie")).toBeVisible();
  });
});

describe("aktywacja konta: wskaźnik siły hasła (DS-AUT-004)", () => {
  it("pokazuje poziom i checklistę, z długością jako wymaganą, a resztą jako zalecaną", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => invitation());
    const user = userEvent.setup();
    render(<ActivationFlow token={token} />);
    await screen.findByRole("heading", { name: "Aktywuj konto" });
    expect(screen.getByText("Siła hasła: Za krótkie")).toBeVisible();
    expect(screen.getByLabelText("Nowe hasło")).toHaveAccessibleDescription(/Siła hasła: Za krótkie/);
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Co najmniej 12 znaków (wymagane): oczekuje");
    for (const item of items.slice(1)) expect(item).toHaveTextContent("(zalecane)");
    await user.type(screen.getByLabelText("Nowe hasło"), "Abcdefghij1!");
    expect(screen.getByText("Siła hasła: Mocne")).toBeVisible();
    expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("(wymagane): spełnione");
  });

  it("zalecane kryteria nie blokują wysłania hasła o 12 znakach", async () => {
    const { request } = await submit(() => Response.json({ siteState: "READY" }), "correct horse battery");
    expect(await screen.findByRole("heading", { name: "Konto jest aktywne" })).toBeVisible();
    expect(request.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });
});

