# Kamdar Reader — UX/UI a vizuální specifikace
**Verze:** 1.0 — 13. 11. 2026
**Návaznost:** PLAN_REALIZACE.md
**Status:** Návrh cílového rozhraní; nejde o již dokončené nové obrazovky.

## 1. Design brief
**Pocit z produktu:** profesionální, rychlý, decentní; obsah je dominantní, rozhraní ustupuje do pozadí. Vizuální úroveň srovnatelná s Folo, hustota/organizace Inoreaderu, ale vlastní identita.
**Primární persona:** intenzivní čtenář obrázkových zdrojů (e621/e6AI/Tumblr/Reddit/komiksy), používá Windows a Android, současně sleduje hry, zprávy a podcasty.
**Sekundární persona:** uživatel s 100+ zpravodajskými a odbornými kanály, potřebuje rychle třídit a automatizovat.
**Pravidlo:** obrazový kanál nesmí vypadat jako textový článek s prázdným rámečkem; články se nesmějí ztratit v galerii.
**Zásady:** dostupnost statusu, minimum kliků, klávesové ovládání, kvalitní stavové hlášky, přehledná hierarchie, nízké kognitivní zatížení.

## 2. Informační architektura (IA)
### Hlavní navigace
- Dnes (personalizovaná domovská obrazovka).
- Všechny položky (sjednocený chronologický stream).
- Nepřečtené, Uložené na později, Hvězdičky, Historie.
- Obrázky, Články, Video, Podcasty a Komiksy (typové pohledy).
- Moje zdroje — složky/kanály, přidej zdroj, OPML, správa tagů e621.
- Kolekce (ručně vytvořené sbírky, později sdílené).
- Automatizace (pravidla a upozornění; v 1.0 skryté feature flag).
- Vyhledávání (včetně filtrů, uložených hledání).
- Nastavení účtu, obsahu, motivů, offline a soukromí.
- Stav zdrojů (health), dostupný ze Správy zdrojů.

**Hierarchie:** Zdroj je kontinuální odběr. Složka je organizační úroveň. Štítek označuje položku napříč zdroji. Kolekce je ručně uložená sada. Uložené vyhledávání představuje virtuální pohled. Neslučovat tyto pojmy.

## 3. Design system
### Barevná identita
Vlastní designová řada „Midnight Slate“, navazující na současnou modrou aplikace, ale s jemnějšími kontrasty.

| Token | Tmavé | Světlé | Význam |
|---|---|---|---|
| --app-bg | #0D111B | #F5F7FA | plátno |
| --surface-1 | #141C2A | #FFFFFF | navigace, panely |
| --surface-2 | #1C2738 | #EEF2F8 | karty a lišty |
| --border | #2A3A4E | #D8E0EB | oddělovače |
| --text-primary | #EDF4FF | #172235 | titulky, tělo |
| --text-secondary | #A8BAD1 | #4C6078 | metadata |
| --accent | #81AFFF | #285AC7 | aktivní prvek |
| --success | #53C59B | #127A55 | úspěch |
| --warning | #F0B668 | #A45A08 | varování |
| --danger | #F07F81 | #B83745 | chyba |

Kontrasty ověřit automatickým token lintem proti WCAG 2.2 AA, barva sama nesmí být jediný nositel významu. Stavová ikona/text vždy doprovází barvu.

### Typografie
- UI: Inter nebo systémový Segoe UI / Roboto, legální a kontrolovaný font stack.
- Text článku: volitelně serif pro dlouhé čtení (Noto Serif nebo systémová), v nastavení.
- Stupnice: 12 metadata / 13 pomocné / 14 standardní UI / 16 čtení / 20 nadpis sekce / 28 hlavní nadpis / 36 detail. Line-height 1.4 UI, 1.65–1.8 článek.
- Čtení: nastavitelná velikost 14–24px, šířka textu 58–76 znaků a řádkování.

### Proporce, hustota, efekty
- Spacing systém 4/8/12/16/24/32px, radius 8/12/16, stíny nízké, žádné nepodložené animace.
- Hustota: Compact / Comfortable / Spacious (výchozí Comfortable).
- Animace 120–200 ms, respektovat prefers-reduced-motion; žádné skákání karet kvůli postupnému načítání obrázků.
- Skeleton zachovává konečné proporce, zobrazuje průběh a přehledné chyby.

### Ikony a komponenty
- Jednotná liniová sada (např. Lucide), velikost 16/20/24; žádné míšení nahodilých emoji do ovládání.
- Komponenty: Button, IconButton, Toggle, Select, Combobox, Tooltip, Dropdown, CommandPalette, Tabs, SegmentedView, FilterChips, FeedRow, FeedStatus, EntryCard, GalleryTile, ArticleRow, Lightbox, Modal, Drawer, Toast, EmptyState, OfflineBanner, Pagination/VirtualList.
- Každá komponenta: default, hover, focus, pressed, disabled, loading, empty, error; klávesová ovladatelnost a ARIA.
- Jednotný visual regression pro každý variant × dark/light × phone/desktop.

## 4. Desktop – hlavní rozvržení
### Standardní čtečka (articles / tri-pane)
- Levý panel 248–280px: logo, rychlé pohledy, složky/kanály a počty, nastavení.
- Prostřední panel 340–440px: seznam položek, přepínač read/unread, řazení, hledání, multiselect.
- Pravý panel zbytek, min. 520px: obsah článku, média, tlačítka star/save/read/tag/note/translate.
- Resizable panes s uložením šířky v profilu; při menší šířce dvousloupcové zobrazení, detail jako drawer.
- Horní lišta: globální hledání, obnovit, indikace synchronizace, akce přidání a avatar.

### Galerie (obrázky / komiksy)
- Při výběru galerie prostřední panel mizí; hlavní prostor převezme obrazová mřížka.
- Tile: thumbnail, zachování poměru stran, volitelné ořezání, číslo víceobrázkového postu, původní autor/zdroj, datum, read/star/save.
- Počet sloupců podle šířky a hustoty: 2 až 7; uživatel může ručně nastavit min. šířku karty.
- Toggle: grid / masonry / filmstrip / textová galerie; filtr velikosti, formátu, zdroje, stavu, autora a NSFW.
- Velké obrázky: detail v bočním lightboxu nebo fullscreen, přiblížení, next/prev, pro komiksy režim fit-to-width a plynulé dlouhé stránky.
- Obrazové skóre: kvalita, původní poměr stran, dostupnost thumbnail vs originál; nikdy nezvětšovat 256px preview na monitor bez možnosti vyššího souboru.

### Informační dashboard „Dnes“
- Nahoře souhrn: nový obsah, nepřečtené, favority, health zdrojů, poslední synchronizace.
- Pod ním konfigurovatelné widgety: nové z oblíbených zdrojů, 8 obrazových náhledů, nejdůležitější články, nové podcasty, chyby v kanálech.
- Drag-and-drop widgetů až po dokončení základu; nepotřebné panely lze skrýt.

### Textový náčrt rozvržení
    ┌───────────────────┬──────────────────────────┬────────────────────────────────────────┐
    │ LOGO / NAVIGACE   │ VŠECHNY ZPRÁVY           │ DETAIL ZPRÁVY / FULL CONTENT           │
    │                   │                          │                                        │
    │ Dnes              │ Hledání / filtry         │ Titulek                                │
    │ Nepřečtené        │                          │ Zdroj, datum, autor                    │
    │ Obrázky           │ ▸ Náhled + titulek       │                                        │
    │ Komiksy           │ ▸ Náhled + titulek       │          Obrázek / článek              │
    │ Podcasty          │ ▸ Náhled + titulek       │                                        │
    │ ───────────       │ ▸ Náhled + titulek       │            Poznámky / štítky           │
    │ Složky a zdroje   │                          │                                        │
    └───────────────────┴──────────────────────────┴────────────────────────────────────────┘

V galerii se střední a pravý panel spojí do široké oblasti, příspěvky se otevřou přes lightbox.

## 5. Mobil – Android-first
- Breakpoint do 767px: spodní navigace s 4–5 hlavními akcemi (Dnes, Kanály, Obrázky, Uložené, Hledat), pokročilé v More drawer.
- 44×44px preferovaná plocha pro dotyk, minimálně WCAG 2.2 AA target 24×24px s předepsanými výjimkami.
- Sticky horní lišta může obsahovat jen titulek a 1–2 akce, ostatní v overflow menu.
- Galerie 2 sloupce při běžné velikosti telefonu, na šířku 3+; nekreslit zbytečně velké textové titulky pod každý obrázek.
- Tap: detail; long press: multiselect; swipe read/star pouze pokud je alternativní dostupná akce tlačítkem.
- Lightbox gesty pinch/zoom, posun, zavření; notifikační a přístupnostní nastavení.
- Použít PWA a až následně přidat Android wrapper (např. Capacitor) nebo nativní aplikaci pro pokročilé background features. Bez serveru push a sync neslibovat.

## 6. Obrazovky – inventář a funkční specifikace
| ID | Obrazovka | Klíčové prvky | Priorita |
|---|---|---|---|
| S01 | Onboarding | jazyk, motiv, připojit účet, OPML import, ukázka | P0 |
| S02 | Dnes | widgety, nové položky, health, přehled | P1 |
| S03 | Všechny zprávy | tri-pane, read/unread, sort, search | P0 |
| S04 | Galerie | grid/masonry, filtry, karty, select, bulk | P0 |
| S05 | Detail článku | full text, obrázky, metadata, anotace | P0 |
| S06 | Lightbox/comic | zoom, next, poměr, full screen, video/GIF | P0 |
| S07 | Zdroje | složky, počty, health, správa | P0 |
| S08 | Add source | URL discovery, preview, potvrdit | P0 |
| S09 | OPML wizard | validace, duplicity, progress, výsledky | P0 |
| S10 | Search | query chips, uložené dotazy, recent | P1 |
| S11 | Pravidla | triggers, AND/OR/NOT, dry run, audit | P1 |
| S12 | Podcast | player, queue, rychlost, epizody | P1 |
| S13 | Uložené/Collections | seznam sbírek, tags, export | P1 |
| S14 | Nastavení | motiv, hustota, offline, účet, soukromí | P0 |
| S15 | Stav zdrojů | poslední HTTP, čas, chyba, počet přijatých | P0 |
| S16 | Notifikace | pravidla upozornění, centrum | P2 |
| S17 | AI | překlad, shrnutí, nastavení API klíče | P2 |
| S18 | Admin | zdraví služby, logy, joby, zálohy | P1 |

### S04 Galerie – detailní interakce
- Filtrování: media, feed/folder, stav, autor, datum, výška/šířka náhledu, dostupnost a případné bezpečnostní štítky.
- Přepínače: „Původní poměr“, „Stejná velikost“, „Masonry“, „Seskupit podle dne“, „Zobrazit názvy“.
- Hover: overlay se zdrojem, ikonami read/star/save; mobil: overflow menu nebo viditelné akce.
- Zdrojové URL a autor po rozkliknutí dostupné i pokud image nefunguje.
- Ukazatel chyb: nedostupný obrázek, CORS/hotlink, nepodporovaný MIME, chybějící cache, chybný soubor. Neskrývat problém obecným placeholderem.

### S06 Lightbox – detailní interakce
- Tlačítka back/next, zoom ±, fit-screen/fit-width/1:1, celé rozlišení, metadata, origin URL.
- Multi-image: mini strip / čítač 2/5, rychlé přechody; GIF/animated WebP a video respektují Reduced Motion/autoplay policy.
- Comic: vertikální plynulé čtení, záložka na stránku, opakovat čtení; při pomalém načítání skeleton a retry.
- Ochrana obsahu: volitelné rozmazání miniatur do explicitního otevření; pravidlo po zdroji/folderu.

### S09 OPML import – detailní průvodce
1. Nahrát XML / vložit URL / připojit známou službu.
2. Náhled: počet zdrojů, složky, duplicity, chyby URL.
3. Vybrat co sloučit, co přejmenovat, co ignorovat.
4. Server zařadí do fronty; jednotlivé stavy progress + možnost odložit.
5. Výsledná zpráva: fungující, blokované, soukromé, chybné, bez obrázků.
6. Pozdější opakování importu nesmí vytvářet duplicitní subscriptions.

### S11 Rules builder – detailní specifikace
- Zvolit „Kdy“ (nový článek/změna/uložení), „Kde“ (složka/zdroj) a skupiny pravidel AND/OR/NOT.
- Akce: označit přečtené, přidat štítek, uložit, notifikovat, webhook, shrnout; s poradcem a validací.
- Náhled posledních 30 výsledků a počet shod, tlačítko Dry run bez mutací.
- Historie vykonaných pravidel, retry a záměrné zastavení zacyklení.

## 7. Uživatelské scénáře k validaci
### Scénář A — každodenní prohlížení e621
Uživatel otevře „Obrázky“ -> vidí okamžitě cache thumbnail -> přepne na nepřečtené -> prochází lightbox -> uloží a přidá štítek -> na mobilu naváže se stejným stavem.
**Cíl:** bez nutnosti otvírat e621 na každý náhled; maximálně 2 interakce k obrázku v plném zobrazení.

### Scénář B — změna e621 značek
Uživatel otevře Zdroj -> Sledované tagy -> přidá/odstraní značku -> systém ukáže náhled vyhledávacího dotazu a počet současných sledovaných tagů -> uloží -> server přepočítá budoucí přísun. Nevyžadovat editaci Python souboru ani GitHubu v cílové verzi.
**Cíl:** dostupné bez technických znalostí; bezpečně validovaný OR query a diagnostika limitů API.

### Scénář C — první import 37 kanálů
Uživatel přetáhne OPML -> uvidí úplnou strukturu složek -> kontrolu duplicit a selhání -> potvrdí -> zdroje se přidávají na backendu -> jeden chybový Reddit kanál neblokuje ostatní.
**Cíl:** 100% transparentnost výsledků.

### Scénář D — práce se zprávami a články
Uživatel otevře Články -> full text -> zvýrazní pasáž -> vloží poznámku -> najde ji později vyhledáváním -> exportuje.
**Cíl:** nadstandardní čtecí režim bez rušivých elementů.

### Scénář E — offline
Uživatel otevře aplikaci bez internetu -> vidí poslední uložený obsah a indikátor offline -> označí příspěvek -> po připojení se změna synchronizuje a případný konflikt je vyřešen jasně.

## 8. Stavy, chyby a důvěryhodnost rozhraní
- Každá stránka: skeleton, empty, empty filtered, partial failure, offline, authenticated expired, inaccessible feed, retry.
- „Žádné články“ nesmí být zobrazeno při výpadku serveru jako validní nula.
- Globální status: synchronizováno / probíhá aktualizace / pouze lokální stav / chyba / offline.
- Feed health: konkrétní HTTP a čas; žádné falešné „všechno v pořádku“ při 403.
- Na chybové kartě zachovat titulek, zdroj, datum a možnost otevření originálu.
- Po hromadné operaci možnost Vrátit zpět, operace serverem idempotentní.
- Při neplatných tagových pravidlech formulář uvede přesný problém.

## 9. Přístupnost a ergonomie
- WCAG 2.2 AA: kontrast běžného textu ≥4.5:1, viditelný focus, klávesová obsluha, žádné pasti fokusu.
- Preferovaná dotyková oblast 44px; přístupnost aktivních ikon, alternativní text obrázku podle dostupných metadat.
- U galerie netvrdit, že autor obrázku je znám, pokud feed atribut neobsahuje.
- Obrázky nejsou jediné nositele významu, hlavní akce čitelné i bez nich.
- Vypínatelné klávesové zkratky, bez kolizí s psaním do formulářů; přístupné oznámení změny.
- Responsive reflow až na 320 CSS px; lightbox lze zavřít Esc i tlačítkem; přiměřená ochrana před blikáním animací.
Zdroj: https://www.w3.org/WAI/WCAG22/quickref/

## 10. Grafická produkční pipeline
1. **UX audit** současného prototypu s heuristikami a seznamem nefunkčních/nejistých míst.
2. **Wireframes low-fi** pro S01–S15 v desktopu/mobilu, navázané na uživatelské scénáře.
3. **Design tokens** v jedné JSON/CSS definici pro frontend i budoucí mobilní aplikaci.
4. **Figma / obdobný nástroj**: components, variants, styles, auto-layout, desktop a mobilní prototyp.
5. **High-fi**: kompletní S03, S04, S05, S06, S09, S14 (kritické cesty), až následně méně používané obrazovky.
6. **Usability test** alespoň 5 lidí s úlohami import, najít obrázek, označit přečtené, přidat tag, obnovit po chybě.
7. **Implementace komponent** se Storybook či obdobným katalogem; propojení props a Design tokens.
8. **Visual regression** a audit světle/tmavě, kontrast, focus, dlouhé názvy, jazyk CZ/EN, rozpadlý feed/obrázek.
9. **Revize pixel-perfect jen tam, kde zvyšuje použitelnost**; důležitější než dekorativní drobnosti jsou přehlednost, rychlost a stabilní layout.

## 11. Měřitelné parametry UX
| Metrika | Předběžný cíl |
|---|---|
| Úspěch importu OPML | import všech validních záznamů se stavem, bez tichých výpadků |
| Načtení úvodní galerie | hlavní skeleton během prvního vykreslení, první obrazovka při běžném broadbandu přibližně do 2s, měřit |
| Navigace ke konkrétnímu kanálu | dostupná do 2 akcí z hlavního rozhraní |
| Otevření obrázku | 1 klik z galerie do detailu, 2 do originálu |
| Správa e621 tags | bez editace zdrojového kódu, bez ztráty ostatních tags |
| Přečtené/oblíbené | stejné stavy na 2 zařízeních po synchronizaci |
| Virtuální seznam | 10k+ položek bez renderování všech DOM karet současně |
| Mobile | žádný nucený horizontální scroll celého UI na 320px |
| A11y | WCAG 2.2 AA kritických cest, bez klávesových pastí |
| Stabilita | žádné chyby JavaScriptu při plném scénáři a migraci |

## 12. Deliverables grafické části
- Design brief a IA diagram.
- Wireframes desktop/mobil pro všechny prioritní obrazovky.
- Figma design kit / knihovna komponent, tokeny ve formátu JSON.
- UI kit varianty dark/light, density 3 úrovně.
- Klikatelný prototyp pro galerii + detail + import + správu zdrojů.
- Komponentový katalog Storybook, responsive matrix a konvence ikon.
- Sada E2E/visual testů + backlog přístupnosti.

## 13. Grafická rizika
- Přílišná inspirace cizími screens: převzít principy, **ne kopírovat chráněnou grafiku, logo a identické detaily**.
- Obrazová galerie s tisíci položkami: pevné placeholdery, virtual scroll, thumb variants, nepřetěžovat GPU.
- NSFW a autorsky chráněný obsah: uživatelská kontrola zobrazení a soukromého úložiště, nenabízet veřejnou galerii implicitně.
- Mnoho ovládacích prvků: progressive disclosure, kontextová lišta a command palette, ne permanentní přeplnění horní lišty.
- Offline/online UX: nikdy neukazovat synchronizaci, pokud probíhá pouze lokální uložení.

## 14. Design kritéria pro finální schválení
Vysoká vizuální kvalita neznamená efekty. Cílové rozhraní je hotové, když:
1. uživatel bezpečně rozezná zdroj, typ položky, dostupnost a přečtení;
2. obrázky a komiksy zůstávají ve správném poměru a ostré;
3. složky a filtry jsou konzistentní napříč desktopem/mobily;
4. import a práce s e621 tags nevyžadují kód;
5. tmavé i světlé téma jsou plně čitelné a přístupné;
6. hlavní scénáře lze provést klávesnicí nebo mobilem;
7. chyby nelžou a vždy vedou k opravitelné akci.

## 15. Vizuální inspirace — zdroje a hranice
- Inoreader nové dashboardy: https://www.inoreader.com/blog/2024/10/the-new-inoreader-experience-is-here.html
- Folo open-source a UX popis: https://github.com/RSSNext/Folo
- Feedly Feeds/Boards: https://docs.feedly.com/article/805-feeds-and-boards
- WCAG 2.2 AA: https://www.w3.org/WAI/WCAG22/quickref/

Tento dokument specifikuje požadovaný design. Výstupní Figma mockupy a vizuální přejímka budou samostatnými úkoly ve fázi F0–F2 a nejsou prohlášeny za hotové.
