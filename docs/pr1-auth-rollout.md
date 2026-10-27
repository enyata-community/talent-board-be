# Authentication and authorization rollout

Apply `yarn migration:run` before deploying this backend. The migrations add
`email_otps.failed_attempts` and the `auth_security_state` table. Existing migration ordering and schema synchronization
repairs remain in PR 3. Validate the migration against the deployment database;
this PR does not reset or rewrite existing data.

Postgres stores OAuth state, exchange codes, and shared authentication limits;
these protections do not require Redis. All instances must share the same database.
Challenge keys and browser bindings are hashed. Expired rows are removed in bounded
batches during a sample of writes, with an index on expiry. Expiry is enforced on
every redemption even before cleanup. Limits are 100 requests per IP
and 20 per normalized email in a 15-minute fixed window across public auth routes.
Existing OTP and password-reset resend cooldowns still apply. Five incorrect OTP
submissions consume that code; generating another code starts a new attempt count.

The frontend must be deployed with these API contract changes:

- Start OAuth through `/api/v1/auth/google` or `/api/v1/auth/linkedin` in the browser.
  An optional `redirect_uri` must have exactly the configured `FRONTEND_URL` origin.
  The backend stores redirect state server-side and binds it to an HttpOnly cookie.
- The frontend callback receives `?code=...`, never access or refresh tokens.
  Immediately POST `{ "code": "..." }` to `/api/v1/auth/oauth/exchange` with
  credentials enabled. The code expires after 60 seconds, is bound to the browser
  cookie set by the callback, and can only be used once.
  Remove it from browser history after reading it. `include_tokens_in_url` is ignored.
- Login, email verification, onboarding and OAuth exchange return only
  `tokens.access_token`. Refresh tokens are HttpOnly cookies. Send credentials on
  API requests; read replacement access tokens from the existing `x-access-token`
  response header. Refreshing consumes the old refresh token atomically and replaces
  its cookie. Serialize refresh attempts in the client to avoid concurrent refreshes.
- Cookies use SameSite=Lax: deploy frontend and API on the same site, and use HTTPS
  in production. Cross-site frontend/API deployments require a separately reviewed
  cookie and CSRF configuration. Configure Express trusted proxies for your actual
  ingress topology so `req.ip` represents the client; do not trust arbitrary forwarded
  headers supplied directly by clients.

Logout revokes the cookie's refresh token. Password reset revokes all refresh tokens
for that user in the password transaction. Existing access tokens remain valid until
their configured expiry; choose a short access-token TTL. Immediate access-token
revocation would require a session/version check on every authenticated request.

Review regression coverage with:

```sh
yarn tsc --noEmit
yarn jest --runInBand --coverage=false --testPathPattern 'src/__tests__/auth|src/__tests__/middlewares/deserializeUser|src/__tests__/utils/jwt'
```

Database locking, Postgres counter atomicity, provider callbacks and browser cookies still need
an integration smoke test with Postgres and the updated frontend before release.
