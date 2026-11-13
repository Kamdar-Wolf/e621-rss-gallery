# Kamdar Reader 2.0 — foundation (vývojová verze)

**Nejedná se o hotovou produkční čtečku.** Je to první funkční vrstva nové architektury navazující na Kamdar Reader 0.1. Současná webová galerie na `main` zůstává beze změny.

## Co je obsaženo
- PostgreSQL s tabulkami pro zdroje, odběry, položky, média, uživatelské stavy, poznámky a štítky.
- Fastify/TypeScript API: `GET /health`, `GET /ready`, `GET /v1/feeds`, `POST /v1/feeds`, `GET /v1/entries`, `PATCH /v1/entries/:id/state`.
- Jednouživatelská autentizace přes `Authorization: Bearer <READER_API_TOKEN>` (dočasně jen pro vývoj).
- Docker Compose pouze pro lokální PostgreSQL a Redis.
- SQL migrace a automatické testy validace schémat; CI kontrola TypeScriptu.
- Design tokeny a specifikace budoucího UI.

**Není dosud implementováno:** bezpečné stahování libovolných kanálů z internetu, serverové zpracování RSS, přihlašovací obrazovka, synchronizace produkčního frontend klienta, správa více uživatelů, skutečný media cache backend. Import externích zdrojů v této verzi pouze zapíše adresu do DB. Samotná API služba není publikována.

## Lokální spuštění (vývoj)
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
