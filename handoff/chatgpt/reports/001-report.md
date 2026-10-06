# Report 001: UI screen specification (Lens style)

Status: done

## Summary
Przygotowano angielską specyfikację ośmiu ekranów w docs/ui/screens.md na podstawie pełnej specyfikacji projektu rev 2. Dokument opisuje układ, Board, tabele, formularze, walidację, stany błędów, statusy, tożsamość agentów, audit i logi. Pola wyliczane oraz brakujące kontrakty API oznaczono jawnie, bez rozszerzania modelu danych jako istniejącego faktu.

## Done
- Układ z wymiarami w px, minimum 1024 px, zachowaniem paneli i docka.
- Board: kolumny, karty, filtrowanie, swimlanes, przeciąganie, anulowanie, aktualizacje SSE i reconnect.
- Osiem ekranów z kolumnami i źródłami danych, akcjami, filtrami, panelami, formularzami lub wyraźnym brakiem edycji.
- Pełne mapowanie Task.status i Run.status na etykiety i wymagane tokeny.
- Tożsamość agenta, bieżąca polityka i historyczna wersja runa, ostatnie runy oraz historia audit.
- Audit: filtry, weryfikacja zakresu łańcucha, eksport JSONL i zachowanie przy ograniczeniach endpointu.
- Osiem skrótów klawiaturowych i lista wzorców Lens do wykorzystania oraz unikania.
- Kontrola dokumentu względem modelu: brak Task.labels, Run.denied, automatycznego resume, edytowalnych wersji polityk i zwracanych sekretów.

## Not done (and why)
- Nie zastosowano ramek ASCII. Układ, Dashboard i szczegóły agenta przedstawiono tabelami jako renderowalnymi wireframe'ami zgodnie z nadrzędną instrukcją środowiska, aby używać renderowanego formatu zamiast ASCII.
- Kod i testy aplikacji nie należą do zakresu zadania. Nie zmieniono STATUS.md ani inbox/.

## Assumptions
- Priorytety P0–P3, liczby 0–3, domyślnie P2; wewnątrz priorytetu kolejność po createdAt i ID, bez nowego pola rank.
- Etykiety kart pochodzą z target.label i Agent.labels, ponieważ Task nie ma labels.
- Limity długości formularzy są propozycją do kontraktów zod, a nie istniejącym kontraktem serwera.
- Brakujące możliwości API są wskazane w sekcji 12; interfejs ma opisane zachowanie do czasu ich wdrożenia.
- Brak działającego API oznacza brak możliwości sprawdzenia implementacji; wykonano przegląd kompletności specyfikacji i zgodności pól.

## Questions for the architect
- Czy zatwierdzasz P0–P3 oraz queued-only aktualizację priorytetu, potrzebną do przeciągania w Board?
- Czy zatwierdzasz proponowane walidacje i reguły usuwania/anulowania?
- Jaka jest strefa doby budżetowej i zachowanie zadania z etykietą bez kandydatów?
- Czy API zapewni replay ID SSE, zakres wyniku verify i filtrowany eksport z granicą seq?
- Czy aktualizacja metadanych polityki i bezpieczna informacja o skonfigurowanym sekrecie należą do stage 1?

## Suggested next tasks
- Uzgodnić kontrakty z sekcji 12 w packages/contracts przed implementacją UI.
- Wdrożyć bazowy layout i Board z obsługą SSE oraz konfliktów stanu.
- Wdrożyć odczyt historycznych wersji polityk i zakresową weryfikację audit.
