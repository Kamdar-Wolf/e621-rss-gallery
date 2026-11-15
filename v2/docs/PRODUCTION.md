# HTTPS staging Kamdar Reader 2.0

**Stav: vývojové nasazení pro omezené testování. Dosud není produkčně auditováno.**

## Architektura
Samostatný compose.production.yml spouští Caddy, Fastify API, worker, PostgreSQL,
Redis a migrace. Pouze Caddy publikuje porty 80 a 443. API, databáze a Redis jsou
přístupné jen v privátní síti Docker. Caddy získává TLS certifikáty a poskytuje
statickou React SPA, PWA shell a reverse proxy z /api do Fastify /v1.

## Předpoklady
- Linux server, Docker Engine/Compose v2 a veřejná DNS doména, jejíž A/AAAA
  záznamy směřují na server.
- Firewall otevřený jen pro nezbytné SSH a TCP 80/443 (+ UDP 443); Fastify 3100,
  PostgreSQL 5432 a Redis 6379 nesmí být přístupné z internetu.
- Pravidelné šifrované zálohy PostgreSQL, ověřená obnova a dostupný monitoring.

## Konfigurace
Ve složce v2 zkopíruj .env.production.example do .env.production.
Nastav READER_DOMAIN, silné náhodné READER_DB_PASSWORD a READER_SESSION_SECRET
a odpovídající READER_DATABASE_URL (heslo v URI musí být URL-enkódováno).
Soubor .env.production je ignorován Gitem, nikdy ho nepublikuj.
Vzorové hodnoty nejsou vhodné pro provoz.

    cp .env.production.example .env.production
    chmod 600 .env.production
    docker compose --env-file .env.production -f compose.production.yml config --quiet
    docker compose --env-file .env.production -f compose.production.yml up -d --build
    docker compose --env-file .env.production -f compose.production.yml ps

Pak vytvoř uživatele pomocí administrátorského příkazu create-user v kontejneru
api s dočasně předaným READER_BOOTSTRAP_PASSWORD. Nikdy nevkládej heslo přímo
do historie shellu. Veřejná URL bude https://<READER_DOMAIN>/.

## Ochrany
- Produkční APP_ORIGIN musí mít HTTPS; Secure/HttpOnly/SameSite cookie,
  přísný Origin a CSRF. Dev bearer token je zakázán.
- Caddy nastavuje HSTS, CSP, zákaz rámcování, nosniff a no-referrer.
- Redis Lua sdílí atomické kvóty mezi instancemi: 40 stahování obrázků
  na účet za 15 minut, 2 současně na účet a 8 na celou instalaci;
  pro login 10 pokusů na zdrojovou IP za 15 minut.
- Při výpadku Redis se stahování a nové přihlášení odmítají (fail closed).
- READER_TRUST_PROXY je zapnuté jen za důvěryhodnou Caddy proxy; API port
  nesmí být současně veřejně publikovaný. Jiná topologie vyžaduje úpravu.
- Redis je soukromý a dočasný. Obsah RSS ani hesla do něj neukládáme.
- API a worker běží bez root práv, s read-only filesystemem a omezenými
  schopnostmi kontejneru.

## Zálohy, obnova a bezpečnostní dluh
Zálohuj PostgreSQL volume pgdata nebo používej pravidelný pg_dump;
obnovitelnost vyzkoušej do samostatného testovacího prostředí.
Caddy data obsahují stav certifikátů. Redis limity se mohou ztratit a při
restartu se znovu inicializují. Offline AES-GCM trezory jsou jen na klientovi
a nemají serverovou kopii; bez hesla je nelze obnovit.

Před každou databázovou migrací proveď zálohu. Pro reálný dlouhodobý provoz
je nutné připnout schválené Docker image digesty, nasadit MFA/passkeys,
monitoring, ochranu Redis ACL, incident response a nezávislý audit SSRF,
XSS, autentizace a síťových pravidel. Neprovedli jsme skutečné E2E testy
Windows/Android ani obnovu produkční zálohy.

**Tento Compose není důkazem, že je veřejné nasazení bezpečné.**
