# Kamdar Reader 2.0 — foundation (vývojová verze)

**Nejedná se o hotovou produkční čtečku.** Je to první funkční vrstva nové architektury navazující na Kamdar Reader 0.1. Současná webová galerie na `main` zůstává beze změny.

## Co je obsaženo
- PostgreSQL s tabulkami pro zdroje, odběry, položky, média, uživatelské stavy, poznámky a štítky.
- Fastify/TypeScript API: `GET /health`, `GET /ready`, `GET /v1/feeds`, `POST /v1/feeds`, `GET /v1/entries`, `PATCH /v1/entries/:id/state`.
- Jednouživatelská autentizace přes `Authorization: Bearer <READER_API_TOKEN>` (dočasně jen pro vývoj).
- Docker Compose pro PostgreSQL, Redis, databázové migrace, API a worker. Přístupové porty jsou pouze na 127.0.0.1.
- SQL migrace a automatické testy validace schémat; CI kontrola TypeScriptu.
- Design tokeny a specifikace budoucího UI.

**Implementováno:** parser RSS/Atom/JSON Feed, ověřovaný síťový fetcher, serverový poller, uložené příspěvky a diagnostika, import OPML pomocí CLI. **Zbývá:** přihlašovací obrazovka, synchronizace produkčního klienta, správa více uživatelů a mediální cache. API běží pouze lokálně, není veřejně publikováno.

## Lokální spuštění (vývoj)

### Kompletní Docker stack

Po vytvoření souboru `.env` podle `.env.example` nastav `READER_API_TOKEN` jako náhodný řetězec s alespoň 32 znaky. Použití vzorového tokenu je blokováno. Potom z adresáře `v2` spusť:

```bash
docker compose up --build -d
```

API bude dostupné na `http://127.0.0.1:3100/health`. Databáze, migrace i worker se spustí v rámci Compose. **Přístupný jen na lokálním počítači; nejedná se o produkční bezpečné nasazení.**

### Ruční spuštění bez API kontejneru
Požadavky: Docker Desktop, Node.js 22.12+ a npm.

```bash
cd v2
docker compose up -d
npm install
cp .env.example .env
```

Ve Windows se `.env.example` kopíruje na `.env` pomocí Průzkumníka nebo PowerShell:
```powershell
Copy-Item .env.example .env
```

V `.env` nastav náhodný `READER_API_TOKEN` alespoň 32 znaků. Výchozí DB heslo `reader_dev_only` je určeno pouze pro počítač vývojáře; nikdy pro server přístupný z internetu. Proměnné `.env` musí být načteny do procesu (např. `node --env-file=.env` nebo prostřednictvím shellu). Pro příkazy níže lze použít:

```bash
node --env-file=.env --import tsx scripts/migrate.ts
node --env-file=.env --import tsx apps/api/src/server.ts
```

Připojení dostupné výhradně na `127.0.0.1:3100`. Kontrola:
```bash
curl http://127.0.0.1:3100/health
```

Příklady zabezpečených endpointů jsou uvedeny v `docs/API.md`.

## Bezpečnostní hranice
- API používá **vývojový jeden účet a jeden token**. Není to hotové přihlašování se správou relací, MFA ani multi-tenant autorizace.
- Nezpřístupňovat port 3100 na internetu. Pro vývoj je vázán na loopback.
- Konfigurovat CORS jen pro důvěryhodný klientský origin.
- Backend neprovádí HTTP GET na URL uložené v `feeds`, dokud nebude dodán bezpečný worker s ochranou proti SSRF.
- Migrační skript nepoužívat souběžně ve více instancích.
- Pro další iteraci je nutná revize DB vazeb štítků a uživatelských oprávnění, bezpečnostní testy a OIDC.

## CI
Na vývojové větvi probíhá TypeScript typecheck a unit testy. Databázové integrační testy přibudou v další etapě.

## Další navazující úkoly
1. Serverový fetcher s DNS/IP validací, ochranou proti SSRF, limity a backoff.
2. RSS/Atom/JSON Feed parser a datové importy všech 37 původních kanálů.
3. Frontend React/TypeScript v `v2/apps/web` s design tokeny a bezpečným přístupem k API.
4. Web autentizace a synchronizace mezi Android/Windows.
5. Galerie/komiksy/podcasty a serverové automatizace.

Detailní celkový plán: `../ROADMAP_V2_CZ.md`.


## Nový frontend React (lokální vývoj)

V `apps/web` je první grafický klient pro nové API. Běží samostatně na `http://127.0.0.1:5173/` a umí zobrazit odběry, položky, obrázkovou galerii, seznam, stav přečtení, hvězdičky, uložené příspěvky, statistiky, vyhledávání mezi načtenými položkami, přidat či odebrat zdroj a požádat worker o obnovení.

Po spuštění Docker stacku v adresáři `v2` a instalaci npm balíčků:

```bash
npm run dev:web
```

Pro přístup zadej hodnotu svého vývojového `READER_API_TOKEN` z lokálního `.env`. Token je pouze v paměti otevřeného klienta (po opětovném načtení stránky je nutné jej zadat znovu). **Není určen pro veřejnou webovou aplikaci ani pro sdílení.** Po změnách v backendu jej bude potřeba nahradit bezpečným session přihlášením.

```bash
npm run build:web
```

Sestavení ověřuje, že UI lze přeložit a připravit ke statickému publikování. Nesmí se však nasazovat do veřejného hostingu bez produkční autentizace a správného backendu.


## Import/export OPML přímo v aplikaci (vývojová verze 2.0)

V levém panelu **Zdroje** jsou tlačítka **Import OPML** a **Export OPML**.

- Import podporuje XML OPML včetně vnořených složek a automaticky vynechá duplicitní odběry.
- Import je transakční: pokud databázový zápis selže, import se vrátí zpět.
- Limit importovaného souboru z UI je 190 kB (API přijímá do 200 kB).
- Export ukládá soubor `kamdar-reader.opml` do počítače. **Pozor:** může obsahovat soukromé URL a přístupové tokeny ve zdrojových adresách – neposílat jej do veřejného repozitáře.
- Jde stále o jednouživatelskou místní vývojovou instanci. K nasazení přes internet bude nutné nahradit vývojový bearer token bezpečnými účty a relacemi.

API:
- `POST /v1/opml/import` s JSON `{"opml":"<opml ...>..." }` vrací počet nových a existujících odběrů.
- `GET /v1/opml/export` vrací `{"filename":"kamdar-reader.opml","xml":"..."}`.
- `GET /v1/folders` vrací složky importované z OPML.

Všechny tři endpointy jsou autorizované stejným vývojovým tokenem jako zbytek API.

## Serverové vyhledávání článků

Pole Hledat v React klientovi po zadání alespoň dvou znaků posílá dotaz na `GET /v1/search` (300 ms debounce). Výsledky jsou načítány z PostgreSQL, tedy i ze starších příspěvků mimo první načtenou stránku. Podporuje stránkování po dávkách do 100 položek a omezení na konkrétní zdroj.

Limitace: Prohledává se uložený titulek a textový souhrn, nikoli automaticky kompletní obsah cizího webu. Česká morfologie, zvýraznění úryvků a složité uživatelské dotazy jsou další plánované kroky.
