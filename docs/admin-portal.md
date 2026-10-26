# Admin Portal phase one

The Admin Portal lives in the existing Express backend under `/api/v1/admin` and `/api/v1/superadmin`
(or the configured API prefix). It uses the existing PostgreSQL connection,
TypeORM, Argon2, Nodemailer, Swagger, and Jest. No new packages, server, queues,
or Redis dependency are required by this module.

## Configuration and deployment

Set `TALENTS_ADMIN_FRONTEND_URL` to the portal URL, such as
`https://admin.example.com`. HTTPS is required in production. Local development
defaults to `http://localhost:3000`. The API and portal must share a site because
the session cookie uses `SameSite=Strict`; a cross-site deployment needs an
explicit cookie/CSRF design change. CORS allows only the configured portal origin
in addition to the existing public application origins.

Apply migrations before enabling traffic. In a source checkout use the existing
`yarn migration:run`. In the production container, which contains compiled code:

```sh
node node_modules/typeorm/cli.js migration:run -d build/src/datasource.js
```

Development and production schemas are managed only by migrations. Application
startup does not synchronize tables; isolated test fixtures retain synchronization.
Run migrations before starting the backend on a new database. Migrations also
install audit immutability triggers, which synchronization cannot install.

## Separate role APIs

| Action                                      | Super Admin                                   | Admin                                    |
| ------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| Login                                       | `POST /api/v1/superadmin/auth/login`          | `POST /api/v1/admin/auth/login`          |
| Password setup                              | `POST /api/v1/superadmin/auth/setup-password` | `POST /api/v1/admin/auth/setup-password` |
| Identity                                    | `GET /api/v1/superadmin/auth/me`              | `GET /api/v1/admin/auth/me`              |
| Logout                                      | `POST /api/v1/superadmin/auth/logout`         | `POST /api/v1/admin/auth/logout`         |
| Invite/list/resend/revoke Admin invitations | `/api/v1/superadmin/invitations`              | Unavailable                              |
| Audit logs                                  | `GET /api/v1/superadmin/audit-logs`           | Unavailable                              |

Login, session authentication, and password setup enforce the role associated with
the URL. Cookies have separate names and paths. The previous privileged
`/admin/invitations` and `/admin/audit-logs` paths are removed. Existing Super Admin
sessions issued under the old admin cookie must log in through the new URL.
The unique partial index `uq_single_super_admin` on `users.role` allows at most one Super Admin,
including pending and disabled identities, while allowing many Admins. Apply the
single-Super-Admin and shared-identity migrations after the initial Admin Portal migration.

## Local test Super Admin

Use the development-only seed command to activate a local account without email:

```sh
# From your Mac, map the Docker postgres hostname to localhost:5452.
corepack yarn admin:seed:local --host
# Inside the backend container:
docker compose exec backend yarn admin:seed:local
```

Local credentials:

```text
Email: superadmin@example.com
Password: LocalSuperAdmin123!
```

The seed refuses production mode and remote database hosts, never replaces a
different Super Admin, and does not reactivate disabled accounts. It activates a
matching pending test account, revokes old invitations/sessions, and records an
audit event. Repeated runs preserve an active account with the same password.
Changing an existing local password requires the explicit `--reset-password`
option. The command disables schema synchronization and does not run migrations.
These credentials are for development only; production has no default password.

Example login without a frontend:

```sh
curl -i -c /tmp/talentboard-superadmin.cookies \
  -H 'Origin: http://localhost:3000' \
  -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@example.com","password":"LocalSuperAdmin123!"}' \
  http://localhost:8000/api/v1/superadmin/auth/login
```

Copy `data.csrf_token` from the response and include it as `x-admin-csrf` on
mutation requests, together with the saved cookie. Browser clients send Origin
automatically; Swagger UI cannot override this browser-controlled header.

## Production onboarding decision

Use one operator-run bootstrap command for the sole Super Admin. It sends a
one-use password-setup link and never accepts a default production password.
`POST /superadmin/auth/setup-password` consumes this invitation; it cannot create
an account without a valid token. There is no public Super Admin registration API.
After login, the Super Admin invites Admins through the invitations API, and each
Admin completes `/admin/auth/setup-password`. Future Admins cannot self-register
or select a privileged role.

## Bootstrap

From a source checkout:

```sh
yarn admin:bootstrap superadmin@example.com
```

From the built production image:

```sh
yarn admin:bootstrap:prod superadmin@example.com
```

This creates one pending Super Admin and emails a one-use setup link. There is
no public bootstrap route, default password, or credential embedded in a migration.
An advisory transaction lock serializes simultaneous attempts. The command exits
unsuccessfully if a Super Admin already exists.

If email delivery fails, the pending account remains and output reports
`delivery_status: failed`. After correcting SMTP configuration, explicitly rotate
and resend the initial invitation:

```sh
yarn admin:bootstrap superadmin@example.com --retry
```

Retry works only for the same pending Super Admin and never resets an active
account's password. The production command supports the same `--retry` flag.
Bootstrap prints invitation metadata, never the secret. Use existing Maildev for
local email inspection; no real SMTP calls are made by tests.

## Browser contract

All mutation requests, including login and setup, must send an `Origin` header
matching the configured portal origin. Browser requests use credentials. Login
sets a role-specific HttpOnly cookie (`talentboard_admin_session` or
`talentboard_superadmin_session`) restricted to its own API path,
`SameSite=Strict`, and production `Secure`. Session tokens are never returned in
JSON or stored in plaintext in PostgreSQL.

Login and each role’s `GET /auth/me` return:

```json
{
  "status": "success",
  "data": {
    "admin": {
      "id": "uuid",
      "email": "admin@example.com",
      "display_name": "Admin",
      "role": "admin"
    },
    "csrf_token": "opaque value"
  }
}
```

Send `x-admin-csrf` on authenticated mutations, including logout. Logout is
idempotent for missing or expired sessions; a valid session still requires CSRF.
Logout revokes **all active sessions for that account**, including sessions on
other devices. Previously issued cookies cannot authenticate again. A new login
after logout creates a new valid session. Login and logout serialize on the account
row, and replaying a revoked logout cannot revoke a later login. Cookie clearing
happens only after database revocation and its audit entry commit.

Session expiry is 30 minutes idle and eight hours absolute. Each request checks
account status and role from PostgreSQL. Public user tokens are not accepted.

Setup links carry the secret in the URL fragment, for example
`/superadmin/setup-password#token=...` or `/admin/setup-password#token=...`. The frontend must read and immediately remove the
fragment from browser history and POST `{token,password}` (optionally including `first_name`, `last_name`, or `display_name`) to
the matching `/superadmin/auth/setup-password` or `/admin/auth/setup-password`. Passwords require 8–128 characters. Invitations
expire after 24 hours. Setup does not log the account in.

Admin and Super Admin can authenticate and view their own identity. Only Super
Admin can create, list, resend, or revoke Admin invitations and read audit logs.
The invite API does not accept a role. Additional Super Admin creation, role
changes, account-management screens, MFA/SSO, and ongoing password recovery are
outside this phase. Agree a credential-recovery procedure before production use.
All identities now live in `users`, including `admin` and `super_admin` roles.
`admin_accounts` holds a unique `user_id` plus internal status and timestamps.
Email, password, and role are stored only in `users`. The admin account ID remains
stable for sessions, invitations, and audit references. Public login, OAuth,
password recovery, and protected marketplace endpoints reject internal roles;
internal users are excluded from onboarding reminder jobs.

Names are optional. Use `first_name`/`last_name` when supplied; the legacy optional
`display_name` input is split into the existing name fields. The response derives
`display_name` from those fields and falls back to email. It also includes `user_id`.
Passwords are 8–128 characters during setup, signup, or reset; existing public
signup/reset complexity checks remain in place. Login only verifies credentials.

Apply `1793000002000-unify-admin-user-identities.ts` before deploying this version.
It moves existing admin emails/passwords/roles into new `users` rows, preserves
admin IDs and all existing sessions/invitations/audit references, and moves the
single-Super-Admin unique index to `users.role`. If a user already owns an admin
email, it aborts atomically; resolve that conflict before retrying. It does not
promote existing marketplace users or silently overwrite credentials.

API operations and schemas are in `/docs` and `/openapi.json`. Invitation list
and audit list accept `page` (1–10000) and `limit` (1–100). Audit filters include
`actor_id`, `action`, `outcome`, `from`, and `to` (ISO UTC timestamps).

## Delivery, throttling, and audit behavior

Invitation creation commits before SMTP delivery. Responses report `pending`,
`sent`, or `failed` delivery status; `sent` means SMTP accepted the message, not
that it reached an inbox. On failure a Super Admin can resend, which rotates the
secret and revokes the previous invitation. There is no automatic delivery retry.
If the process exits between commit and delivery, resend a pending invitation.

PostgreSQL atomically limits login/setup to 10 requests per 15-minute window per
IP, and login additionally per normalized email. Invitation creation allows 20
and resend 10 per IP per window. Rejections return `429` and `Retry-After`.
Counters are shared across backend instances. The current Express proxy settings
are unchanged: review trusted proxy configuration for the actual ingress before
production so IP limits distinguish clients without trusting arbitrary forwarded
headers. Failed requests count toward the limits.

Successful privileged mutations and audit entries share a transaction. Failed
login/setup and denied authorization/CSRF checks produce separate audit events.
Audit records contain actor identity/role, action, outcome, target, server-issued
request ID, timestamp, and IP; never credentials or raw setup/session tokens.
A migration installs an append-only trigger blocking update, delete, and truncate.
The runtime DB role must not be a superuser or allowed to disable triggers;
use a separate migration role where feasible.

Retention needs an explicit operational decision. No audit pruning is automated.
Periodically clean expired throttle rows and expired/revoked sessions using a
maintenance job against PostgreSQL; this module adds no scheduler dependency:

```sql
DELETE FROM admin_auth_throttles WHERE expires_at < now();
DELETE FROM admin_sessions WHERE expires_at < now() OR revoked_at IS NOT NULL;
```

Account disabling can be performed by an authorized database operator until the
account-management API is implemented. The next request rejects existing sessions.
Do not delete audit history when disabling or removing an account.

## Verification

```sh
NODE_ENV=test yarn test src/__tests__/admin/admin.security.test.ts --coverage=false
NODE_ENV=test ADMIN_TEST_DATABASE_URL=postgres://... yarn test src/__tests__/admin/admin.integration.test.ts --coverage=false
yarn build
```

Integration tests require a dedicated disposable database. They apply and revert
the admin migration with synchronization disabled, create fixtures, exercise
bootstrap/setup concurrency, invitation rotation, login/logout and expiry,
atomic throttles, audit protection, transaction rollback, and HTTP cookie/CSRF/RBAC
contracts. They skip unless `ADMIN_TEST_DATABASE_URL` is provided. Never point
them at development or production data.

## Existing test-suite failures

The implementation was verified with a production build, passing admin tests,
and migration/entity schema comparison against PostgreSQL 17. The repository-wide
run had six failing suites. The same failures were reproduced from an untouched
copy of HEAD, independently of this implementation:

- `src/__tests__/auth/local/verifyEmail.test.ts`: missing `verify` symbol.
- `src/__tests__/auth/local/localAuth.password.test.ts`: invalid relative imports.
- `src/__tests__/dashboard/dashboard.controller.test.ts`: fixture enum type errors.
- `src/__tests__/messaging/messageTemplate.service.test.ts`: greeting expectation mismatch.
- `src/__tests__/onboarding/onboarding.service.test.ts`: incomplete manager mock and stale error expectations.
- `src/__tests__/onboarding/onboarding.controller.test.ts`: stale token-issuance expectations.

These existing failures remain outside the Admin Portal change.
