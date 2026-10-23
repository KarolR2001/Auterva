"use client";

import { useState } from "react";

import { Alert } from "../../src/components/ui/alert";
import { AnnouncementRegion } from "../../src/components/ui/announcement-region";
import { Button } from "../../src/components/ui/button";
import { Dialog } from "../../src/components/ui/dialog";
import { FormField } from "../../src/components/ui/form-field";
import { PasswordInput } from "../../src/components/ui/password-input";
import { SkipLink } from "../../src/components/ui/skip-link";
import { TextInput } from "../../src/components/ui/text-input";

export function UiCheckFixture() {
  const [visibility, setVisibility] = useState<"hidden" | "shown">("hidden");
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <SkipLink target="content" />
      <main
        id="main-content"
        tabIndex={-1}
        style={{
          width: "min(100%, 640px)",
          margin: "auto",
          padding: 16,
          display: "grid",
          gap: 24,
        }}
      >
        <h1>Kontrola komponentów</h1>
        <section
          aria-label="Akcje"
          style={{ display: "flex", flexWrap: "wrap", gap: 12 }}
        >
          <Button>Sprawdź dostępność</Button>
          <Button variant="secondary">Zobacz szczegóły</Button>
          <Button variant="destructive">Usuń pojazd testowy</Button>
          <Button loading loadingLabel="Ładowanie">
            Sprawdź dostępność
          </Button>
        </section>
        <section aria-label="Pola" style={{ display: "grid", gap: 16 }}>
          <FormField
            id="vehicle-name"
            label="Nazwa pojazdu"
            required
            hint="Widoczne publicznie"
          >
            <TextInput placeholder="np. Mercedes Klasa V" />
          </FormField>
          <FormField
            id="invalid-name"
            label="Nazwa pojazdu"
            error="Wpisz prawidłową nazwę pojazdu."
          >
            <TextInput defaultValue="Nieprawidłowa wartość" />
          </FormField>
          <PasswordInput
            id="password-check"
            label="Hasło"
            autoComplete="current-password"
            visibility={visibility}
            onVisibilityChange={setVisibility}
          />
        </section>
        <Alert tone="error" title="Nie zapisano">
          Spróbuj ponownie.
        </Alert>
        <AnnouncementRegion politeness="polite" message="Kontrola gotowa" />
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Otwórz dialog
        </Button>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          type="destructive"
          title="Usunąć pojazd testowy?"
          description="Tej operacji nie można cofnąć."
          primaryAction={{
            label: "Usuń pojazd testowy",
            onClick: () => setDialogOpen(false),
          }}
          secondaryAction={{
            label: "Anuluj",
            onClick: () => setDialogOpen(false),
          }}
        />
      </main>
    </>
  );
}
