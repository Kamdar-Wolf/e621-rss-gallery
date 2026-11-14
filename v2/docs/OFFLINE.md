# Offline režim – první implementace (vývojová verze)

## Co funguje
- Po **výslovném souhlasu** aplikace uchovává v IndexedDB **posledních až 500 článků**, přehled zdrojů a počty položek samostatně pro každé ID uživatele.
- Po výpadku připojení lze v **již přihlášené a otevřené kartě** prohlížet uložené titulky, textové souhrny, zdroje a lokálně filtrovat/vyhledávat v uložených článcích.
- Kliknutí na přečteno, oblíbené nebo uložit vytvoří odolnou lokální frontu změn. Každá položka/akce má jedinečný klíč; opakované přepnutí zruší zbytečný požadavek.
- Po obnovení spojení klient změny odesílá. Každá operace nese očekávanou revizi a aktualizuje pouze **jediné konkrétní pole**, takže nedochází k nechtěnému přepsání jiných příznaků.
- Serverový konflikt HTTP 409 se vyhodnotí: pokud se mezitím změnilo jiné pole, provede se jeden bezpečný rebase; pokud už server má požadovaný stav, položka se považuje za vyřízenou. Při opakovaném konfliktu zůstane položka ve frontě a uživatel se rozhodne „Ponechat server“ nebo „Použít místní volbu“.
- Při odhlášení se aplikace **zeptá před smazáním** offline článků a nedokončených změn; potom smaže lokální data daného účtu.

## Co se ukládá
Při zapnuté offline kopii textová metadata článků, názvy zdrojů a URL obrázků; fronta změn se ukládá nezávisle na volbě cache. **Neukládají se hesla, session cookie ani CSRF token.** Offline data nejsou v této etapě šifrována a mají dostupnost v rámci profilu prohlížeče. Na sdíleném počítači používej jen oddělené uživatelské profily.

## Service worker
Při **produkčním sestavení** (`npm run build:web`) se vygeneruje `dist-web/sw.js` s přesným seznamem statických hashed JS/CSS souborů. Cache API ukládá pouze samotné rozhraní aplikace. **API a média z cizích domén se do Cache API nikdy neukládají.** Bez instalovaného service workeru může offline obnovení stránky skončit chybou prohlížeče.

## Omezení
- **Offline přístup po novém spuštění prohlížeče ještě nefunguje** – relace se musí ověřit online. Tento milník je použitelný při výpadku v *již otevřené přihlášené kartě*.
- **Obrázky, videa a audio nejsou zaručeně dostupné offline**. Cache zatím nezrcadlí cizí soubory ani API obsah.
- Změny se automaticky odesílají pouze z otevřené stránky. Není spuštěn Background Sync na pozadí a nelze garantovat odeslání po zavření karty.
- Fronta má ochranný limit 1500 operací na účet, obsah lokální cache limit 500 příspěvků. Úložiště může prohlížeč smazat, například kvůli úspoře místa.
- Konflikty vidíš v panelu pod horní lištou. Volba „Použít místní“ nemusí okamžitě uspět při další souběžné změně; bude třeba opakovat synchronizaci.
- Offline cache se nepovažuje za bezpečnou osobní zálohu. Pro archiv celých článků a médií bude třeba další backend a nastavit limity retention.

## Testy
`tests/offline.test.ts` používá náhradní IndexedDB v Node.js a ověřuje izolaci účtů, přetrvání fronty, deduplikaci, odesílání po výpadku, slučování jiných revizí a explicitní řešení konfliktů.

## Zabezpečení dodatečně upravené v této etapě
- Lokální kopie osobních článků je nyní **výchozím stavem vypnutá** a lze ji zapnout teprve potvrzením v aplikaci. Vypnutí smaže uložené texty, nikoli neodeslané změny.
- Přechod z vývojové databáze IndexedDB v1 na v2 automaticky odstraňuje staré kopie, které se ukládaly bez souhlasu.
- Fronta má ochranný limit **před** zápisem nové operace, nikoli až po něm.
- Synchronizace používá generační číslo požadavku: změna během síťového odesílání nesmí být omylem odstraněna potvrzením starší verze.

## Milník: Šifrovaná místní knihovna (AES-GCM)

**Nový postup:** Ve čtečce se přihlas online, klikni na „Zapnout offline články“, vytvoř samostatné heslo (12–256 znaků) a potvrď jej. Uložené články se poté šifrují algoritmem AES-GCM-256. Šifrovací klíč se odvozuje pomocí PBKDF2-HMAC-SHA256 (350 000 iterací) z hesla a náhodné 128bitové soli. Každé uložení používá nové náhodné IV a vazbu na identifikátor účtu pomocí AEAD associated data.

Po restartu prohlížeče se na přihlašovací obrazovce zobrazí „Odemknout offline knihovnu“. Vyber místní profil a zadej **offline heslo**. Pokud je statický klient PWA uložen v prohlížeči, lze načíst uložené titulky, RSS souhrny a lokální značky i bez připojení. Odemknutí neobnoví serverovou session cookie a nepovolí operace vyžadující přístup k API.

### Bezpečnostní vlastnosti
- Klíč CryptoKey není exportovatelný, zůstává pouze v paměti aktuálně otevřené stránky. Heslo ani klíč se nezapisují do IndexedDB ani do backendu.
- V IndexedDB jsou nešifrovaně dostupné jen identifikátor místního účtu a jeho zobrazované jméno, sůl, IV a metadata časů. Zbytek článkové knihovny je šifrovaný.
- Staré nešifrované snapshoty z IndexedDB v1/v2 se při upgradu na v3 mažou; **automaticky se nepřevádějí**, protože dříve žádné šifrovací heslo neexistovalo.
- **Fronta změn přečteno/hvězdička/uložit je nadále nešifrovaná** (ID článků, stav, revize). V další etapě je nutné zašifrovat ji také. Nepovažuj aplikaci zatím za úložiště vhodné pro vysoce citlivé informace.
- Při vypnutí offline článků se trezor odstraní; neodeslané změny zůstávají ve frontě. Při úplném odhlášení nebo ručním vymazání dat aplikace maže trezor i frontu.
- Pokud heslo zapomeneš a nemáš původní zdroje dostupné online, obsah trezoru nelze obnovit.
- Heslo volte unikátní a dlouhé. PBKDF2 omezuje, ale nezabrání útoku hrubou silou na slabé heslo.
- Offline režim nezaručuje dostupnost obrázků a videí – obsah je zatím textový. Statický PWA shell musí být před výpadkem alespoň jednou načten v online sestavení.
- Bezpečnostní audit třetí stranou a testy Windows/Android na skutečných zařízeních zatím neproběhly.

### Omezení a navazující práce
Šifrování chrání obsah uložený v místní databázi, ale neřeší kompromitovaný prohlížeč, škodlivá rozšíření, XSS ani nešifrovanou frontu metadat. Přidání originálních médií do offline trezoru bude vyžadovat samostatné limity, politiku obsahu a správu velikostí.
