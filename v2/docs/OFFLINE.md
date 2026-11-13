# Offline režim – první implementace (vývojová verze)

## Co funguje
- Aplikace uchovává v IndexedDB **posledních až 500 článků**, přehled zdrojů a počty položek samostatně pro každé ID uživatele.
- Po výpadku připojení lze v **již přihlášené a otevřené kartě** prohlížet uložené titulky, textové souhrny, zdroje a lokálně filtrovat/vyhledávat v uložených článcích.
- Kliknutí na přečteno, oblíbené nebo uložit vytvoří odolnou lokální frontu změn. Každá položka/akce má jedinečný klíč; opakované přepnutí zruší zbytečný požadavek.
- Po obnovení spojení klient změny odesílá. Každá operace nese očekávanou revizi a aktualizuje pouze **jediné konkrétní pole**, takže nedochází k nechtěnému přepsání jiných příznaků.
- Serverový konflikt HTTP 409 se vyhodnotí: pokud se mezitím změnilo jiné pole, provede se jeden bezpečný rebase; pokud už server má požadovaný stav, položka se považuje za vyřízenou. Při opakovaném konfliktu zůstane položka ve frontě a uživatel se rozhodne „Ponechat server“ nebo „Použít místní volbu“.
- Při odhlášení se aplikace **zeptá před smazáním** offline článků a nedokončených změn; potom smaže lokální data daného účtu.

## Co se ukládá
Textová metadata článků, názvy zdrojů, URL obrázků a fronta stavů. **Neukládají se hesla, session cookie ani CSRF token.** Offline data nejsou v této etapě šifrována a mají dostupnost v rámci profilu prohlížeče. Na sdíleném počítači používej jen oddělené uživatelské profily.

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
