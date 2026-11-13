# API kontrakt (vývojový)

## Zabezpečení
Vše kromě `/health` a `/ready` vyžaduje `Authorization: Bearer <READER_API_TOKEN>`. Token je **serverové tajemství**, nikdy jej nevkládat do veřejného JavaScriptu.

- `GET /health`: liveness, neověřuje DB.
- `GET /ready`: připojení k PostgreSQL; při selhání HTTP 503.
- `GET /v1/feeds`: přihlášené odběry uživatele.
- `POST /v1/feeds`: JSON `{"url":"https://example.com/feed.xml","title":"Volitelný název"}`; ukládá adresu, **zatím nestahuje**.
- `POST /v1/feeds/<UUID>/refresh`: zařadí zdroj do nejbližšího cyklu workeru (HTTP 202). Nečeká na samotné stažení.
- `DELETE /v1/feeds/<UUID>`: odebere vlastní odběr, společná data sdíleného feedu zůstávají (HTTP 204).
- `GET /v1/stats`: počty kanálů, položek, nepřečtených a uložených.
- `GET /v1/entries?limit=30&feedId=<UUID>&before=<ISO-8601>&beforeId=<UUID>`: časově řazené položky z dostupných odběrů.
- `PATCH /v1/entries/<UUID>/state`: `{"read":true,"starred":false,"saved":true}`. Nezadané hodnoty se nemění. API vrací aktuální revizi stavu.

### Příklad
```bash
curl -H "Authorization: Bearer $READER_API_TOKEN" http://127.0.0.1:3100/v1/feeds
```

### Plánované změny kontraktu
Autentizace přes OIDC/session místo sdíleného tokenu, kurzorování podle (published_at,id), synchronizační revize s řešením konfliktů, pravidla, hromadné akce, ukládání a oprávnění médií. Tyto části není správné považovat za hotové.

Stránkování vrací `nextCursor` s `before` a `beforeId`, aby zachovalo pořadí i u shodných časů publikace. 
