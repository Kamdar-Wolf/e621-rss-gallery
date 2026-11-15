# API Kamdar Reader 2.0 – vývojový kontrakt

## Přístup
Prohlížeč používá **same-origin** `/api/v1/...` (Vite proxy směruje na lokální Fastify API `/v1/...`). Neposílej hesla ani session cookie do URL.

- `POST /v1/auth/login` – JSON `{"username":"owner","password":"..."}`, vrací `{user,csrf}` a nastaví HttpOnly relaci.
- `GET /v1/auth/session` – vrací stav existující relace a CSRF token.
- `POST /v1/auth/logout` – odvolá relaci na serveru.
- Změnové požadavky vyžadují hlavičku `X-Kr-Csrf` a správný `Origin`.
- `GET /health` a `GET /ready` – nezabezpečené kontrolní endpointy.
- Původní bearer token funguje pouze při výslovném zapnutí v neprodukčním prostředí a je určen jen pro přechodové integrační testy.

## Odběry a složky
- `GET /v1/feeds` – kanály přihlášeného uživatele.
- `POST /v1/feeds` – přidá kanál. JSON `{"url":"https://example.org/feed.xml","title":"Volitelný název"}`.
- `DELETE /v1/feeds/<UUID>` – odhlásí odběr, neodstraňuje společné články ostatních uživatelů.
- `POST /v1/feeds/<UUID>/refresh` – zařadí kanál do aktualizačního cyklu, vrací HTTP 202.
- `GET /v1/folders` – složky aktuálního uživatele.
- `POST /v1/opml/import` – JSON `{"opml":"<opml>...</opml>"}`, do 200 kB.
- `GET /v1/opml/export` – JSON s názvem a obsahem XML.
- `GET /v1/stats` – počty článků a uživatelských stavů.

## Příspěvky a hledání
- `GET /v1/entries?limit=30&feedId=<UUID>&before=<ISO>&beforeId=<UUID>`.
- `GET /v1/search?q=dotaz&feedId=<UUID>&limit=40&before=<ISO>&beforeId=<UUID>`.
- `PATCH /v1/entries/<UUID>/state`: JSON `{"read":true,"starred":false,"expectedRevision":3}`.
  Pokud se verze změnila na jiném zařízení, vrátí HTTP 409 s aktuálním stavem. Bez `expectedRevision` jde o zpětně kompatibilní poslední-zápis-vyhrává.

## Synchronizace
- `GET /v1/sync/states?after=<ISO>&afterId=<UUID>&limit=50` – změny stavu u příspěvků, které uživatel sleduje.
- Po stránkách vrací `{items,nextCursor,watermark}`; pokud není `nextCursor`, klient může v dalším dotazu použít `watermark` a maximální UUID.
- Každá položka vrací `entry_id,read_at,starred_at,saved_at,revision,updated_at`.
- Jde o **polling**; není implementován WebSocket, push ani bezpečná offline fronta.

Další podrobnosti a provozní omezení viz [AUTH.md](AUTH.md) a [SYNC.md](SYNC.md).

## Multimédia

- `GET /v1/entries/<UUID>/media` – metadata nejvýše 32 příloh, seřazená podle pozice v RSS. Vyžaduje přihlášeného uživatele se skutečným odběrem příslušného kanálu. Neexistující či nesledované položky vrací **404**.
- Každá položka obsahuje `id`, `url`, `kind` (`image`, `video`, `audio`), `mimeType`, `position`, `width`, `height`. Do odpovědi se nezahrnují neplatná schémata URL a jiné nepodporované typy.
- `GET /v1/entries` a `GET /v1/search` vrací také `media_count`. Pole `thumbnail` nyní vybírá pouze obrázkové přílohy, takže video či audio nejsou zaměněny za obrázek.
- **API nepřenáší binární soubory ani nefunguje jako obecný proxy server.** Online prohlížeč načítá veřejné soubory přímo ze zdrojové domény, pokud je poskytovatel povoluje. U nefunkčních obrázků nabízí otevření originální adresy.
- Další technické a bezpečnostní podmínky viz [MEDIA.md](MEDIA.md).

### Kontrolované stahování obrázků (vývojová verze)

`GET /v1/entries/<entryId>/media/<mediaId>/download` vrací binární obrázek výhradně z obrazové přílohy daného příspěvku a RSS kanálu odebíraného přihlášeným uživatelem. Neexistující nebo nesouvisející identifikátor vrátí 404, bez přihlášení 401, při dosažení limitu 429. MIME typy JPEG/PNG/WebP/GIF/AVIF, maximálně 5 MiB. Odpověď má `Cache-Control: private, no-store` a `Content-Disposition: attachment`. Nepřijímá volnou URL v query ani body. Bezpečnostní podmínky viz [MEDIA.md](MEDIA.md).
