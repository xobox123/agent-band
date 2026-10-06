# Report 002: UI screens part 2 (skills, groups, people) and decisions update

Status: done

## Summary
Zaktualizowano docs/ui/screens.md do bieżącej specyfikacji projektu. Dodano Skills, Agent groups oraz People and teams, rozszerzono tożsamość i efektywną konfigurację agentów. Dotychczasowe ekrany uzgodniono z decyzjami architekta dotyczącymi kolejki, SSE, audit, budżetów i wersji polityk.

## Done
- Skills: biblioteka, niezmienne wersje i SHA-256, import zip/path/git, preview, przypisania org/group/agent, where-used oraz historyczne Run.skills.
- Agent groups: członkostwo przez Agent.groupIds, polityka grupy, skille i role bindings o zakresie grupy.
- People and teams: użytkownicy, zespoły, bezpośrednie i odziedziczone granty owner/admin/operator/viewer, zakresy org/group/agent i realne authorize().
- Agent details: persona, avatar, grupy, tabela efektywnej polityki z pochodzeniem i pokryciem admission/runtime, skille z wersjami/hashami.
- Logi: rozróżnienie agent.tool_decision od agent.tool_use; Allowed/Denied/Unreported, powody, korelacja i brak fałszywego potwierdzania egzekwowania.
- Board: P0–P3, rank, przeciąganie bez zmiany priorytetu, queued no eligible agent, replay Last-Event-ID.
- Zgodność dotychczasowych sekcji: maxMode i opcjonalne reguły, Run.effectivePolicy zamiast nieaktualnych pól, group target i Task.mode, Organization.timezone, hasSecret/secretUpdatedAt, zakres verify i eksport ze snapshot toSeq.
- Sidebar w kolejności bieżącej specyfikacji, User.status w słowniku, nadal osiem skrótów; usunięto nieaktualny status outbox.
- Sekcja 12 oddziela decyzje zatwierdzone od rzeczywistych pozostałych luk.
- Przegląd źródeł pól, enumów, kompletności wymaganych ekranów i braku zmian poza dwoma dozwolonymi plikami.

## Not done (and why)
- Brak zmian kodu i testów aplikacji, zgodnie z zakresem zadania.
- Nie wdrożono endpointów ani nie sprawdzono możliwości CLI; dokument nie deklaruje niezweryfikowanych możliwości jako działających.
- Nie zmieniono STATUS.md ani inbox/.

## Assumptions
- Zachowano numerację wcześniejszych sekcji; nowe ekrany mają numery 5A, 7A i 9A, zgodnie z kolejnością sidebar.
- Nowe limity pól, import preview/commit i guard ostatniego aktywnego ownera są jawnymi propozycjami; packages/contracts pozostaje źródłem prawdy.
- Konflikt różnych przypiętych wersji jednego skillu nie ma zdefiniowanego rozstrzygania; UI pokazuje konflikt zamiast wymyślać priorytet poziomów.
- Widoki wielu użytkowników są opisane, ale stage 1 nie udaje logowania, zaproszeń ani działającego provisioningu.
- Tabele zastępują wireframe ASCII zgodnie z przyjętym dokumentem 001.

## Questions for the architect
- Jak rozstrzygać różne pinnedVersion tego samego skillu na wielu poziomach przypisania?
- Jaki jest domyślny effective maxMode, gdy żaden poziom nie ustawia ograniczenia?
- Jakie będą payloady pochodzenia reguł, provider capabilities i korelacji tool decisions z RunEvent?
- Jak wygląda kontrakt initial snapshot/high-water cursor i expired replay dla SSE?
- Czy operator może zmieniać rank/priority, a owner istnieć poza zakresem org?
- Jakie są dokładny próg bajtów 5 MB, root bundle, uwierzytelnianie importu git oraz semantyka atomowych zmian członkostwa?

## Suggested next tasks
- Domknąć kontrakty wymienione w sekcji 12, zwłaszcza effective configuration i skill conflict resolution.
- Wdrożyć Skills i effective-policy preview z jawnym runtime coverage.
- Zdefiniować atomowe członkostwo, scope-aware RBAC i spójny snapshot/replay SSE.
