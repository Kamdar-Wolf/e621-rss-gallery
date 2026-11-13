# Kamdar Reader 2.0 – vývojová aplikace

**Stav:** lokální vývojový prototyp. Původní veřejná RSS galerie ve větvi `main` zůstává funkční a oddělená. Nové funkce jsou ve větvi `dev/v2-foundation`.

## Co v této verzi funguje
- Backend Fastify/TypeScript, PostgreSQL, Docker Compose a RSS/Atom/JSON Feed worker s diagnostikou stahování.
- React čtečka s galerií, seznamem, detailem, přečtenými, oblíbenými a „číst později“.
- OPML import/export přímo z UI, složky, vyhledávání v celé databázi článků.
- Účty vytvářené správcem, přihlášení heslem, zabezpečené odvolatelné relace a ochrana proti CSRF.
- Izolace odběrů a uživatelských stavů mezi účty.
- První synchronizace stavu přečtení, oblíbených a uložených položek: API vrací změny a online klient je kontroluje přibližně každých 20 sekund. Při konfliktu revizí server neprovede tiché přepsání.

**Dosud chybí:** offline fronta změn, synchronizace štítků/poznámek/nastavení, pokročilé zobrazení více obrázků, vlastní mediální proxy, skutečné produkční účty s MFA, zabezpečený provoz na veřejné doméně a testy původních zdrojů na cílovém serveru.

## Spuštění na Windows – lokální vývoj

Požadavky: Git, Docker Desktop, Node.js 22+, npm a PowerShell.

1. Otevři složku `v2` v naklonovaném projektu.
2. Vytvoř vlastní konfiguraci:
   ```powershell
   Copy-Item .env.example .env
   ```
3. V `.env` změň `READER_SESSION_SECRET` na **náhodnou hodnotu alespoň 32 znaků**, nikdy nepoužívej ukázkový text. Můžeš ji vytvořit v PowerShellu:
   ```powershell
   $bytes = New-Object byte[] 48
   [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
   [Convert]::ToBase64String($bytes)
   ```
   Výsledek zkopíruj za `READER_SESSION_SECRET=`. Tento soubor se nepublikuje do GitHubu.
4. Spusť backend a databázi:
   ```powershell
   docker compose up --build -d
   ```
5. Jednorázově nastav heslo uživatele `owner` pomocí PowerShellu tak, aby se nezobrazovalo na obrazovce:
   ```powershell
   $secure = Read-Host "Zvol heslo (alespon 12 znaku)" -AsSecureString
   $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
   try {
     $env:READER_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
     docker compose exec -e READER_BOOTSTRAP_PASSWORD api node dist/scripts/create-user.js
   } finally {
     [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
     Remove-Item Env:READER_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
   }
   ```
6. Spusť nové webové rozhraní:
   ```powershell
   npm install
   npm run dev:web
   ```
7. Otevři **http://127.0.0.1:5173/** a přihlas se jménem `owner` a zvoleným heslem.

Backend má lokální adresu **http://127.0.0.1:3100/health**; web používá Vite proxy `/api` a nemusí ukládat žádné tajné tokeny do JavaScriptu.

### Přidání dalších účtů
Před spuštěním administračního příkazu nastav `READER_BOOTSTRAP_USER` na jedinečné jméno (3–32 znaků, malá písmena, čísla, pomlčka, podtržítko). Použij stejný bezpečný postup pro předání hesla. Volání příkazu se stejným jménem nastaví nové heslo a zneplatní staré relace.

### Provozní a bezpečnostní hranice
- Lokální HTTP režim je určen **výhradně pro důvěryhodný vývojový počítač**. Nepřesměrovávej port 3100 do internetu.
- Produkční režim musí běžet za TLS reverse proxy, s nastavenou skutečnou `APP_ORIGIN`, silným tajemstvím relací, MFA, centrálním rate-limitingem a bezpečnostním auditem.
- Původní vývojový bearer token je ve veřejném nasazení vypnutý a lze jej výslovně použít jen v neprodukčních testech (nastavení `ALLOW_DEV_TOKEN`).
- Cookie používá HttpOnly a SameSite=Strict, změnové požadavky kontrolují Origin i CSRF hlavičku; samotná existence těchto ochran nenahrazuje kompletní bezpečnostní audit.
- Soukromé OPML soubory mohou obsahovat tajné URL; neukládej je do veřejného GitHub repozitáře.
- PostgreSQL heslo v ukázkovém Docker Compose je **pouze pro lokální vývoj**.

## Dokumentace
- [Účty a zabezpečení](docs/AUTH.md)
- [Synchronizace stavů](docs/SYNC.md)
- [RSS stahování a parser](docs/INGEST.md)
- [API](docs/API.md)
- [Grafický systém](design/UI-SPEC.md)
- [Celkový realizační plán](../ROADMAP_V2_CZ.md)

## Automatické testy
Workflow `.github/workflows/v2-check.yml` ověřuje TypeScript, testy validace, autentizaci, databázové migrace a integrační testy, sestavení React webu i Docker obrazu. Zelené CI potvrzuje kontrolované scénáře, **nikoli** dlouhodobou stabilitu veřejného provozu.

## Offline režim (první etapa)

Po výslovném zapnutí offline kopie umí otevřená přihlášená karta při výpadku spojení zobrazit naposledy uložené textové články. Bez ohledu na tuto volbu zařazuje změny přečtení, oblíbených a uložených položek do lokální fronty, aby se neztratily při přerušení připojení. Po obnovení spojení se změny pošlou serveru, který kontroluje revize a případné konflikty. Aplikace ukazuje počet čekajících změn a umožní je vyřešit. Při zapnutí offline kopie upozorňuje, že obsah a adresy zdrojů v IndexedDB nejsou šifrovány. Synchronizace používá generační značky změn a v podporovaných prohlížečích zámek pro více otevřených karet.

**Nejde ještě o plný offline archiv:** po restartu prohlížeče bez internetu není možné bezpečně ověřit relaci; obrázky a video se neukládají. Detaily, zabezpečení a testy: [OFFLINE.md](docs/OFFLINE.md).
