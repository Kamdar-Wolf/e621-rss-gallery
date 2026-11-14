# Offline režim – šifrovaná knihovna a fronta (vývojová verze)

## Rozsah

- Po online přihlášení je možné vytvořit místní trezor se **samostatným offline heslem** (12–256 znaků). Ukládání soukromých článků do trezoru je dobrovolné.
- V trezoru jsou šifrované RSS titulky, textové souhrny, odkazy na zdroje a **fronta změn přečteno/oblíbené/uložené**.
- Po novém otevření PWA bez internetu lze trezor odemknout offline heslem. Nepovoluje to volání serverových API, přidání kanálu ani stahování nových článků.
- Po online přihlášení a odemknutí trezoru se čekající změny synchronizují. Při HTTP 409 aplikace nabízí řešení konfliktu, nevytváří tiché přepsání.
- Místní fronta má limit 1500 operací na účet; trezor uchovává maximálně 500 nejnovějších RSS položek. Žádné originální obrázky/video/audio se do offline úložiště nestahují.

## Kryptografie

- WebCrypto PBKDF2-HMAC-SHA256 (350 000 iterací), náhodná 128bitová sůl, výsledný neexportovatelný klíč AES-GCM-256.
- Knihovna a fronta používají **oddělené AES-GCM zprávy** a oddělené associated-data identifikátory, oba navázané na UUID uživatele; při každém přepisu se generuje nové 96bitové IV.
- Do IndexedDB se ukládá ciphertext, IV, sůl, označení místního profilu, jeho UUID a časová metadata. Offline heslo a CryptoKey v databázi nejsou.
- Klíč existuje jen v paměti otevřené stránky, zamčením se zahodí. Nesprávné heslo nebo poškozený ciphertext dešifrování znemožní.
- Změny fronty se v jedné kartě serializují. Pokud prohlížeč podporuje Web Locks, serializují se i mezi kartami na stejné doméně.
- Jde o aplikační šifrování dat uložených na disku; nezabrání přístupu škodlivého JavaScriptu, prohlížečového rozšíření ani malwaru k již odemčené knihovně.

## Převod starých nešifrovaných dat

1. Upgrade IndexedDB odstraní staré nešifrované kopie RSS článků z původních vývojových verzí. Tyto kopie se **nepřevádějí**, protože neměly šifrovací heslo.
2. Starší nešifrovaná fronta změn se **neodstraňuje předčasně**. Zůstává v původním úložišti, dokud uživatel nevytvoří nebo neodemkne trezor.
3. Migrace přečte starší čekající změny, sloučí je s případnou již šifrovanou frontou (přednost mají novější zašifrované záznamy) a uloží výsledek pomocí AES-GCM.
4. Až po úspěšném šifrovaném zápisu se smažou nešifrované původní záznamy. Při selhání migrace staré změny zůstanou zachované.
5. Opakované spuštění migrace nevytvoří duplicity. Rozhraní upozorní, pokud stará fronta ještě nebyla převedena.

**Důležité:** Do dokončení migrace mohou být starší změny nadále nešifrované. Na sdíleném počítači je nutné starší instalaci aktualizovat a trezor odemknout.

## Chování při výpadku a odhlášení

- Odemčená offline knihovna slouží pro místní prohlížení a změny bez internetu. Odeslání čeká na obnovení spojení **a online přihlášení**.
- Je-li trezor zamčený, nejsou jeho čekající operace viditelné ani odesílané; online změny je však možné provádět přímo na serveru.
- Běžné online odhlášení odvolá serverovou relaci a zahodí klíč z paměti, ale **ponechá šifrovanou knihovnu i frontu** pro pozdější odemknutí.
- **Smazat offline data** odstraní trezor i frontu tohoto účtu. Při pokusu vypnout offline knihovnu s neodeslanými změnami aplikace odmítne jejich nechtěné smazání.
- Service Worker ukládá pouze aplikaci HTML/JS/CSS pro offline spuštění. API a vzdálené obrázky se necachují. V čistě offline režimu klient nevytváří požadavky na vzdálené obrázky.

## Známá omezení a další testy

- Výstup z RSS není automaticky celý článek. Offline mediální engine, vícestránkové galerie a audio/video budou samostatná etapa.
- Browser může data IndexedDB evikovat; offline trezor proto nenahrazuje plnohodnotnou zálohu. Zapomenuté offline heslo nelze obnovit.
- Lokální jméno uživatele a některá metadata trezoru jsou nezabezpečená. Staré nešifrované změny před migrací mohou zůstat ve starším úložišti.
- Zatím není otestován provoz na skutečném Windows a Androidu. CI používá testovací IndexedDB a PostgreSQL. Výkon 1500 šifrovaných operací ani bezpečnost nebyly nezávisle auditovány.
- Po přerušení síťového požadavku je výsledek zápisu neznámý; klient řeší serverové revize a při konfliktu vyžaduje další ověření. Nejde o garantované exactly-once doručení.

## Automatické kontroly

`v2/tests/offline.test.ts` zahrnuje zamykání a odemykání trezoru, ochranu ciphertextu proti manipulaci, izolaci uživatelů, převod původní nešifrované fronty, ověření jejího odstranění po migraci, zachování rychlých změn během odesílání a konfliktů serverových revizí.
