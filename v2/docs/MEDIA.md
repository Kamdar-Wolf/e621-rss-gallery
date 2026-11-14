# Multimediální systém Kamdar Reader 2.0 – galerie a šifrovaná cache

## Aktuální funkce

1. RSS/Atom/JSON Feed parser čte enclosure, MediaRSS, media:group, odkazy na obrazové přílohy i HTML obrázky. U jedné RSS položky uchová nejvýše 32 rozdílných médií v pořadí jejich výskytu.
2. Databáze `entry_media` má pořadí, MIME, typ a případné rozměry. API poskytuje metadata všech příloh pod autorizovanou cestou `/v1/entries/:id/media`; kontroluje skutečný odběr kanálu přihlášeného uživatele.
3. V seznamu se jako náhled vybírá první **obrázek**; ne video ani audio. Počet médií se vrací jako `media_count`.
4. React galerie podporuje procházení příloh, výběrový pás, video/audio přehrávání s nativními controls, obrazový lightbox, přiblížení 2×, ovládání klávesami ve zvětšeném režimu, a samostatný odkaz na originální soubor.
5. Nejde o veřejný proxy server. Online prohlížeč může zobrazit jen přílohy, které přímo umožňuje načíst poskytovatel.

## Individuální offline ukládání obrázků

Po online přihlášení a odemknutí šifrovaného offline trezoru je u obrázku dostupná volba **Uložit obrázek offline**. Uložení proběhne výhradně na výslovnou akci uživatele; nedochází k hromadnému sběru nebo veřejné redistribuci médií.

- Požadavek používá HTTPS, `credentials: omit`, `referrerPolicy: no-referrer` a CORS. Bez souhlasu zdrojového webu se přímé stažení nezdaří. Přesměrování se kontroluje podle výsledné URL.
- Povolené formáty: JPEG, PNG, WebP, GIF a AVIF. Kontroluje se HTTP Content-Type **i hlavička souboru** (magické bajty); HTML přestrojené za obrázek se odmítne. SVG je úmyslně vyloučeno.
- Každý snímek má maximálně **5 MiB**. Čtení HTTP body kontroluje limit průběžně; neomezené stahování do paměti není povolené.
- Soukromá cache má maximálně **120 obrázků** a **48 MiB** na účet v daném prohlížeči. Při překročení limitu se uložení odmítne, neprovádí se svévolné mazání starších souborů.
- Obrázek se ukládá do samostatného IndexedDB object store `media`; používá AES-GCM-256 se samostatným náhodným IV a autentizovanými daty vázanými na uživatelský a příspěvkový UUID. Originální URL a bajty obrázku jsou zašifrované, viditelná zůstávají pouze technická ID a kvótová metadata.
- Po offline odemknutí se soubor dešifruje jen do paměti a vykresluje se pomocí dočasné `blob:` URL. Tyto adresy se po uzavření galerie uvolňují. Trezor ani originální obrázky se nevkládají do veřejné Cache API.
- Uložený soubor lze odebrat zvlášť. Smazání celého trezoru odstraní také mediální cache daného účtu.

## Známá omezení

- Mnoho CDN (včetně některých náhledových služeb) nepovoluje CORS. Pro takové zdroje **offline uložení prozatím není dostupné**. Nutný bude specializovaný serverový downloader se zabezpečenou kontrolou DNS/IP, typů souborů, přesměrování, licence a kvót. Nelze bezpečně použít otevřený fetch proxy.
- Offline se ukládají **výhradně explicitně vybrané obrázky**, nikoli všechna média v příspěvku. Video/audio cache, hromadné ukládání komiksů a archiv originálů jsou samostatné milníky.
- V některých zdrojích může být předán jen malý náhled, nikoli původní soubor. Čtečka nemůže zpětně odvodit originál, pokud ho RSS neposkytuje.
- Vymazání dat prohlížeče, soukromý režim a evikce IndexedDB mohou uložené snímky zničit. Nenahrazuje to zálohu.
- Externí CDN mohou omezovat přístup, licenční podmínky a autorské právo; systém automaticky neobchází žádná omezení.
- Šifrování dat na disku nechrání před malwarem nebo škodlivými rozšířeními v době, kdy je trezor odemčený. Následuje bezpečnostní audit.
- Automatické testy neověřují chování skutečného Firefoxu, Chrome ani Androidu; to je samostatný E2E krok.

## Ověřovací scénáře

`tests/parser.test.ts` testuje vícestránkové MediaRSS skupiny, pořadí a duplicity.
`tests/integration/media-gallery.test.ts` testuje autorizaci, pořadí médií a správný image-only náhled.
`tests/offline.test.ts` testuje šifrované uložení obrázku, opětovné odemknutí, absenci veřejného URL/čitelných bajtů v ciphertextu, mazání a kontrolu MIME a velikosti.
