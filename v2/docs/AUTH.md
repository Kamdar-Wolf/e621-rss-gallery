# Authentication and sync architecture — phase 1

This is still **an isolated development build**, not a publicly secured service.

## New implementation
- Login with username and password, stored as a salted scrypt digest (no plaintext passwords in DB).
- 14-day session tokens generated server-side and stored only as SHA-256 hashes in PostgreSQL.
- Browser receives an HttpOnly, SameSite=Strict cookie; Secure is enabled when APP_ORIGIN is HTTPS.
- CSRF protection for authenticated changes: strict Origin check + HMAC-based X-Kr-Csrf token.
- No public registration. Bootstrap accounts on the machine running the API.
- Login attempt throttling (10 failed attempts per 15 minutes per IP **per process**); production needs shared/distributed limits, account protections, MFA and monitoring.
- User-scoped queries for subscriptions, articles, searches, OPML, notes and entry states.
- Browser uses same-origin /api proxy; no static credentials in the JS bundle.
- Development bearer login remains available ONLY with ALLOW_DEV_TOKEN=true and NODE_ENV != production, for legacy CI integration tests; never enable it in an untrusted environment.

## Local setup with Docker
1. Copy `v2/.env.example` to `v2/.env`.
2. Set `READER_SESSION_SECRET` to a random string of at least 32 characters. Never commit it.
3. From `v2`, run `docker compose up --build -d`.
4. Create the initial account with a **temporary** process environment variable `READER_BOOTSTRAP_PASSWORD` and command `node dist/scripts/create-user.js` in the API container.
   PowerShell example:
   ```powershell
   $env:READER_BOOTSTRAP_PASSWORD = Read-Host "Zvol heslo (min. 12 znaku)"
   docker compose exec -e READER_BOOTSTRAP_PASSWORD api node dist/scripts/create-user.js
   Remove-Item Env:READER_BOOTSTRAP_PASSWORD
   ```
   This shell prompt echoes the password; on a shared computer use a secure PowerShell password read workflow instead.
5. On your computer run `npm install`, `npm run dev:web` from the `v2` folder, and open `http://127.0.0.1:5173/`.
6. Sign in as user `owner` with the chosen password.
7. For additional users, set `READER_BOOTSTRAP_USER` to a unique handle and run bootstrap again. User data are isolated in PostgreSQL.

## Important deployment restrictions
- The HTTP localhost setup is **only for one trusted development computer**.
- Never expose Docker's PostgreSQL, Redis or Fastify ports on the internet.
- Production requires TLS termination, verified APP_ORIGIN, a secured reverse proxy, durable backups, distributed rate limiting, MFA/passkeys, monitoring and a security review.
- Changing the password via bootstrap revokes all active sessions of that account.
- Revoked sessions remain in the DB until retention cleanup is implemented.
- Password login is an interim milestone, not a claim of enterprise-grade identity readiness.
