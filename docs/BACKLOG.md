# Kamdar Reader — implementační backlog a milníky
**Verze 1.0 • 13. 11. 2026**. Vstupy: PLAN_REALIZACE.md a UI_UX_SPECIFIKACE.md.
**Značení:** P0 = nezbytné pro produkt v1.0; P1 = diferenční funkce; P2 = budoucí rozšíření. Závislost v hranatých závorkách; DoD = definice dokončení v hlavním plánu.
**Pravidlo scope:** nejprve dosažení všech akceptací 1.0, teprve pak AI a velké integrace.

| ID | Prio | Modul | Implementace | Akceptační test | Závislost |
|---|---|---|---|---|---|
| KR-001 | P0 | Audit | Zmrazit stávající verzi, inventura JS/CSS/Python/Actions a výpis regresních scénářů | možnost vrátit starou galerii i tags.txt | — |
| KR-002 | P0 | Data | Založit testovací katalog 37 feedů; 403/404/private tagované | každý má stav, HTTP a důvod | 001 |
| KR-003 | P0 | Architektur | Vyhodnotit pilot FreshRSS vs vlastní ingest na 6 různých zdrojích | písemné rozhodnutí, kvalitativní matice | 002 |
| KR-004 | P0 | Infra | Docker Compose /api /worker /postgres; secrets a oddělené volumes | zelené health checky, restart bez ztráty dat | 003 |
| KR-005 | P0 | DB | Schema users, feeds, subs, folders, entries, media, states, sessions | migrace up/down, test unikátních klíčů | 004 |
| KR-006 | P0 | Auth | Vlastní účet, přihlášení, logout, session, role | žádné cross-user čtení dat, revoked session | 005 |
| KR-007 | P0 | Ingest | RSS/Atom/JSONFeed parser + fixtures, fetch scheduler | zpracování všech typů, žádné duplicitní GUID | 005 |
| KR-008 | P0 | Ingest | ETag, Last-Modified, retry, respekt rate limitů, diagnostika | 304 bez duplicit, 403 neblokuje ostatní | 007 |
| KR-009 | P0 | E621 | e621 tagy jako webově editovatelná konfigurace | uživatel bez kódu přidá/odebere tag, validace limitu | 007 |
| KR-010 | P0 | Media | Thumbnail resolver z feedů, secure image worker, cache | ověřené přípustné obrázky v galerii, jasná chyba u selhání | 007 |
| KR-011 | P0 | API | Feeds, folders, entries, search, states, OpenAPI | kontraktní API testy v CI | 005,007 |
| KR-012 | P0 | OPML | Import wizard s preview, duplicity, import report, export | import 37 odkazů se stavem, žádné tiché selhání | 011 |
| KR-013 | P0 | Sync | Stav přečtené/hvězdy/uložené, cursor sync, offline queue | stav na PC a mobilu shodný po sync | 006,011 |
| KR-014 | P0 | Search | Postgres fulltext + cursor pagination | 100k fixture položek, filtrování a rychlé stránkování | 011 |
| KR-015 | P0 | UX | Design tokens, typografie, grid, responsive, a11y komponenty | dark/light, mobile, WCAG audit | — |
| KR-016 | P0 | UI | React shell, sidebar, topbar, tri-pane, list/cards | zobrazení a vyhledávání bez regresí | 015,011 |
| KR-017 | P0 | Gallery | Mřížka, masonry, lightbox, komiks, GIF, multi-image | navigace 1–2 kliky, správné poměry, fallback | 010,015 |
| KR-018 | P0 | Reading | Sanitizovaný obsah, notes, tags, star/read/save | uložené stavy přes API, XSS testy | 011,016 |
| KR-019 | P0 | Health | Stránka stavu zdrojů, diagnostika obrázků, retry | každá chyba má název, čas a opravnou cestu | 008,010 |
| KR-020 | P0 | Offline | PWA shell a lokální DB, offline označení, sync status | přechod offline/online bez ztráty změn | 013,016 |
| KR-021 | P0 | Security | SSRF, sanitizace, CSRF, CSP, limitery, audit | OWASP test matrix, žádný kritický nález | 004–020 |
| KR-022 | P0 | Operations | Backup/restore, observability, rollback, staging/prod | obnovovací test a bezchybný release | 004–021 |
| KR-023 | P0 | QA | Playwright e2e desktop/mobile, visual, performance, axe | všechny kritické scénáře v CI a release gate | 015–022 |
| KR-024 | P1 | Dashboard | Konfigurovatelné bloky „Dnes“ | funkční pro zdroje, typy a stavy | 016 |
| KR-025 | P1 | Rules | Serverový trigger/AND/OR/NOT/dry-run/audit | výsledky preview shodné s běžícím pravidlem | 011 |
| KR-026 | P1 | Archive | Dlouhodobá historie, offline archiv, edit history | uložené položky nepřicházejí o text | 014,018 |
| KR-027 | P1 | Search+ | Saved searches, fuzzy matching, highlighting | dotazy s filtrem, složkou a daty | 014 |
| KR-028 | P1 | Audio | Podcast player, queue, resume, enclosure | pozice přehrávání se synchronizuje | 011,013 |
| KR-029 | P1 | Video | Video feeds, bezpečná embed politika, fallback | veřejná media se přehrají/přesměrují | 011 |
| KR-030 | P1 | Notifications | Push/web/desktop s nastavením pravidel | ověřené doručení, rate limits, disable | 025 |
| KR-031 | P1 | Export | Komplexní export, public output feeds z volitelných kolekcí | přístup pouze k explicitně sdíleným | 011,018 |
| KR-032 | P1 | Integration | Google Reader kompatibilní API, mobilní klient test | zvolený klient synchronizuje read/star | 013 |
| KR-033 | P2 | AI | BYOK, summary, translation, privacy controls, metering | souhlas před odesláním dat, cost caps | 018,025 |
| KR-034 | P2 | TTS | Přečtení textů, stav audio, volba hlasu | přístupné bez automatického přehrávání | 018 |
| KR-035 | P2 | Discovery | web bez RSS, newsletter, monitoring keyword | jen povolené a transparentní zdroje | 007,025 |
| KR-036 | P2 | Team | sdílené Boards, role, komentáře, audit | soukromé kolekce nelze číst bez oprávnění | 006,011 |
| KR-037 | P2 | Native | Android/desktop wrapper, notifikace a background sync | ověřeno proti PWA a mobilnímu backendu | 020,030 |

## Kanály práce
- **Serverový blok**: KR-003 → KR-004 → KR-005 → KR-007/008 → KR-011 → KR-012/013 → KR-014 → KR-019/021/022.
- **UX blok**: KR-015 → KR-016 → KR-017/018 → KR-020/023.
- **Integrace**: bloky se spojují přes OpenAPI a testovací fixtury, aby frontend nebyl závislý na nestabilních ručních JSON.
- **Před releasem**: KR-001, KR-002, KR-006, KR-010 a KR-023 jsou povinné brány.

## Povinné konkrétní testy
1. Import 37 kanálů z původního OPML včetně hierarchie; seznam chybových/privátních s vysvětlením.
2. e621 náhledy, 403 fallback, přidání/odebrání tagů bez GitHubu a zachování ostatních tagů.
3. ČT24/Novinky/CHIP vykreslí články, komiksy (TwoKinds/Druids) obrázky, TALK podcast identifikuje audio; pokud zdroj změnil formát, založit specifickou chybu, nikoli zkreslit výsledek.
4. Dvě souběžná zařízení změní star/read, konflikt se vyřeší deterministicky.
5. Offline star/read během ztráty spojení se po připojení dokončí.
6. Load test 100k uložených příspěvků: stránkované vykreslování bez DOM zahlcení.
7. Zadaná URL feedu na 127.0.0.1, 169.254.169.254, vnitřní IPv6, DNS rebinding a redirect do interní sítě je odmítnuta.
8. Import škodlivého HTML se script/onerror nezpůsobí spuštění JS.
9. Backup/restore vrátí složky, odběry, stavy i poznámky; lze měřit integritu dat.
10. Výpadek jediného upstreamu/DB/workeru je hlášen s přiměřenou degradací, nikoli jako prázdná galerie.

## Definition of Ready pro ticket
Každý ticket musí před implementací obsahovat: podrobný scénář, data/fixture, komponentový design či API kontrakt, security & privacy požadavky, testy a dokončovací kritérium.

## Reporting
- Projektová tabule Backlog / Ready / In progress / Review / QA / Done.
- Prioritizovat podle uživatelského dopadu, technické závislosti a rizika, nikoli podle efektního dema.
- Při přejímce zaznamenat commit, testovací prostředí, výsledky a otevřené chyby.
- Samostatně sledovat chybovost zdrojů, media success, API p95, stabilitu, sync latency a dostupnost.

## Další rozhodnutí
**A:** single-user privátní provoz vs veřejná multiuser služba (ovlivní auth, hosting a compliance).
**B:** vlastní modular backend jako primární variantu vs ověřovací FreshRSS adapter.
**C:** kde provozovat server a privátní media (VPS, homelab, spravovaná služba).
**D:** zda má být web/PWA jedinou první platformou (doporučeno), následně Android desktop wrappers.

Před implementací KR-004 není vhodné fixovat konečné hostingové parametry. Zvolit podle dat z pilotního importu a charakteru obrazového obsahu.
