# Kamdar Reader 2.0 – vývojová aplikace

**Stav:** lokální vývojový prototyp. Původní veřejná RSS galerie ve větvi `main` zůstává funkční a oddělená. Nové funkce jsou ve větvi `dev/v2-foundation`.

## Co v této verzi funguje
- Backend Fastify/TypeScript, PostgreSQL, Docker Compose a RSS/Atom/JSON Feed worker s diagnostikou stahování.
- React čtečka s galerií, seznamem, detailem, přečtenými, oblíbenými a „číst později“.
- OPML import/export přímo z UI, složky, vyhledávání v celé databázi článků.
- Účty vytvářené správcem, přihlášení heslem, zabezpečené odvolatelné relace a ochrana proti CSRF.
- Izolace odběrů a uživatelských stavů mezi účty.
- První synchronizace stavu přečtení, oblíbených a uložených položek: API vrací změny a online klient je kontroluje přibližně každých 20 sekund. Při konfliktu revizí server neprovede tiché přepsání.

**Dosud chybí:** automatizovaná migrace staré fronty bez znalosti offline hesla, synchronizace štítků/poznámek/nastavení, pokročilé zobrazení více obrázků, vlastní mediální proxy, skutečné produkční účty s MFA, zabezpečený provoz na veřejné doméně a testy původních zdrojů na cílovém serveru.

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

## Šifrované offline čtení a fronta změn

Po online přihlášení může uživatel vytvořit **offline trezor** se samostatným heslem (alespoň 12 znaků). Trezor AES-GCM-256 šifruje uložené RSS titulky, texty, odkazy i všechny nově vytvářené offline změny přečtení, oblíbených a uložených příspěvků. Klíč je odvozen PBKDF2-HMAC-SHA256 a není uložený na disk.

Po restartu lze trezor odemknout bez internetu. Odemknutí umožní číst lokální texty a zařazovat další změny do šifrované fronty, **nepřihlašuje ale k serveru**. Po online přihlášení a odemknutí trezoru se fronta opět synchronizuje. Konflikty revizí jsou vyhodnocovány samostatně.

Bez založeného/odemknutého trezoru lze při online přihlášení měnit stavy článků přímo na serveru. Offline změny se **neukládají nešifrovaně**; pro offline úpravy je nutné trezor odemknout.

### Migrace starší offline fronty

Pokud tento prohlížeč obsahuje původní nešifrované změny z vývojové verze, zůstanou v původní IndexedDB až do prvního odemknutí nebo vytvoření offline trezoru. Potom se nejprve zašifrují a po úspěšném zápisu se původní položky odstraní. Rozhraní na čekající migraci upozorní. **Neodstraňuj ručně data prohlížeče, pokud obsahují neodeslané změny.**

Běžné online odhlášení nyní **nesmaže** šifrovanou offline knihovnu ani čekající změny; trezor se zamkne. Pro úplné smazání slouží **Smazat offline data**. Samotná volba pro vypnutí offline článků nepovolí smazání trezoru s čekajícími změnami.

**Omezení:** Nejsou lokálně uložené originální obrázky, videa ani plné texty externích webů. Zobrazují se RSS texty a metadata, která byla dříve načtena. Místní označení profilu/UUID a metadata šifrovaného záznamu zůstávají čitelná. Služba není připravena k veřejnému nasazení. Podrobnosti viz [OFFLINE.md](docs/OFFLINE.md).
