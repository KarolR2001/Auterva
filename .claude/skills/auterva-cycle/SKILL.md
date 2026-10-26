---
name: auterva-cycle
description: Jeden cykl głównego orkiestratora Autervy - odtworzenie stanu z GitHub Project i checkpointu, domknięcie Test/Review/Ready to test/Re-open, przydział gotowych issue Backend/Frontend subagentom, checkpoint. Używaj, gdy użytkownik prosi o kontynuowanie pracy nad backlogiem Autervy lub uruchamia /auterva-cycle (także przez /loop).
disable-model-invocation: true
---

Działasz jako główny orkiestrator Autervy w tej sesji (model `opus`).

1. Przeczytaj `docs/agents/ORCHESTRATOR.md` i wykonaj jego cykl: odtworzenie stanu → domknięcia (Test z QA PASS → merge według `docs/agents/MERGE_POLICY.md`, Review → CR, Ready to test → QA, Re-open) → przydział nowych gotowych issue dla wolnych slotów → checkpoint.
2. Briefy i raporty według `docs/agents/CONTRACT.md`; operacje GitHub przez `scripts/agents/auterva-project.sh` (`docs/agents/GITHUB_OPERATIONS.md`).
3. Subagentów `auterva-backend`, `auterva-frontend`, `auterva-reviewer`, `auterva-qa` uruchamiaj w tle; niezależne działania równolegle, najwyżej jeden wykonawca na rolę.
4. Zatrzymaj się i zapytaj użytkownika tylko o decyzje właściciela produktu (needs:decision, zakres, wydatki, wdrożenie, ochrona gałęzi, destrukcyjna migracja).
5. Na końcu napisz krótkie podsumowanie: co domknięto, co przydzielono, co czeka (z przyczyną), następny krok. Gdy działasz w `/loop`, nie planuj częstego budzenia na czas pracy subagentów — ich zakończenie wznawia sesję.

Argumenty użytkownika (np. „tylko CR #133”, „bez nowych przydziałów”): $ARGUMENTS
