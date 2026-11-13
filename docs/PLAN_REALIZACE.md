# Kamdar Reader — hlavní plán vývoje (technika a produkt)
**Verze dokumentu:** 1.0 — 13. 11. 2026
**Projekt:** Kamdar-Wolf/e621-rss-gallery
**Status:** Schválení architektonického směru zatím pouze návrhem; stávající implementace není tímto plánem změněna.

> Účel: vytvořit univerzální, rychlou a bezpečnou RSS/Atom/JSON Feed aplikaci s kvalitním obrazovým prohlížečem. Funkčně se postupně přiblížit Inoreaderu, Folo a Feedly; vlastní produkt bez kopírování proprietárního kódu či značek.

## 0. Výchozí stav a rozsah
### Co již existuje
- Statický Kamdar Reader 0.1 na GitHub Pages: public/reader/ (HTML/CSS/JS, PWA, lokální stavy).
- e621 export přes build_feed.py: seznam 32 značek v tags.txt, Atom -> RSS.
- cache_previews.py ukládá malé náhledy vedle RSS, protože přímé obrázky z e621 se v některých prohlížečích/čtečkách nenačítaly.
- GitHub Actions zajišťuje automatické generování, nikoli obecný serverový agregátor.
- Původní OPML export obsahuje 37 RSS/Atom kanálů zahrnujících zprávy, hry, podcasty, komiksy, e621/e6AI, Reddit a Tumblr. Ne všechny kanály musejí být veřejně dostupné či stále funkční.
- Stav přečtení, štítky a poznámky žije jen v localStorage. Externí RSS přímo z browseru naráží na CORS.

### Definice rozsahu
**Verze 1.0:** spolehlivé serverové stahování univerzálních RSS, uživatel, kanály/složky, databáze, historie, synchronizace, foto/komiksy, vyhledávání, PWA, export.
**Verze 2.0:** pokročilá pravidla, deduplikace, archivace, rich media, monitoring a robustní integrace.
**Verze 3.0:** AI, personalizace, týmové funkce a velké úložiště.
Nedělat vše najednou. Pro první produkční vydání mají nejvyšší prioritu stabilita, obrázky, synchronizace a ovladatelnost.

## 1. Konkurenční baseline (ověřeno 13. 11. 2026)
**Inoreader**: RSS, web feeds, monitoring, rules, filters, dashboardy, historické vyhledávání, read later, notes/annotations, full content, podcasty, secure image proxy, offline, API, notifikace a output feeds. Oficiálně: https://www.inoreader.com/features/ a https://www.inoreader.com/features/rules.
**Folo**: RSS/Atom/JSON a RSSHub, picture/video/audio/article layout, cross-device sync, AI summaries/translations/briefings, Actions, BYOK, klávesové zkratky, OPML, newsletters, TTS. Oficiálně: https://github.com/RSSNext/Folo a https://github.com/RSSNext/Folo/wiki/Actions.
**Feedly**: oddělení Feeds (průběžný přísun) od Boards (ruční kurátorský výběr), týmová spolupráce, AI Feeds. Oficiálně: https://docs.feedly.com/article/805-feeds-and-boards.
**FreshRSS**: open-source, self-hosted RSS agregátor, mobilní Google Reader API, omezenější Fever API; oficiálně https://github.com/FreshRSS/FreshRSS.
**Miniflux**: alternativní lehký backend s REST API a PostgreSQL; https://miniflux.app/features.html.

### Rozdílová hodnota našeho produktu
1. Obrazová galerie jako rovnocenný režim, nikoli vedlejší zobrazení článků.
2. Diagnostika každého zdroje (200/403/404, stav obrázků, čas poslední úspěšné aktualizace, typ chyb).
3. Pokročilé vizuální přizpůsobení bez CSS programování.
4. Plná exportovatelnost uživatelských dat i pravidel (srozumitelné formáty).
5. Nezávislost na jediné webové službě, možnost soukromého provozu.

## 2. Architektonické rozhodnutí
### Doporučená produkční varianta — modulární monolit
- **Frontend**: React + TypeScript + Vite (PWA); router, TanStack Query a virtualizované seznamy. Komponenty založené na přístupných primitivech (Radix UI nebo obdobně), vlastní design tokeny.
- **Backend API**: TypeScript + Fastify (alternativně NestJS s Fastify adaptérem), OpenAPI schéma, validace JSON schématy, bezpečné session.
- **Database**: PostgreSQL; migrace s Drizzle/Prisma; transakce pro změny stavů a odběrů. Pro první verzi použít PostgreSQL fulltext a trigramy.
- **Job scheduler & worker**: samostatný proces v témže monorepu; tabulka jobů s leasingem nebo pg-boss; při nízkém provozu není nutné zavádět Redis. Přechod na Redis/Valkey teprve podle měření.
- **Media**: privátní S3 kompatibilní objektové úložiště (např. R2) pro přípustné obrázkové náhledy. Metadata v PostgreSQL. Originály rutinně nekopírovat.
- **Reverse proxy**: Caddy/Nginx, HTTPS, rate limiting, CSP a secure headers.
- **CI/CD**: GitHub Actions pro testy, build kontejnery, image scanning, staging release, manuálně schvalované produkční nasazení; no hardcoded secrets.
- **Repo**: monorepo /apps/web /apps/api /apps/worker /packages/ui /packages/types /packages/feed-parser /infra /docs; současný prototyp zachovat jako /legacy-reader do dokončení migrace.
- **Provoz**: první prostředí privátní VPS nebo vlastní stálý Linux host; Docker Compose a persistent PostgreSQL volume. Samotné GitHub Pages produkční backend nenahradí.

**Proč ne postavit vše napevno na FreshRSS:** GReader API dobře řeší základní čtení a synchronizaci, ale ne všechna naše vlastní media metadata, rules, archivy a poznámky. Napevno by vznikla závislost na interním datovém modelu FreshRSS. Lze však připravit pilotní adapter a porovnat jej s vlastním ingest modulem. Rozhodnutí učinit podle testu 37 kanálů a požadavků na média.
**Proč modulární monolit místo microservices:** malý projekt nepotřebuje distribuovanou komplexitu; oddělit pouze worker a úložiště. API rozdělit do jasných domén tak, aby šlo později službu oddělit.

### Směr toku dat
1. Uživatel přidá URL nebo importuje OPML.
2. Validace URL, DNS a přístupových pravidel; detekce zdroje.
3. Scheduler vybere zdroj podle ETag/Last-Modified, priorit a backoff.
4. Worker stáhne a parsuje RSS/Atom/JSON Feed; zařadí do normalizované databáze.
5. Deduplikace podle (feed, GUID) a záložního kanonického URL/hash; verzování oprav článků.
6. Extrakce titulku, autora, perexu, HTML, médií a dostupného náhledu; sanitizace HTML.
7. Bezpečný media worker stáhne dovolený malý náhled a vytvoří varianty velikostí, stav a metadata.
8. Serverová pravidla, vyhledávací index a případné notifikace.
9. API poskytne kurzorově stránkované záznamy, per-user stavy a synchronizační změny.
10. Web/PWA zobrazí články, obrázky, komiksy, audio či video; změny stavů uloží offline do fronty a po připojení odešle.

## 3. Modulová mapa a implementační požadavky

### M01 — Uživatelské účty, oprávnění a soukromí
- Jeden účet jako základ; návrh tabulek od začátku multitenant/per-user.
- OIDC a/nebo passkeys; bezpečná session v httpOnly Secure SameSite cookies, CSRF pro stavové operace; MFA později.
- Uživatel nemá přístup k soukromým odběrům jiného uživatele. Ochrana hesel, rotace a revokace session.
- Při exportu a mazání účtu korektně odstranit osobní stavy a privátní kopie média. Audit přístupu.
**Přejímka**: dva testovací účty nemohou navzájem číst soukromé zdroje ani poznámky, logout revokuje session.

### M02 — Správa zdrojů a OPML
- URL discovery ze zadané webové stránky (alternates), validace feedu, náhled prvních 5 položek a explicitní potvrzení.
- OPML včetně hierarchie složek, aliasů, duplicit, chyb a reportu importu; náhled změn před uložením.
- Přidání/editace/odebrání zdroje a složek, přetahování, hromadné akce.
- Stav zdroje: aktivní, přechodně chybový, vyžaduje autentizaci, zrušený, pozastavený.
**Přejímka**: import všech 37 odkazů z OPML s reportem stavu jednotlivých zdrojů; žádné tiché vynechání duplicit, privátních a 404 kanálů.

### M03 — Robustní stahování / plánovač
- ETag, If-Modified-Since, 304 Not Modified, timeouty, retry s exponenciálním backoff, retry-after, limit frekvence per host.
- Nepřekračovat omezení e621 a dalších zdrojů; správná identifikace User-Agent, zákaz skrytého obcházení API blokací.
- Při 403 přepnout zdroj do diagnostického stavu; ostatní zdroje pokračují.
- Job idempotence, deduplikace v DB, checkpointy a zachování posledního fungujícího stavu.
- Metody diagnostiky: čas posledního 200/304, délka běhu, typ odpovědi, počet nových položek, media failures.
**Přejímka**: přerušení běhu a následný retry nevytvoří duplicity; jediné 403 neodstaví další zdroje.

### M04 — Parser / normalizace obsahu
- RSS 0.9x/1/2, Atom, JSON Feed; více příloh; import standardních podcast media.
- Podpora content:encoded, media:thumbnail/content, enclosure, obrázků vložených v HTML, Open Graph jako opatrná záložní strategie.
- Rozlišení obrazového/článkového/audio/video typu podle příloh a obsahu, s ruční override u zdroje.
- Zachování původního URL, dat publikace, GUID, autora, jazyka, kategorií, obsahových upozornění.
- Bezpečné HTML: odstranění script/event handlerů, omezení iframe, zákaz aktivního vzdáleného kódu.
**Přejímka**: fixture sada pro e621, e6AI, Reddit, Tumblr, TwoKinds, ČT24, Novinky, CHIP, podcast; jednotkové testy parse a snapshoty.

### M05 — Galerie, obrázky a komiksy
- Náhledy napříč zdroji, chytrý výběr image source + náhradní fallback; 3 odlišné galerie:
  1) klasická mřížka s fixním poměrem,
  2) masonry se zachovanými poměry,
  3) chronologický seznam ilustrací.
- Lightbox, full screen, posouvání, zoom na kurzor/pinch, zobrazení rozlišení a mime, volitelné stahování jen tam, kde je oprávněné.
- Multi-image posts, GIF/video animace, comics strip s vertikálním scroll/fit-to-width.
- Možnost skrýt náhled, zapnout rozmazání citlivého obsahu podle úrovně a smazat cache.
- Privátní mediatokeny, nevkládat implicitně externí trackovací obrázky do článku.
- Cache invalidace podle obsahu, neměnit URL při každé aktualizaci bez potřeby.
**Přejímka**: kvalitní náhledy v galerii e621, komiksech a článcích; při zablokování média smysluplná chyba se zdrojovým URL, ne prázdná karta.

### M06 — Knihovna, čtení a vyhledávání
- Jednotné per-user state: read/unread, starred, saved, scroll progress, notes, annotations, tags.
- Třídění, pokročilé vyhledávání a uložené pohledy: datum, autor, zdroj, složka, formát, stav, štítek, fráze, jazyk.
- Fulltext v PostgreSQL s diakritikou pro češtinu, fallback trigram; indexovat titulky, perex a dovolené plné texty.
- Hromadné operace s potvrzením a undo; klávesové zkratky nastavitelné.
- Sledování editací příspěvků a případné porovnání verzí (až 2.0).
**Přejímka**: po označení hvězdičky na telefonu je stejné označení po synchronizaci vidět na Windows; vyhledávání funguje i mimo aktuálně načtenou stránku.

### M07 — Offline a synchronizace
- IndexedDB pro čtené a stažené položky, fronta offline operací, delta API se serverovým kurzorem a číslováním revizí.
- Konflikt read/star/notes: definované chování (stavové akce idempotentní, poznámky s verzí a potvrzeným řešením konfliktu).
- PWA i bez připojení jasně odlišuje aktuální vs archivovaný obsah.
- Offline paket je uživatelsky volitelný, kvóty v MB a automatické promazávání.
**Přejímka**: offline změny přečtení a hvězd se po návratu připojení synchronizují bez duplikátů.

### M08 — Pravidla a monitorování (2.0)
- Rules engine: Trigger (nový/editovaný článěk, ruční uložení), Conditions AND/OR/NOT, Action (mark, tag, save, notify, webhook, export, archive).
- Preview „kolik položek by pravidlo ovlivnilo“ bez skutečného provedení, dry-run + audit.
- Globální pravidla a per-folder/feed výjimky, pořadí pravidel, priority a stop-processing.
- Monitoring celé sady veřejných feedů nebo konkrétních složek; sledování zdrojů bez RSS pouze kompatibilním a povoleným mechanismem.
**Přejímka**: pravidla jsou deterministická a auditovatelná, změna pravidla nevymaže historii.

### M09 — Podcasty, video, články a AI (2.0–3.0)
- Audio player: fronta epizod, rychlost, pozice přehrávání, epizody offline a dokončení.
- Video preview, bezpečné embed nebo přechod na původní stránku; nepřekládat DRM/ochrany za „podporu“.
- Readability extraction textu jako volitelná funkce s respektováním paywallů, práv a robots.
- AI překlad, shrnutí, sumarizace nad více zdroji a BYOK až po stabilním serveru; náklady a explicitní odesílání dat mimo vlastní server.
**Přejímka**: čtečka správně rozpozná a přehraje veřejnou podcast epizodu, u nedostupných formátů nabídne externí otevření.

### M10 — Integrace, API, export
- OpenAPI REST + webhooky, sdílené kolekce později; OPML a kompletní export osobních dat do JSON.
- Integrace na Obsidian, Zotero, Readwise, e-mail a další jako samostatné adaptery.
- GReader API kompatibilita může být strategickou výhodou, ale testovat ji vůči reálným klientům.
- Public output RSS jen pro výslovně zveřejněné kolekce, s oddělením od privátní knihovny.

## 4. Návrh datového modelu (základní tabulky)
| Entita | Zásadní pole / pravidlo |
|---|---|
| users | id, email, display_name, preferences, created_at |
| sessions | user_id, token_hash, expires_at, revoked_at |
| feeds | id, canonical_url, title, site_url, etag, last_modified, last_success_at, next_poll_at, error_state |
| subscriptions | user_id, feed_id, folder_id, alias, notification_level, created_at |
| folders | id, user_id, parent_id, name, sort_order |
| entries | id, feed_id, original_guid, canonical_url, title, author, published_at, fetched_at, excerpt, clean_html, content_type, hash |
| entry_revisions | entry_id, version, changed_at, hash, snapshot_ref |
| media | id, entry_id, source_url, cache_key, storage_ref, mime, width, height, bytes, kind, status |
| entry_state | user_id, entry_id, read_at, starred_at, saved_at, progress, updated_at, revision |
| tags / entry_tags | user-defined tagging per user and entry |
| notes / annotations | user_id, entry_id, body, anchor, created_at, updated_at |
| rules / rule_runs | owner, scope, conditions_json, actions_json, dry_run, audit |
| sync_events | user_id, revision, entity_type, entity_id, operation, happened_at |
| feed_jobs / feed_errors | feed_id, attempt, next_run, status_code, duration_ms, error_kind |
| source_credentials | user_id, feed_id, encrypted_secret_ref, key_version |

**Indexy:** unique(feed_id, original_guid) tam, kde GUID existuje, jinak canonical URL/hash; unique(user_id, feed_id) v subscriptions, composite (user_id, entry_id) ve state; time/foreign key indexy, full-text tsvector, partial index unread.

**Retence:** nové položky držet dle uživatelské politiky; zvlášť metadata a lokálně archivovaný obsah. Žádné mazání uložené položky jen proto, že není v nejnovějších 75 položkách.

## 5. Rozhraní API (kontrakty)
- POST /api/v1/auth/login, /auth/logout, GET /me
- GET/POST /feeds, POST /feeds/discover, GET /feeds/{id}/health, POST /feeds/{id}/refresh
- POST /opml/import-preview, POST /opml/import-commit, GET /opml/export
- GET /entries?feed=&folder=&type=&state=&q=&cursor=&limit=
- GET /entries/{id}, PATCH /entries/{id}/state, POST /entries/bulk
- GET/POST /folders, GET/POST /tags, GET/POST /notes
- GET /sync?cursor=, POST /sync/changes
- GET /media/{id}/thumbnail (autorizovaný přístup)
- GET/POST /rules, POST /rules/preview, GET /rules/{id}/runs
- GET /system/health a interní /metrics; nikoli veřejné diagnostické tokeny.

API kontrakty dokumentovat v OpenAPI, generovat klientské TS typy, používat cursor pagination a idempotency keys u stavových operací.

## 6. Bezpečnost, právní a provozní pravidla
1. **SSRF:** klientské URL nejsou důvěryhodné. DNS validace, blokace loopback/private/metadata IP IPv4 i IPv6, prevence DNS rebinding a validace po redirectech, maximální velikost/timing odpovědí. https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
2. **XSS:** HTML sanitizer, CSP, žádné neověřené vkládání iframe/script, bezpečný markdown a SVG.
3. **Secrets:** API klíče do environment/secret manageru, na klienta nikdy neodesílat přístupové údaje ke zdrojům.
4. **Rate limit:** per origin a per user, backoff, logování chyb bez úniku citlivých adres.
5. **Media:** neoprávněné kopírování originálních obrázků nedělat. Pravidla a práva zdrojů mohou omezit i cachování náhledů.
6. **Obsah pro dospělé:** výchozí soukromé odběry, volitelné rozmazání, explicitní varování, přístup dle právních a hostingových omezení. Veřejný GitHub Pages není vhodný pro produkční archiv explicitního obsahu.
7. **GDPR a ochrana soukromí:** export/delete, minimum logovaných dat, omezení retenčních dob, provozní a bezpečnostní dokumentace.
8. **Provoz:** databázový backup mimo primární stroj, pravidelný obnovovací test, TLS, healthcheck, monitoring, automatická aktualizace zranitelností, rollback posledního releasu.
9. **Licence:** žádné přímé kopírování grafiky ani proprietárního kódu konkurentů. FreshRSS a Folo používají AGPL-3.0 a je třeba zkontrolovat povinnosti při převzetí kódu.

## 7. Etapy realizace a závislosti
### F0 — Konsolidace a průzkum
**Výstupy:** audit současného repa, zálohy, přesun prototypu na oddělenou větev, seznam 37 kanálů se stavy, spike vlastního ingest vs FreshRSS, seznam akceptačních scénářů, UX diagnostika.
**Gate F0:** žádná ztráta současných e621 tagů a náhledů; změřený stav reálných kanálů.

### F1 — Backend foundation
**Výstupy:** Docker Compose, PostgreSQL, auth/sessions, schema, migrace, stahovací worker, API první verze, import OPML, logy.
**Gate F1:** e621 + alespoň 5 různorodých veřejných kanálů se stahují na serveru, stav zdroje je viditelný, jobs jsou idempotentní.

### F2 — Nový UI základ a migrace
**Výstupy:** design system, React/TS komponenty, přístupná navigace, galerie/list/cards, lightbox, čtecí režim, složky/štítky.
**Gate F2:** všechny klíčové scénáře fungují z klávesnice, galerii lze použít na 320–1920px bez horizontálního scrollu UI, obrázky se zobrazují.

### F3 — Univerzální ingest a synchronizace
**Výstupy:** import kompletní OPML, parsovací fixtury, health dashboard, per-user read/star, offline queue, historické hledání.
**Gate F3:** všech 37 zdrojů je evidovaných s důvodem úspěchu/neúspěchu; stav se synchronizuje mezi 2 zařízeními.

### F4 — Release Candidate 1.0
**Výstupy:** QA, automatické testy, PWA instalace, error handling, backup/restore, bezpečnostní revize, staging + produkční nasazení.
**Gate F4:** žádný blokující bug, definované SLO a obnovovací test prošel; mobil i desktop ověřeny.

### F5 — Pro-level 2.0
**Výstupy:** serverové rules, full-content/archiv, pokročilé vyhledávání a uložené dotazy, notifications, podcast/media režimy, export a output feeds.
**Gate F5:** rules s dry-run a auditem, dlouhá historie bez ztráty stavu, měřená odezva vyhledávání.

### F6 — Konkurenční 3.0
**Výstupy:** AI/BYOK, překlady, TTS, monitoring témat, doporučování, týmové kolekce, rozšíření prohlížeče a nativní obaly.
**Gate F6:** náklady na AI měřené a zastropované; bezpečnost a regresní testy všech hlavních funkcí.

## 8. Předběžný backlog priorit
### P0 — bez toho nevydat 1.0
- Serverový ingest, autentizace, DB, OPML, stavy, sync, full-history, kvalitní thumbnails, error handling, backups, hlavní obrazovky, mobil, zabezpečení.
### P1 — zásadní odlišení
- Masonry, comic mode, advanced search, uložené views, rules preview, media diagnostics, offline sync, klávesová ergonomie.
### P2 — další konkurenční funkce
- TTS, AI, podcast playlisty, newsletter inbox, monitoring stránek bez RSS, týmové tabule, integrace.

## 9. Testovací strategie a cílové nefunkční požadavky
| Oblast | Cílová přejímka / test |
|---|---|
| OPML | 37 importovaných kanálů, všechny s jasným stavem; nikdy tiché selhání |
| Parse fixtures | RSS/Atom/JSONFeed, s variantami image/audio/video, chybné XML ošetřeno |
| Duplikáty | 2 po sobě následující refresh bez duplicit |
| Obrázky | >=95 % dostupných a povolených thumbna​ilů pro ověřené zdroje, jinak explicitní chyba |
| Stav čtení | Přečtení a hvězdičky synchronní mezi Windows/Android po připojení |
| Výkon | První interaktivita hlavní stránky orientačně do 2s na běžném broadbandu; API seznamu p95 <400ms na testovacích datech; hodnoty měřit a revidovat |
| Historie | Min. 100 000 testovacích článků při zachování stránkování, indexů a bez dlouhého blokování UI |
| Dostupnost | Pro osobní provoz cílit na 99,5 %, zálohy + obnovovací test; nejde o garantované SLA |
| Přístupnost | WCAG 2.2 AA, klávesnice, čitelný fokus, kontrast běžného textu nejméně 4,5:1 |
| Prohlížeče | Firefox/Chrome/Edge na Windows, Chrome/Samsung Internet na Androidu; mobile 320/375/768, desktop 1280/1920 |
| Bezpečnost | URL SSRF a XSS testy, authz testy, pen-test kritických cest, secret scan |
| Operativa | logy úloh a výpadků, alert při dlouhodobě chybujícím zdroji, jednoduchý rollback |

Test stack: Vitest/Jest (unit), Playwright (E2E vizuální i funkční), API contract tests, fixture based parser tests, load test k6, Lighthouse/axe pro dostupnost a přístupnost. Kritické vizuální regresní snapshoty pro light/dark, telefon/desktop a gallery/list/card.

## 10. Provozní a nákladové scénáře (nikoli nabídka)
**A — soukromý pilot:** linuxový Docker host (vlastní PC/homelab nebo malý VPS), PostgreSQL na stejném serveru, privátní síť/Tailscale, malé objemy media, pravidelná off-host záloha. Výhoda nízké náklady; nevýhoda závislost na vlastním provozu.
**B — samostatná veřejně dostupná služba:** VPS + PostgreSQL + privátní S3/R2 + reverse proxy + domain + monitor + backup. Má opakované náklady a potřebu bezpečné správy.
**C — více uživatelů / SaaS:** oddělení DB a workerů, horizontální scaling, rate limiting, billing, moderace, právní dokumentace, observability, support. Výrazně větší investice.

**Aktuální oficiální orientace cen:** Hetzner CX23 od 5,49 € měsíčně bez DPH a IPv4 (DE/FI, po změně 15. 6. 2026); R2 Standard $0.015/GB-měsíc nad bezplatným pásmem, s poplatky za operace. Nepokrývá doménu, backup, monitoring, případné AI, práci ani daň. Zdroj: https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/ ; https://developers.cloudflare.com/r2/pricing/

## 11. Rizika a rozhodovací brány
| Riziko | Pravděpodobnost / dopad | Opatření |
|---|---|---|
| Některé RSS zdroje vrací 403 / vyžadují login | vysoká / střední | host-specific rate limit, diagnostika, auth pokud je povolená, nepřekračovat blokace |
| Náhledy nejsou dostupné nebo host blokuje hotlink | vysoká / vysoká | povolený thumbnail cache + lokální fallback a explicitní stav |
| Veřejný hosting explicitních obrázků | vysoká / vysoká | oddělit publikovaná metadata od privátních médií, přestěhovat mimo GitHub Pages |
| Běžná čtečka s komplikovaným UI | střední / vysoká | design audit, progresivní odhalování pokročilých funkcí, usability test |
| Práva ke kopírování a ukládání obsahu | vysoká / vysoká | policy per source, omezená retence, právní review před veřejným nasazením |
| Těžká synchronizace offline změn | střední / vysoká | event revision, idempotency, conflict test suite |
| Scope creep AI před stabilitou | vysoká / střední | AI až ve F6, nevytvářet závislost na placeném modelu |
| Lock-in na FreshRSS či cloud službu | střední / střední | adapter interfaces, data export, standardní Postgres/S3, otevřené API |

## 12. Definition of Done pro každou část
- Schválené chování a UX včetně edge cases; dokumentované API/DB migrace.
- Automatické unit + integrační + Playwright testy, bez kritických regressions.
- Přístupnost AA relevantních interakcí, validace na mobilu/desktopu.
- Diagnostika chyby a uživatelsky srozumitelné stavy.
- Dokumentace zálohování, provozu a rollbacku.
- Ruční test v produkčně podobném prostředí s reálnými RSS kanály.

## 13. Konkrétní první kroky po schválení směru
1. Zamrazit prototyp 0.1 jako referenční baseline a vytvořit staging branch.
2. Provést OPML audit všech zdrojů: parser, dostupnost a média.
3. Postavit Docker Compose s API, DB a workerem; připojit e621 a tři různé jiné zdroje.
4. Vytvořit OpenAPI a základ migrace read/star stavu.
5. Zároveň začít design systemem a prvními obrazovkami dle UI_UX_SPECIFIKACE.md.
6. Vyhodnotit pilotní použití FreshRSS adapteru vs vlastní ingest; zvolit jeden dlouhodobý přístup.
7. Před veřejným provozem vyřešit soukromé úložiště explicitních obrázků a licenci/podmínky distribuce.

**Poznámka:** Vymezení verzí je plán, nikoli tvrzení, že funkce již existují. Reálná kapacita týmu a pořadí implementace se určí po první architektonické a datové zkoušce.
