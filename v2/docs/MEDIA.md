# Multimediální systém Kamdar Reader 2.0 – galerie a šifrovaná cache

## Aktuální funkce

1. RSS/Atom/JSON Feed parser čte enclosure, MediaRSS, media:group, odkazy na obrazové přílohy i HTML obrázky. U jedné RSS položky uchová nejvýše 32 rozdílných médií v pořadí jejich výskytu.
2. Databáze `entry_media` má pořadí, MIME, typ a případné rozměry. API poskytuje metadata všech příloh pod autorizovanou cestou `/v1/entries/:id/media`; kontroluje skutečný odběr kanálu přihlášeného uživatele.
3. V seznamu se jako náhled vybírá první **obrázek**; ne video ani audio. Počet médií se vrací jako `media_count`.
4. React galerie podporuje procházení příloh, výběrový pás, video/audio přehrávání s nativními controls, obrazový lightbox, přiblížení 2×, ovládání klávesami ve zvětšeném režimu, a samostatný odkaz na originální soubor.
5. Nejde o veřejný proxy server. Online prohlížeč může zobrazit jen přílohy, které přímo umožňuje načíst poskytovatel.

## Individuální offline ukládání obrázků

Po online přihlášení a odemknutí šifrovaného offline trezoru je u obrázku dostupná volba **Uložit obrázek offline**. Uložení proběhne výhradně na výslovnou akci uživatele; nedochází k hromadnému sběru nebo veřejné redistribuci médií.

- Pro přílohy z RSS databáze používá prohlížeč autorizovaný **same-origin download endpoint**. Ten nevyžaduje CORS zdrojové domény. Originální URL vybírá výhradně server z `entry_media`; klient neposílá libovolné externí URL. Případné obrázky mimo databázi se mohou stahovat přímo přes CORS, pokud to zdroj dovoluje.
- Povolené formáty: JPEG, PNG, WebP, GIF a AVIF. Kontroluje se HTTP Content-Type **i hlavička souboru** (magické bajty); HTML přestrojené za obrázek se odmítne. SVG je úmyslně vyloučeno.
- Každý snímek má maximálně **5 MiB**. Čtení HTTP body kontroluje limit průběžně; neomezené stahování do paměti není povolené.
- Soukromá cache má maximálně **120 obrázků** a **48 MiB** na účet v daném prohlížeči. Při překročení limitu se uložení odmítne, neprovádí se svévolné mazání starších souborů.
- Obrázek se ukládá do samostatného IndexedDB object store `media`; používá AES-GCM-256 se samostatným náhodným IV a autentizovanými daty vázanými na uživatelský a příspěvkový UUID. Originální URL a bajty obrázku jsou zašifrované, viditelná zůstávají pouze technická ID a kvótová metadata.
- Po offline odemknutí se soubor dešifruje jen do paměti a vykresluje se pomocí dočasné `blob:` URL. Tyto adresy se po uzavření galerie uvolňují. Trezor ani originální obrázky se nevkládají do veřejné Cache API.
- Uložený soubor lze odebrat zvlášť. Smazání celého trezoru odstraní také mediální cache daného účtu.

## Známá omezení

- CORS blokování pro evidované přílohy řeší autorizovaný serverový downloader; pokud ale původní zdroj požaduje přihlášení, zneplatnil URL, omezuje hotlinking, nebo stahování zakazuje, soubor nemusí být dostupný. **Neobcházíme přihlášení, paywally ani ochrany poskytovatele.**
- Offline se ukládají pouze **obrázky vybrané uživatelem** – jednotlivě nebo pomocí explicitní dávky v jednom příspěvku. Video/audio cache, automatický archiv kanálů a plné texty jiných serverů zůstávají mimo tuto etapu.
- V některých zdrojích může být předán jen malý náhled, nikoli původní soubor. Čtečka nemůže zpětně odvodit originál, pokud ho RSS neposkytuje.
- Vymazání dat prohlížeče, soukromý režim a evikce IndexedDB mohou uložené snímky zničit. Nenahrazuje to zálohu.
- Externí CDN mohou omezovat přístup, licenční podmínky a autorské právo; systém automaticky neobchází žádná omezení.
- Šifrování dat na disku nechrání před malwarem nebo škodlivými rozšířeními v době, kdy je trezor odemčený. Následuje bezpečnostní audit.
- Automatické testy neověřují chování skutečného Firefoxu, Chrome ani Androidu; to je samostatný E2E krok.

## Ověřovací scénáře

`tests/parser.test.ts` testuje vícestránkové MediaRSS skupiny, pořadí a duplicity.
`tests/integration/media-gallery.test.ts` testuje autorizaci, pořadí médií a správný image-only náhled.
`tests/offline.test.ts` testuje šifrované uložení obrázku, opětovné odemknutí, absenci veřejného URL/čitelných bajtů v ciphertextu, mazání a kontrolu MIME a velikosti.

## Serverové stahování pouze autorizovaných příloh

Nový endpoint `GET /v1/entries/:entryId/media/:mediaId/download` vyžaduje uživatelskou session a vrací jediný obrázek, který existuje v `entry_media` daného článku **a jehož RSS zdroj má uživatel odebíraný**. Neexistující nebo nedostupné identifikátory vracejí HTTP 404. Klient **nemůže** zadat vlastní URL pro serverové stahování, endpoint není obecný proxy server.

Downloader:
- Vyžaduje veřejně dostupnou **HTTPS** doménu a standardní port. Blokuje IP adresy zadané přímo v URL, lokální hostname, soukromé/rezervované DNS výsledky a NAT64 cíle podle stávajících pravidel `safe-fetch.ts`.
- Každé přesměrování (nejvýše tři) znovu ověří v DNS a připne ověřenou veřejnou IP ke spojení. Přesměrování z HTTPS na HTTP je odmítnuto.
- Neposílá cookies, přihlašovací hlavičky ani Referer původnímu serveru. Používá časový limit, maximálně 16 KiB HTTP hlaviček, maximálně 5 MiB těla, kontrolu `Content-Type` i signatury souboru. Vylučuje SVG a komprimované transportní tělo.
- Vrací soubor s `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` a `Content-Disposition: attachment`. Stažené bajty **neukládá** na server ani do GitHubu.
- Má **procesové limity** 40 pokusů / 15 minut / uživatel, maximálně 2 současné požadavky na uživatele a 8 současně na instanci API. Při překročení odpovídá HTTP 429. Ve víceinstančním provozu bude nutný sdílený rate limiter (např. Redis).

Při výslovném uložení se binární data stáhnou serverově, následně na klientovi znovu zkontrolují a **zašifrují AES-GCM** místním klíčem. Vzdálený server vidí jen požadavek od RSS serveru, nikoli identitu přihlášeného uživatele (může však identifikovat serverovou IP).

## Dávkové ukládání vícestránkových příspěvků

Tlačítko **Uložit všechny obrázky offline** v detailu s více obrázky spustí po potvrzení postupné ukládání nejvýše 32 obrazových příloh ze současného příspěvku. Již uložené soubory přeskočí, zobrazuje počet úspěšných, přeskočených a chybových položek. Uživatel může další stahování zastavit; právě probíhající požadavek se dokončí. Při dosažení kvóty nebo rate limitu se dávka přeruší. Nepodporuje video/audio a nedělá automatickou archivaci celých kanálů.

**Testy:** `tests/media-download.test.ts` – URL, DNS/IP, redirect, MIME, signatury, velikost a limiter; `tests/integration/media-gallery.test.ts` – přístupová práva a identifikátory médií; `tests/media-batch.test.ts` – pořadí, přeskakování, chyby a stop; `tests/offline.test.ts` – same-origin uložení do zašifrované IndexedDB.
