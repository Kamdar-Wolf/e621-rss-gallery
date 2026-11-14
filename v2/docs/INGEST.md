# RSS agregátor Kamdar Reader 2.0 – implementační milník

**Vývojová větev:** `dev/v2-foundation`. Nepřesouvat do `main` bez ověření a doplnění autentizace.

## Co bylo doplněno
- Normalizovaný parser RSS 2.0, Atom a JSON Feed s podporou `enclosure` a MediaRSS.
- Bezpečnostní síťový klient, který odmítá interní a vyhrazené IP adresy, DNS přesměrování na interní adresy, neobvyklé porty a HTTPS→HTTP downgrade. IP se pinuje při skutečném síťovém spojení.
- Omezená velikost odpovědi a maximálně čtyři HTTP přesměrování.
- Serverový poller s databázovým zámkem/lease, ochrannými intervaly, ukládáním položek, médii, `ETag` a HTTP 304; provozní stavy 200/304/403/429/500 se ukládají.
- Import OPML se složkami, deduplikací a limitem 1000 zdrojů. Import nikdy nevypisuje URL, které mohou obsahovat tokeny.
- Automatické testy parseru, síťových bezpečnostních omezení a skutečného databázového zápisu.

## Použití po lokálním spuštění API/DB
```bash
cd v2
docker compose up -d
npm install
node --env-file=.env --import tsx scripts/migrate.ts
node --env-file=.env --import tsx scripts/import-opml.ts /cesta/k/exportu.opml
node --env-file=.env --import tsx apps/worker/src/main.ts --once
```

Stálá aktualizace:
```bash
node --env-file=.env --import tsx apps/worker/src/main.ts
```

První import OPML vytvoří odběry, které poller následně stáhne. Ingest cizích serverů může skončit chybou 403/429, pokud omezují automatizovaný přístup. Není garantováno, že všech 37 zdrojů poskytne obsah.

## Aktuální omezení
- Jeden proces stahuje zdroje postupně, bez Redis fronty (dostačující pouze pro malé instalace).
- Žádná veřejná služba ani multiplatformní synchronizace zatím neběží; nová část není napojená na `public/reader/`.
- HTTP odpovědi komprimované gzip/br mimo dohodnutou hlavičku `identity` nejsou podporovány. Zdroj omezující přístup obdrží diagnostický stav a delší čekání.
- Import OPML z lokálního souboru (ne přes UI); složky jsou obnovené v DB.
- Přihlašování nadále používá vývojový jednouživatelský token, nesmí být vystaveno internetu.
- Obsahy HTML se prozatím ukládají jako prostý text, nikoliv plný renderovaný dokument; to snižuje riziko XSS a umožní pozdější sanitizaci.
- Mediální soubory se nestahují, ukládají se pouze odkazy. Cache a multimediální frontend jsou další etapou.

## Bezpečnostní kontrola
Z důvodu SSRF nevpouštěj přímé IP adresy, interní DNS názvy ani speciální porty. Fetcher musí po každém redirectu znovu ověřovat DNS a veřejnou adresu. Převést `/v1/feeds` a `/v1/entries` na skutečné uživatelské sessions až před produkčním nasazením.

## Další milník
1. Backend: přidání/odebrání zdrojů a sledování zdraví z UI.
2. Datové modely pro složky a vícestránkové obrázky.
3. React frontend napojený na API, multi-device autentizace a sync.
4. Mediální cache se schválenou retencí a právními omezeními.
