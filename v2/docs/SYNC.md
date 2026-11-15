# Serverová synchronizace stavů — návrh a první implementace

Dvě přihlášení téhož uživatele používají společný stav článků v PostgreSQL. Klient kontroluje změny každých 20 sekund, když je karta viditelná.

## API
- `GET /v1/sync/states?after=<ISO>&afterId=<UUID>&limit=50`
  Vrací uživatelské změny položek od zadaného kurzoru, seřazené podle `updated_at` a `entry_id`.
- `nextCursor` slouží pro pokračování, maximálně 100 položek na stránku.
- `watermark` značí horní mez datového snímku; při poslední stránce klient nastaví kurzor na watermark a maximální UUID, aby další kontrola nevracela stejné změny.
- `PATCH /v1/entries/<id>/state` přijímá například `{"starred":true,"expectedRevision":3}`.
- Server při úspěšném zápisu zvýší `revision` a vrátí nový stav. Pokud mezitím změnilo položku jiné zařízení, odpoví `409` s aktuálním stavem. Tím předchází tichému přepsání novějšího stavu.
- Přihlášený uživatel uvidí jen změny v aktuálně sledovaných zdrojích.

## Omezení
- Nejde o push notifikace; změna se v online klientovi objeví až po dalším 20sekundovém dotazu.
- Není implementovaná **offline fronta úprav** (bez internetového spojení zatím nelze číst a později bezpečně odeslat změny).
- Synchronizují se stav přečtení, oblíbené a číst později. Složky, štítky, poznámky a nastavení budou mít oddělenou synchronizaci.
- U prototypu nejsou zapnuté víceúrovňové oprávnění, MFA, push, ani serverový webhook stream.
- Pokud se ztratí internetové spojení, dotaz se opakuje při další kontrole; neúspěšný zápis se načítá z databáze znovu.
