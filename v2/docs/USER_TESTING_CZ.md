# Uživatelské vyzkoušení Kamdar Reader – 0.1 a 2.0

**Stav k 15. 11. 2026:** Veřejně dostupná je původní galerie a beta čtečka 0.1. Větev `dev/v2-foundation` obsahuje vývojovou 2.0; ta **není veřejně nasazena**. Pro uživatelské testování 2.0 stačí lokální Windows + Docker + Node.js. Test Androidu může probíhat přes USB ADB bez veřejného serveru.

## Verze a očekávání

| Varianta | Adresa | Účty/synchronizace | Offline |
| --- | --- | --- | --- |
| Původní e621 galerie | https://kamdar-wolf.github.io/e621-rss-gallery/ | Ne | Ne, jen RSS |
| Kamdar Reader beta 0.1 | https://kamdar-wolf.github.io/e621-rss-gallery/reader/ | Ne, lokální nastavení/stavy | Omezené funkcemi prohlížeče |
| Kamdar Reader 2.0 | http://127.0.0.1:5173/ po instalaci níže | Ano, přes vlastní API/PostgreSQL | Šifrovaný trezor; v produkčním sestavení funguje PWA shell |

### 1. Veřejná galerie a Reader 0.1

Otevři odkazy výše. U galerie ověř RSS obrázky a odkaz na původní e621. Ve čtečce 0.1 vyzkoušej **Galerie/Karty/Seznam**, vyhledávání, typ obsahu, řazení, **Oblíbené**, **Nepřečtené**, **Číst později**, světlé/tmavé téma a import/export OPML a lokální zálohy. Pak obnov stránku. Stav čtení patří konkrétnímu prohlížeči. Na jiném počítači/telefonu se sám nesynchronizuje.

**Omezení:** cizí RSS zdroje často narážejí na CORS. Neplatí, že všech 37 historických zdrojů už musí v beta 0.1 fungovat.

### 2. Reader 2.0 – Windows 11, uživatelské testování

Potřebuješ **Git**, **Docker Desktop** se spuštěným Docker enginem, **Node.js 22+** a PowerShell. Nic v těchto příkazech nemění veřejnou galerii ani větev `main`.

Otevři PowerShell ve složce, kam chceš projekt uložit:

```powershell
git clone --branch dev/v2-foundation https://github.com/Kamdar-Wolf/e621-rss-gallery.git
cd e621-rss-gallery\v2
Copy-Item .env.example .env
```

Vytvoř vlastní náhodné tajemství pro serverovou relaci (v souboru `.env` nesmí zůstat ukázková hodnota):

```powershell
$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$rng.Dispose()
$secret = [Convert]::ToBase64String($bytes)
(Get-Content .env) -replace '^READER_SESSION_SECRET=.*$', ('READER_SESSION_SECRET=' + $secret) | Set-Content .env
Remove-Variable bytes,secret
```

Spusť databázi, worker a API:

```powershell
docker compose up --build -d
docker compose ps
```

Založ účet `owner` se svým **vlastním heslem o délce minimálně 12 znaků**. PowerShell `Read-Host -AsSecureString` nezobrazuje zadávané heslo:

```powershell
$secure = Read-Host "Heslo pro účet owner" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
    $env:READER_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    docker compose exec -e READER_BOOTSTRAP_PASSWORD api node dist/scripts/create-user.js
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    Remove-Item Env:READER_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
}
```

Volitelně přidej **ukázkový článek pro test rozhraní** (jeden zdroj, jeden příspěvek, dvě testovací URL obrázků; nejde o skutečné obrázky):

```powershell
docker compose exec -e READER_ENABLE_DEMO=true api node dist/scripts/seed-demo.js
```

Nainstaluj webové závislosti a spusť klienta v režimu vývoje:

```powershell
npm install
npm run dev:web
```

Otevři **http://127.0.0.1:5173/**. Přihlas se jako `owner` se svým heslem.

**Uživatelský test:** Otevři ukázkový článek, zkus přepínat přílohy, detail, seznam a galerii, oblíbené a přečtení. Na boční liště zkus **Import OPML** nebo přidej platný veřejný HTTPS RSS zdroj přes **Přidat kanál**; prvotní stažení zajišťuje worker, nemusí nastat ihned. Zdroj se může odmítnout načíst, pokud ho původní server blokuje. Nespouštěj import citlivých RSS do veřejných míst.

### 3. Test offline trezoru a PWA na Windows

Offline režim při novém spuštění prohlížeče musí mít sestavený webový klient se Service Workerem. **Vite `npm run dev:web` Service Worker záměrně neregistruje**.

Ve stejné konzoli ukonči vývojový web pomocí **Ctrl+C**, pak spusť:

```powershell
npm run build:web
npm run preview:web
```

Otevři opět **http://127.0.0.1:5173/**, přihlas se a použij **Zapnout offline články**. Vytvoř samostatné offline heslo (12+ znaků), které **nemusí** být stejné jako serverové heslo. Ověř načtení článku, odhlášení a zobrazení volby **Odemknout offline knihovnu**.

V Chrome otevři DevTools → **Network → Offline** a obnov stránku. Pokud jsou PWA shell a trezor uložené, stránka se otevře a dovolí offline odemknutí. Offline nefunguje přidávání kanálů ani přístup k novým serverovým datům. Obrázky jsou dostupné jen tehdy, když byly dříve **výslovně uloženy offline**.

Po návratu online vypni v DevTools režim Offline. Při neobvyklém chování zkontroluj **Application → Service Workers** a **Application → IndexedDB**. Nevymazávej data prohlížeče, pokud obsahují neodeslané změny nebo důležitý trezor.

### 4. Reader 2.0 na Samsung Android přes USB, bez serveru v internetu

Potřebuješ Windows PC se spuštěným klientem 2.0, USB kabel a oficiální **Android SDK Platform-Tools (ADB)**. Telefon nepřipojuj přes náhodné veřejné tunely ani nezpřístupňuj vývojové porty v routeru.

1. V telefonu aktivuj **Možnosti pro vývojáře** a **Ladění USB**; při připojení potvrď důvěru k vlastnímu počítači.
2. Na Windows nainstaluj platform-tools a otevři PowerShell ve složce s `adb.exe`.
3. Spusť:

```powershell
.\adb.exe devices
.\adb.exe reverse tcp:5173 tcp:5173
```

4. Na PC musí běžet klient na portu 5173 a Docker backend. **V Chrome na Androidu** otevři **http://127.0.0.1:5173/** (ano, stejná adresa; ADB ji propojí s PC).
5. Přihlas se jako `owner` a ověř navigaci, přepínání galerie/seznamu, detail a reakci mobilního rozhraní. Změň „Oblíbené“ na počítači a po synchronizaci zkontroluj stav na telefonu. Lokální offline trezor je na každém zařízení samostatný; online RSS stavy se synchronizují přes společný server.
6. Po testování propojení odstraň:

```powershell
.\adb.exe reverse --remove tcp:5173
```

**Bez ADB reverse samotné `127.0.0.1` na telefonu odkazuje na telefon, nikoli na Windows PC.** Pro testování přes běžnou síť a z různých míst je nutné samostatné bezpečné HTTPS staging nasazení.

### 5. Automatické testy Chromium, Firefox a Android emulace

GitHub Actions spouští pracovní postup **Kamdar Reader v2 – browser E2E**. Používá reálné headless prohlížeče na Linuxu a emulovaný mobilní viewport/touch; není to fyzický test Windows ani Samsung telefonu. Při neúspěchu nahrává diagnostiku včetně screenshotů a Playwright trace.

Lokálně (v samostatné testovací databázi a s připraveným účtem/ukázkovými daty) můžeš spustit:

```powershell
npx playwright install chromium firefox
npm run test:e2e
```

Pro lokální testy je nutné mít běžící backend a **produkční náhled** na http://127.0.0.1:5173/ a testovací účet se shodným heslem nastaveným v proměnné `E2E_PASSWORD`. **Nespouštěj testy proti svému pracovnímu účtu ani produkčním datům.** V CI se vytváří vlastní izolovaná databáze a heslo testovacího uživatele.

### 6. Záloha PostgreSQL a kontrolní obnova bez přepsání dat

Z adresáře `v2` při spuštěném Dockeru vytvoříš zálohu:

```powershell
node scripts/backup-postgres.mjs
```

Záloha se uloží do adresáře `v2/backups/` jako `.dump` (není určena k vložení do GitHubu). Zkopíruj skutečný název z výpisu a ověř obnovitelnost:

```powershell
node scripts/restore-drill.mjs --file "backups/reader-SEM-DOSAD-SKUTECNY-NAZEV.dump"
```

Kontrolní obnova vytvoří **novou dočasnou databázi**, obnoví zálohu, ověří přítomnost základních tabulek a počet uživatelů a databázi odstraní. Původní databázi `reader` nemění. To není náhrada pravidelného šifrovaného zálohování mimo počítač.

Pokud používáš jinou souborovou konfiguraci Compose, lze oběma příkazům předat `--compose compose.production.yml --env-file .env.production`. HTTPS staging však bez vlastního serveru, domény a bezpečnostního zajištění **nezveřejňuj**.

### 7. Po skončení testu

Zastav web v PowerShellu pomocí Ctrl+C. Kontejnery lze zastavit příkazem:

```powershell
docker compose stop
```

**Nepoužívej `docker compose down -v` ani neodstraňuj Docker volumes, pokud chceš zachovat účty, RSS kanály a historii stavů.**

## Co uživatelsky ověřit

- [ ] 0.1 – veřejná galerie funguje a RSS se načte.
- [ ] 0.1 – téma, seznam/galerie, oblíbené a OPML.
- [ ] 2.0 – přihlášení, ukázkový článek a detail.
- [ ] 2.0 – zdroje a skutečný import OPML.
- [ ] 2.0 – více obrázků, galerie a lightbox.
- [ ] 2.0 – přečtení/oblíbené/uložit po aktualizaci stránky.
- [ ] 2.0 – serverové stavy se synchronizují mezi PC a Androidem.
- [ ] 2.0 – offline trezor otevře dříve uložený obsah po restartu.
- [ ] 2.0 – záloha a bezpečná kontrolní obnova.
- [ ] 2.0 – případné chyby mají reprodukovatelné kroky a screenshot.

## Známá omezení

Tato verze je vývojová. Neexistuje veřejná instalace 2.0 ani hotová Android APK. Playwright test Androidu používá **emulované zařízení** na Chromium, nikoli fyzický Samsung. Video/audio se zatím neukládá offline. Použité ukázkové URL obrázků nejsou reálné obrázky a slouží pouze k ověření zobrazovacích komponent; pro přenos skutečných médií vlož vlastní platný veřejný zdroj, který jejich stahování umožňuje.
