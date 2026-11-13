# Kamdar Reader – produktová a technická analýza konkurence
*Stav rešerše: 13. listopadu 2026 · Připraveno pro projekt Kamdar-Wolf/e621-rss-gallery.*

## Cíl
Vybudovat konkurenceschopnou samostatnou čtečku se zaměřením na **obrázkové RSS kanály**, ale s univerzální podporou článků, videí, podcastů, organizace a synchronizace. Výchozí případ: e621 Atom s uživatelsky spravovanými značkami a 37 zdrojů z exportu Inoreaderu.

Nejde o zkopírování ochranných známek, grafiky nebo proprietárního kódu Folo/Inoreaderu. Inspirace se týká **funkcí a pracovních postupů**.

## Srovnání schopností
| Funkce | Inoreader | Folo | FreshRSS | Kamdar Reader 0.1 |
|---|---|---|---|---|
| RSS/Atom | Ano | Ano | Ano | Ano; externí URL jen při povoleném CORS |
| OPML import/export | Ano | Ano | Ano | Ano, lokálně |
| Galerie obrázků | Zobrazení karet | Pictures | Témata/rozšíření | Ano, 3 rozložení |
| Přečteno / oblíbené | Ano | Ano | Ano | Ano, lokálně |
| Číst později / poznámky | Ano | Ano | Oblíbené/tagy | Ano, lokálně |
| Složky a štítky | Ano | Ano | Ano | OPML složky, lokální štítky |
| Fulltextové hledání | Historické vyhledávání | Načtené/indexované | Backend vyhledávání | Jen mezi načtenými položkami |
| Filtry | Ano | Actions | Ano | Klíčová slova, typ, stav, složky |
| Serverová pravidla | Ano | Ano | Základní/rozšíření | Ne |
| Synchronizace zařízení | Ano | Ano | API | Ne |
| Offline čtení | Mobilní cache | Podle klienta | Podle mobilní aplikace | PWA cache pro navštívený obsah |
| Plný obsah článků | Ano | Readability | Podle konfigurace | Zatím pouze obsah RSS |
| Podcast player | Ano | Ano | Klienti | Zatím jen odkaz/příloha |
| AI shrnutí/překlady | Ano | Ano | Rozšíření | Ne |
| Web bez RSS / monitoring | Ano | RSSHub | XPath/scraping | Ne |
| Notifikace | Ano | Ano | Integrace | Ne |
| Sdílení / týmové účty | Ano | Seznamy/integrace | Více uživatelů | Ne |
| API | Ano | Vlastní ekosystém | GReader / Fever | Ne |

### Oficiální zdroje
- Inoreader – katalog: https://www.inoreader.com/features/
- Inoreader – pravidla: https://www.inoreader.com/features/rules
- Inoreader – ceny a limity: https://www.inoreader.com/pricing
- Folo – GitHub a funkce: https://github.com/RSSNext/Folo
- Folo – ceny/limity: https://folo.is/pricing
- Folo Actions: https://github.com/RSSNext/Folo/wiki/Actions
- FreshRSS – dokumentace: https://freshrss.github.io/FreshRSS/en/
- FreshRSS – API a klienti: https://github.com/FreshRSS/FreshRSS

## Současná implementace (v0.1)
**Aplikace:** `public/reader/index.html`, `public/reader/reader.css`, `public/reader/reader.js`.

- Desktop/touch/telefon; sidebar + hlavní přehled + panel detailu.
- Galerie, karty, seznam.
- Přečtené, oblíbené, číst později.
- Řazení podle data/názvu, fulltextové hledání mezi načtenými položkami.
- Výběr médií (obrázky, články, audio, video).
- Klientská pravidla pro vyloučení a zvýraznění frází.
- Poznámky a štítky na jednotlivých položkách.
- Import a export OPML; manuální přidání RSS/Atom zdroje.
- Záloha/obnova lokálního uživatelského stavu do JSON.
- PWA shell, off-line cache návštívených souborů, tmavé/světlé/systémové téma, klávesové zkratky.
- Výchozí zdroj: `../feed.xml`, tedy již funkční e621 kanál s místně uloženými náhledy v `../thumbs/`.
- Původní galerie zůstává dostupná na kořenové adrese.

**Známá omezení této verze:**
1. Křížové RSS domény obvykle neumožňují přímé načítání z browseru (CORS). OPML import zatím znamená import katalogu, nikoli funkční serverový odběr všech 37 kanálů.
2. Stav čtení, štítky a poznámky se ukládají pomocí localStorage. Nejsou sdílené mezi PC a Androidem ani spravované serverem.
3. Neexistují uživatelské účty, dlouhodobý archiv, serverové automatizace, push, AI, full-content extrakce ani mobilní nativní aplikace.
4. Režim offline umožňuje přístup k lokálně již dostupným datům; nezaručuje automatické stažení celého archivu a veškerých obrázků.
5. Běžná webová čtečka nemůže převzít kompletní funkce Folo/Inoreaderu bez dalšího back-endu a provozu.

## Architektura plné verze
Doporučení: **oddělit současný generátor e621 od obecného serverového agregátoru**.

- **Ingest:** fronta pravidelných požadavků s plánovačem, individuálními intervaly, správnými UA, ETag/Last-Modified, dávkováním, retry/backoff, diagnostikou.
- **Parser:** RSS 2.0, Atom, JSON Feed; normalizace titulků, GUID, dat, autorů, příloh, thumbnail, podcast enclosures; bezpečné zpracování HTML a obrázků.
- **Storage:** PostgreSQL pro uživatele/odběry/příspěvky/štítky/filtry/stavy; objektové úložiště jen pro povolené thumbna​ily; index pro hledání.
- **API:** autentizace a sessions (OIDC/MFA), REST/GraphQL pro UI; kompatibilita s Google Reader API pro mobilní klienty; per-user oprávnění a oddělení dat.
- **Rules:** pravidla na serveru, počítání shod, akce read/star/tag/notify/save/webhook, s audit logem.
- **Media:** proxy s ochranou proti SSRF, soukromé cache a respektování oprávnění k šíření obsahu; vysoké rozlišení načítat od zdroje, pokud to dovoluje.
- **Reader UI:** současné Kamdar Reader rozšířit o dlouhou historii, vyhledávání, správu feedů/složek, keyboard-first a pokročilé workflow.

**Rychlejší a bezpečnější varianta backendu:** zvážit nasazení FreshRSS jako hotového agregátoru (Docker), do kterého by se custom UI napojilo přes Google Reader API. FreshRSS řeší základní uživatele, periodické stahování a OPML. Speciální podporu e621 obrázků lze ponechat v samostatné integrační vrstvě. Alternativa: vlastní backend, výrazně dražší na vývoj a test.

## Fáze
### Fáze A: kvalitní čtečka (právě implementována)
Použitelná galerie, detail, lokální stavy, OPML, vlastní vzhled, PWA. Není označována jako plná konkurence SaaS čtečkám.

### Fáze B: funkční univerzální agregátor
Serverový import všech 37 OPML kanálů, DB, historie, robustní parser a image proxy, stav synchronizovaný na všech zařízeních, autentizace, skutečné pravidelné refreshování a monitorovací diagnostika.

**Akceptační testy:** (1) všech 37 zdrojů je založeno, (2) chyba 403 jediného zdroje neblokuje ostatní, (3) dvě zařízení synchronizují hvězdičky a read/unread, (4) e621 galerie načítá lokální náhledy, (5) Reddit/Tumblr/komiksy mají reálné preview nebo je explicitně hlášena příčina absence, (6) zdroje lze přidat/odebrat z UI.

### Fáze C: automatizace a konkurenceschopnost
Pokročilé pravidlo AND/OR, tagy, pravidla podle autora a zdroje, deduplikace, full-text, archiv, TTS, podcast přehrávač, notifikace, integrace a web bez RSS.

### Fáze D: AI a týmové funkce
Shrnutí, překlad, přirozený dotaz nad archivy, denní souhrny, BYOK model, rolové oprávnění a sdílené kolekce. Nutné zvlášť řešit náklady a ochranu dat.

## Provoz, rizika a pravidla
- GitHub Pages je veřejný statický hosting, není to databáze ani bezpečné úložiště soukromých RSS kanálů.
- Veřejná kopie náhledů může narazit na autorská práva a pravidla obsahu GitHubu, zejména u explicitního materiálu. Před produkčním nasazením je vhodnější soukromě kontrolované úložiště.
- Nezapisovat API klíče ani hesla do frontend JS; přístupové tokeny patří na backend.
- Vývojový klon nesmí kopírovat cizí obchodní značky, ochranné grafické prvky nebo nekompatibilně licencovaný kód.

## Další rozhodnutí
Klíčové je zvolit hosting serverové části: vlastní Windows/Docker dostupný přes Tailscale, VPS, nebo managed službu. Bez trvale běžícího serveru nemůže projekt dlouhodobě zaručit parity se službami Inoreader/Folo.
