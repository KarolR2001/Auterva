"use client";

import { useState } from "react";
import { Check } from "lucide-react";

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
  const [dialogWithoutSecondaryOpen, setDialogWithoutSecondaryOpen] =
    useState(false);
  const [buttonLoading, setButtonLoading] = useState(false);
  const [plainButtonLoading, setPlainButtonLoading] = useState(false);

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
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <Button>Sprawdź dostępność</Button>
          <Button variant="secondary">Zobacz szczegóły</Button>
          <Button variant="destructive">Usuń pojazd testowy</Button>
          <Button loading loadingLabel="Ładowanie">
            Sprawdź dostępność
          </Button>
          <Button size="sm" data-testid="small-button">
            Mały przycisk
          </Button>
          <Button
            size="sm"
            aria-label="Mała akcja z ikoną"
            icon={<Check size={16} />}
            data-testid="small-icon-button"
          />
          <Button
            loading={plainButtonLoading}
            loadingLabel="Zapisywanie dłuższej nazwy pojazdu"
            data-testid="plain-loading-button"
            onClick={() => setPlainButtonLoading(true)}
          >
            Zapisz
          </Button>
          <Button
            icon={<Check size={16} />}
            loading={buttonLoading}
            loadingLabel="Zapisywanie dłuższej nazwy pojazdu"
            data-testid="icon-loading-button"
            onClick={() => setButtonLoading((value) => !value)}
          >
            Zapisz
          </Button>
        </section>
        <section
          aria-label="Długa etykieta"
          style={{ width: "100%", maxWidth: 280 }}
        >
          <Button
            width="fill"
            icon={<Check size={16} />}
            loading
            loadingLabel="Zapisywanie dłuższej nazwy pojazdu"
            data-testid="long-loading-button"
          >
            Zapisz
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
        <Button
          variant="secondary"
          onClick={() => setDialogWithoutSecondaryOpen(true)}
        >
          Otwórz dialog bez akcji drugorzędnej
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
        <Dialog
          open={dialogWithoutSecondaryOpen}
          onOpenChange={setDialogWithoutSecondaryOpen}
          type="destructive"
          title="Usunąć pojazd testowy bez akcji drugorzędnej?"
          primaryAction={{
            label: "Usuń pojazd testowy",
            onClick: () => setDialogWithoutSecondaryOpen(false),
          }}
        />
      </main>
    </>
  );
}
