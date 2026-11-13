# Kamdar Reader 2.0 – spuštění vývojové verze (Windows / Docker)

**Stav:** větev `dev-v2`. Tato verze není zatím publikována na GitHub Pages; vyžaduje běžící databázi a API.

## Co je potřeba
- Docker Desktop s podporou Linux kontejnerů a Docker Compose
- Git + přístup k repozitáři
- Volné lokální porty **5173** (web) a **3000** (API)

## Spuštění na Windows
1. Stáhni větev `dev-v2` z https://github.com/Kamdar-Wolf/e621-rss-gallery/tree/dev-v2 a rozbal ji do vlastní složky.
2. Soubor `.env.example` zkopíruj pod názvem `.env`.
3. V `.env` změň `POSTGRES_PASSWORD` na náhodné heslo a **stejné heslo** uprav také v `DATABASE_URL`.
4. Změň `BOOTSTRAP_TOKEN` na dlouhý náhodný tajný řetězec, který nebude sdílený s nikým dalším.
5. Otevři v dané složce PowerShell a spusť: `docker compose up -d --build`.
6. V prohlížeči otevři **http://localhost:5173**.
7. Při prvním přihlášení vyber **První nastavení**, vytvoř účet se silným heslem (alespoň 12 znaků) a vlož svůj `BOOTSTRAP_TOKEN`.
8. V nabídce **Nový zdroj** můžeš vložit RSS URL nebo importovat OPML export z Inoreaderu.
9. Worker automaticky zpracuje nové kanály. Pokud některý zdroj blokuje stahování ze serveru, zobrazí se stav chyby, nikoli falešný prázdný výpis.

### Příkazy pro kontrolu
- `docker compose ps` – stav služeb;
- `docker compose logs --tail 100 api worker` – poslední chyby agregátoru;
- `docker compose down` – zastavení bez smazání dat;
- `docker compose down -v` – **nevratně smaže lokální databázi a Redis data**. Nepoužívej bez zálohy.

### Bezpečnost
- Vývojová verze naslouchá pouze na `127.0.0.1`. Neotvírej port 3000 ani PostgreSQL veřejně.
- Pro přístup z telefonu v jiné síti bude potřeba zabezpečená privátní síť (např. Tailscale) a vhodné HTTPS/reverse proxy. Pouhé přesměrování portu v routeru je nevhodné.
- Neodesílej soubor `.env` ani přístupové údaje na GitHub.
- `COOKIE_SECURE=false` je dovoleno pouze pro místní HTTP vývoj. Pro produkční prostředí musí běžet HTTPS a `COOKIE_SECURE=true`.
- Po vytvoření prvního účtu je vhodné bootstrap token vyměnit a zachovat mimo veřejné kódy.

## Omezení aktuální etapy
- Zatím jde o vývojový integrovaný základ, nikoli hotový klon Inoreaderu/Folo.
- Synchronizace online funguje pomocí serverové databáze a periodických dotazů; rozsáhlé offline slučování konfliktů, týmové účty, médiální přehrávače, pravidla a AI čekají na další etapy.
- Externí zdroje jsou omezené vlastními pravidly, dostupností a ochranou zdrojových serverů.
- Stará beta verze na GitHub Pages běží nezávisle; nové uživatelské účty a stavy se do ní nepřenášejí.

## Odkazy
- Technický plán: `ROADMAP_V2_CZ.md`
- Specifikace grafiky: `docs/DESIGN_SYSTEM_V2.md`
- Průběh vývoje: `docs/IMPLEMENTATION_LOG.md`
- CI testy: `.github/workflows/v2-checks.yml`
