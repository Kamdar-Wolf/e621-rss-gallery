# e621 RSS galerie – správa a návod

Tento projekt načítá oficiální Atom kanál e621, převádí ho do RSS 2.0 a stahuje **malé náhledy** na GitHub Pages, aby se obrázky zobrazovaly také v čtečkách, které neumí načítat obrázky přímo z e621.

## Nová čtečka Kamdar Reader (beta)

**Otevřít:** https://kamdar-wolf.github.io/e621-rss-gallery/reader/

Jde o první funkční verzi samostatné RSS čtečky. Nabízí galerii, karty a seznam; vyhledávání mezi načtenými články; označení přečteno, oblíbené, číst později; vlastní štítky/poznámky; filtrování podle médií a klíčových slov; zálohy/obnovu a import/export OPML. Má responzivní rozhraní, světlé/tmavé téma a PWA podporu pro offline uložený obsah.

**Omezení beta verze:** Aplikace používá lokální úložiště prohlížeče, takže stav není synchronizovaný mezi zařízeními. Importované externí RSS/Atom kanály mohou být blokované prohlížečovou politikou CORS; nejde zatím o skutečnou serverovou agregaci libovolného množství zdrojů. Plná kompatibilita s Inoreader/Folo bude vyžadovat autentizovaný backend, databázi a pozdější fáze vývoje.

**Kompletní projektový plán pro pokračování vývoje:**
- [Technická a produktová realizace](docs/PLAN_REALIZACE.md) — architektura, databáze, API, servery, bezpečnost, postup etap a přejímka.
- [Grafická a UX/UI specifikace](docs/UI_UX_SPECIFIKACE.md) — design systém, desktop/mobil, 18 obrazovek, galerie, lightbox, přístupnost.
- [Prioritizovaný implementační backlog](docs/BACKLOG.md) — 37 vývojových úkolů s pořadím, závislostmi a testy.
- [Starší výchozí architektonický přehled](READER_ARCHITECTURE.md).

Tyto dokumenty popisují **budoucí požadavky**, nikoli funkce, které jsou už v beta aplikaci hotové.

## Nejdůležitější: změna sledovaných značek

**Jediný soubor, který je potřeba při změně sledovaných autorů či tagů upravovat, je [tags.txt](https://github.com/Kamdar-Wolf/e621-rss-gallery/blob/main/tags.txt).**

1. Otevři soubor **tags.txt** a klikni na ikonu tužky (**Edit this file**).
2. **Přidání:** vlož nový řádek, například `~novy_autor`.
3. **Odebrání:** smaž celý řádek s příslušnou značkou.
4. Klikni na **Commit changes** a potvrď uložení do větve `main`.
5. GitHub Actions automaticky spustí aktualizaci RSS a obrazových náhledů. Průběh najdeš v [Actions](https://github.com/Kamdar-Wolf/e621-rss-gallery/actions).

**Neměň soubory `build_feed.py`, `cache_previews.py` ani `feed.xml` jen kvůli seznamu značek.**

Pravidla pro `tags.txt`:
- Každá značka je na **samostatném řádku**.
- `~` znamená logické **OR** (příspěvek může odpovídat kterékoli uvedené značce).
- Ponech u alternativních značek prefix `~`.
- Prázdné řádky a komentáře začínající `#` se ignorují.
- Až 320 různých značek v této konfiguraci; generátor je rozdělí do dávek max. 40 výrazů, sloučí nejnovější příspěvky a odstraní duplicity.
- Do souboru patří značky, nikoli celá webová adresa.

## Kde se vytváří RSS

1. `tags.txt`: pouze seznam sledovaných značek.
2. `build_feed.py`: načte seznam z `tags.txt`, sestaví adresu `https://e621.net/posts.atom?tags=...` a vytvoří `public/feed.xml`.
3. `cache_previews.py`: stáhne malé náhledy, vloží je do `public/thumbs/` a přepíše adresy obrázků v `public/feed.xml`, aby mířily na GitHub Pages.
4. `.github/workflows/publish.yml`: automatické spouštění a publikování.
5. `public/index.html`: webová galerie.

## Výsledné adresy

- **Galerie:** https://kamdar-wolf.github.io/e621-rss-gallery/
- **RSS pro Folo nebo Inoreader:** https://kamdar-wolf.github.io/e621-rss-gallery/feed.xml

## Aktualizace a kontrola

GitHub Actions se spouští po změnách ve větvi `main`, ručně a podle plánu přibližně jednou za hodinu (17. minuta UTC). Plán se může opozdit. Po změně `tags.txt` stačí počkat na úspěšné dokončení běhu **Publish e621 RSS with image previews**.

Chyby (například HTTP 403 e621, chybějící náhledy nebo selhání publikování) kontroluj v záložce Actions. Při nulovém počtu dostupných obrázků skript odmítne publikovat prázdnou galerii.

**Soukromí a pravidla hostingu:** úložiště je veřejné. Každý může číst seznam značek a zobrazit publikované náhledy. Provoz podléhá pravidlům GitHub Pages a autorským právům autorů. Pokud jsou publikované náhledy explicitní nebo jinak nepřípustné, je třeba pro ně zvolit vhodný hosting.
