import { describe, expect, it } from "vitest";
import { parseLegalText } from "../../src/modules/public-offer/legal-structure";

describe("parseLegalText (D-36)", () => {
  it("dzieli na nagłówki i akapity, numeruje sekcje i nadaje kotwice", () => {
    const r = parseLegalText("Wstęp\n\n## Dane\nPierwsza linia\nDruga linia\n\nNowy akapit\n## Cele\nTekst");
    expect(r.intro).toEqual(["Wstęp"]);
    expect(r.sections).toEqual([
      { id: "sekcja-1", number: 1, title: "Dane", paragraphs: ["Pierwsza linia\nDruga linia", "Nowy akapit"] },
      { id: "sekcja-2", number: 2, title: "Cele", paragraphs: ["Tekst"] },
    ]);
  });
  it("bez nagłówków nie ma sekcji (brak spisu treści)", () => {
    expect(parseLegalText("Sam tekst\n\nDrugi").sections).toEqual([]);
    expect(parseLegalText("").intro).toEqual([]);
  });
  it("## w środku linii, bez spacji lub puste nie jest nagłówkiem", () => {
    const r = parseLegalText("a ## b\n##Brak\n## \n##\n ## wcięty");
    expect(r.sections).toEqual([]);
    expect(r.intro[0]).toContain("a ## b");
  });
  it("puste sekcje i CRLF", () => {
    const r = parseLegalText("## Pusta\r\n## Druga\r\n\r\nTreść");
    expect(r.sections.map((s) => [s.title, s.paragraphs])).toEqual([["Pusta", []], ["Druga", ["Treść"]]]);
  });
  it("zachowuje HTML jako tekst i ucina bardzo długi nagłówek", () => {
    const r = parseLegalText(`## <b>x</b> ${"a".repeat(500)}`);
    expect(r.sections[0].title.startsWith("<b>x</b> ")).toBe(true);
    expect(r.sections[0].title.length).toBe(200);
  });
});
