# Report 003: CLI capability and enforcement matrix (research)

Status: done

## Summary
Przygotowałem angielski dokument porównujący Claude Code CLI, OpenAI Codex CLI i Google Gemini CLI. Obejmuje wszystkie osiem obszarów zadania, wersje odniesienia, odnośniki do oficjalnych źródeł oraz końcową macierz siedmiu reguł polityki. Oddzieliłem potwierdzenie w dokumentacji i kodzie od wniosków oraz kwestii oznaczonych jako unverified. Najważniejsze ustalenia dotyczą otwartego zachowania przy awariach hooków, ograniczonego pokrycia narzędzi, izolacji discovery skillów i niezgodności konfiguracji chat z Codex 0.160.1.

## Done
- Dokument: [docs/research/cli-capability-matrix.md](../../../docs/research/cli-capability-matrix.md).
- Przeczytane wymagane sekcje specyfikacji oraz protokół na main.
- Weryfikacja dokumentacji producentów i kodu przypiętego do Codex rust-v0.160.1 oraz Gemini v0.62.0; Claude Code: dokumentacja i release 2.1.292.
- Opis flag headless, formatów zdarzeń, usage, izolacji kont, uprawnień, sandboxów, hooków, skillów, providerów i dostępności identity.
- Macierz rozróżnia admission, dispatch narzędzi i granicę sandboxa; zawiera odnośniki i warunki każdego oznaczenia.
- Sprawdzone ścieżki linkowanych plików źródłowych Codex i Gemini względem drzew odpowiednich tagów.
- Nie zmieniałem STATUS.md, inbox/ ani specyfikacji; nie dodałem kodu.

## Not done (and why)
- Nie wykonywałem smoke testów binariów, logowania ani wywołań płatnych modeli. Zadanie dotyczy researchu; wyniki runtime i równoległość dwóch kont są oznaczone unverified.
- Nie potwierdziłem kompletnego schematu resetów Claude rate_limit_event, gwarancji snapshotu limitów w każdym rollout Codex ani stabilnego email/org dla każdego CLI. Dokument wskazuje bezpieczne źródła metadata i braki.
- Nie ustaliłem dokładnego wydania usuwającego full-auto lub chat wire. Brak flagi i odrzucenie chat potwierdza kod 0.160.1; dokładna granica 0.160 pozostaje unverified.
- Nie potwierdziłem wyłącznego ładowania dokładnie wybranego zestawu skillów na każdej platformie i przy wszystkich źródłach konfiguracji. Potrzebny jest test i ADR implementacyjny.

## Assumptions
- Punktem odniesienia są wersje dostępne 2026-10-06: [Claude Code 2.1.292](https://github.com/anthropics/claude-code/releases/tag/v2.1.292), [Codex 0.160.1](https://github.com/openai/codex/releases/tag/rust-v0.160.1), [Gemini 0.62.0](https://github.com/google-gemini/gemini-cli/releases/tag/v0.62.0).
- workDirs w tabeli oznacza dopuszczenie początkowego katalogu zadania. Ścisła izolacja wszystkich odczytów i zapisów jest osobnym wymaganiem, którego nie dowodzi cwd.
- network opisuje granicę skonfigurowanego sandboxa procesu, nie wszystkie połączenia modelu, hooków i MCP.
- allowedSkillIds jest filtrem ID i hashy biblioteki przed uruchomieniem; natywne nazwy i ścieżki skillów nie są odpowiednikiem tych ID.
- not possible dla maxRunMinutes odnosi się do niepotwierdzonego natywnego limitu całego procesu. Runner może i powinien egzekwować deadline.

## Questions for the architect
- Czy workDirs ma ograniczać wyłącznie start zadania, czy również wszystkie odczyty i zapisy? Druga interpretacja wymaga określonej granicy wykonawczej.
- Czy obowiązkowa autoryzacja runtime ma gwarantować fail closed także przy awarii samego hooka? Obecne natywne zachowanie nie zapewnia takiej gwarancji.
- Czy dla Codex 0.160.1 blokujemy chat-only endpointy w formularzu providera, czy planujemy adapter/proxy Responses?
- Jak traktujemy konta bez potwierdzonego email/org: brak deduplikacji, dodatkowa konfiguracja operatora czy blokada admission?

## Suggested next tasks
- ADR z wersjami CLI, platformami sandboxa, źródłami konfiguracji i dokładnym sposobem izolacji skillów.
- Sanitizowane fixture i smoke testy dla identity, usage, resetów limitów i wznowień sesji.
- Testy hooków: deny, niedostępność API, timeout, crash, zły JSON, puste stderr i narzędzia poza pokryciem.
- Doprecyzowanie capability badge per reguła oraz ograniczenie chat wire dla Codex.
- Projekt runnerowego deadline i anulowania całego drzewa procesów.
