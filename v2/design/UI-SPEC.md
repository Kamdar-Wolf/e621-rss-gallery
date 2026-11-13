# Grafický systém Kamdar Reader 2.0

## Struktura
Desktop: levý sidebar 256 px, hlavní časová osa flexibilní, volitelný detail min. 420 px.
Tablet: dvoupanelový nebo přesouvatelný detail.
Mobil: jedna hlavní plocha, spodní navigace a čtečka přes celou obrazovku.

## Primární obrazovky
1. Onboarding/OPML import a volba zdrojů.
2. Dashboard novinek a stavu zdrojů.
3. Galerie obrázků: masonry / jednotná mřížka / poměr stran, náhledy a lightbox.
4. Článková timeline: seznam / magazín / třípanelový režim.
5. Komiksy: čtení po stránkách / kontinuální režim, ovládání klávesou a dotykem.
6. Podcast a video režim s přehrávačem.
7. Správce odběrů a složek.
8. Editor serverových pravidel, náhled bez provedení a audit.
9. Globální hledání a uložené filtry.
10. Nastavení tématu, soukromí, cache, offline a zařízení.

## Komponenty
AppShell, FeedTree, FeedRow, EntryCard, CompactEntry, ReaderPane, GalleryGrid,
MediaTile, MediaLightbox, FilterBar, TagEditor, RulesEditor, SearchInput,
EmptyState, ErrorState, LoadingSkeleton, ConfirmDialog, Toast, CommandPalette.

## Stavový model
Každý interaktivní prvek musí zvládnout idle, hover, focus-visible, selected, disabled, loading, error, offline. „Nepřečteno“ musí být odlišitelné i bez barev.

## Typografie a rozestupy
System/Inter, text 12/14/16/20/24/32 px, řádkování čtení 1.55–1.75.
Rytmus 4/8/12/16/24/32/48 px, minimálně 44×44 CSS px pro důležité dotykové cíle.

## Kritéria před finální implementací
- Desktop 1440 px, tablet 768 px, mobil 390 px.
- WCAG 2.2 AA; měření kontrastu, klávesový a screen-reader audit.
- Neměnit rozložení při načítání média (reserve size/aspect-ratio).
- Virtualizovaná galerie pro 500+ záznamů, progressive/lazy image loading.
- Uživatel může ovládat velikost textu, hustotu karet, chování animací a zvětšování.
- Jasná vizuální hierarchie mezi zdrojem, titulkem, datem a stavem.
- Vizuální regresní testy screenshotů proti schválenému návrhu.

V `tokens.css` je návrhová paleta, nikoli schválená naměřená kombinace kontrastů.
