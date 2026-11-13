# Implementace Kamdar Reader 2.0

## Zahájení
Vývoj probíhá ve větvi `dev-v2`, současná `main` a její GitHub Pages mají zůstat beze změn do úspěšných integračních a E2E testů.

### Etapa 1 – technický základ
- [x] Oddělená vývojová větev
- [x] Docker Compose: PostgreSQL, Redis, API, worker, web
- [x] SQL migrace databáze
- [ ] Autentizované API + synchronizace
- [ ] RSS ingest worker s bezpečnými URL
- [ ] Webový klient a základ grafických komponent
- [ ] Automatické testy a CI
- [ ] End-to-end test v Dockeru se dvěma zařízeními (vyžaduje skutečné běžící prostředí)

### Pozdější etapy
Správa všech OPML zdrojů, archiv, multimédia, pravidla, offline synchronizace, AI, notifikace, bezpečnostní audit a monitoring. Kritéria: `ROADMAP_V2_CZ.md`.

**Poznámka:** Checkbox označuje stav při prvním vytvoření dokumentu, nikoli automaticky aktualizované úkoly.
