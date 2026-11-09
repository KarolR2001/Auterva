"use client";

import { useState } from "react";

import { PanelShell } from "../../src/components/panel/panel-shell";
import { PanelFeedback } from "../../src/components/panel/panel-states";
import { UnsavedChangesDialog } from "../../src/components/panel/unsaved-changes-dialog";
import type { PanelAccessState } from "../../src/components/panel/panel-states";

export function PanelCheck() {
  const [area, setArea] = useState<"company" | "platform">("company");
  const [accessState, setAccessState] = useState<PanelAccessState>("allowed");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [fixtureNote, setFixtureNote] = useState("");

  return (
    <>
      <div className="fixtureControls" aria-label="Kontrole fixture">
        <strong>Fixture UI — bez uwierzytelnienia i zapisu</strong>
        <button onClick={() => setArea("company")}>Firma</button>
        <button onClick={() => setArea("platform")}>Platforma</button>
        <label>
          Stan dostępu
          <select
            value={accessState}
            onChange={(event) =>
              setAccessState(event.target.value as PanelAccessState)
            }
          >
            <option value="allowed">Dostęp</option>
            <option value="service-expired">Usługa wygasła</option>
            <option value="session-expired">Sesja wygasła</option>
            <option value="forbidden">Brak uprawnień</option>
            <option value="archived">Firma zarchiwizowana</option>
            <option value="loading">Sprawdzanie dostępu</option>
          </select>
        </label>
      </div>
      <PanelShell
        area={area}
        accessState={accessState}
        title={area === "company" ? "Panel firmy" : "Firmy"}
        currentPath={area === "company" ? "/admin" : "/firmy"}
        unreadChat
        companyContext={
          area === "platform"
            ? { id: "firma-alfa", name: "Firma Alfa" }
            : undefined
        }
        onLogout={async () => {
          setFixtureNote("Fixture nie unieważnia sesji — wymagany backend.");
          throw new Error("Brak backendu w fixture");
        }}
      >
        <p>
          {area === "company"
            ? "Przykładowa treść firmy"
            : "Przykładowa lista firm"}
        </p>
        <label>
          Nazwa testowa
          <input defaultValue="Firma Alfa" />
        </label>
        <button onClick={() => setDialogOpen(true)}>Wyjdź z formularza</button>
        <PanelFeedback
          kind="error"
          dashboardHref={area === "company" ? "/admin" : "/firmy"}
          requestId="fixture-123"
          onRetry={() =>
            setFixtureNote("Fixture: ponowienie nie pobiera danych.")
          }
        />
        {fixtureNote && <p role="status">{fixtureNote}</p>}
      </PanelShell>
      <UnsavedChangesDialog
        open={dialogOpen && accessState === "allowed"}
        contextLabel="formularz testowy"
        onStay={() => setDialogOpen(false)}
        onDiscard={() => setDialogOpen(false)}
        onSaveAndLeave={async () => {
          setFixtureNote("Fixture: zapis wymaga API.");
          throw new Error("Brak API w fixture");
        }}
      />
      <style jsx>{`
        .fixtureControls {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          padding: 8px;
          background: #f2f2f2;
        }
        .fixtureControls button,
        .fixtureControls select {
          min-height: 44px;
        }
        .fixtureControls label {
          display: flex;
          align-items: center;
          gap: 8px;
        }
      `}</style>
    </>
  );
}
