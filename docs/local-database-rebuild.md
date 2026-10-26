# Rebuild the local development database

This procedure deletes all data in the Docker development database, including
marketplace accounts, Admins, invitations, sessions, audit records, and migration
history. It recreates only the local test Super Admin after migrations.
Do not use it against a database whose data must be retained.

## Corrected migration dependencies

TypeORM executes migrations by the timestamp suffix in their class name. The
initial migration (`1745418605537`) now runs first and ensures the UUID extension
required by later legacy SQL. The password-reset migration has been retimestamped
to `1745418605538` in both its filename and class, so it creates its table and user
foreign key after users exists. All remaining migrations retain their timestamps
and run in ascending order through the Admin Portal migrations.

This rename is intended for the approved fresh local rebuild. A shared database
that already recorded `CreatePasswordResetTokensTable1740000000000` requires
separate migration-history reconciliation before adopting the renamed migration.

## Migration execution order

1. `1745418605537-initial-migration.ts`
2. `1745418605538-create-password-reset-tokens-table.ts`
3. `1746228962929-onboarding.ts`
4. `1746530690756-add-device-context-to-refresh-tokens.ts`
5. `1747165812599-split-user-profiles-and-adjust-fields.ts`
6. `1747251721737-talent-dashboard-entities.ts`
7. `1747364288301-create-saved-talents-table.ts`
8. `1747579336887-create-talent-upvotes.ts`
9. `1747657001528-enable-trgm-and-skills-index.ts`
10. `1748698044283-add-bio-to-talent-profile.ts`
11. `1749302371234-add-job-title-to-talent-profile.ts`
12. `1770990280116-add-skills-table.ts`
13. `1772000000000-make-first-last-nullable.ts`
14. `1772000001000-create-email-otps.ts`
15. `1772000002000-add-used-at-to-email-otps.ts`
16. `1772000003000-add-auth-columns-to-users.ts`
17. `1772000004000-add-audit-columns-to-email-otps.ts`
18. `1773000000000-add-incomplete-signup-reminder-fields.ts`
19. `1785264000000-add-messaging-foundation.ts`
20. `1793000000000-create-admin-portal.ts`
21. `1793000001000-enforce-single-super-admin.ts`
22. `1793000002000-unify-admin-user-identities.ts`

The email-OTP audit migration filename now matches its existing class timestamp
(`1772000004000`); its execution identity is unchanged.

Rollback now preserves the onboarding `linkedin_profile` column when reversing
the profile split. Password-reset rollback lets TypeORM drop the table and its
indexes together, avoiding stale cached index metadata.

Application startup no longer synchronizes development or production schemas.
Tests can still use synchronization for isolated fixtures. Migration history is
populated by actual execution; no migrations are faked.

## Commands

Run these from the repository root, in order. Stop if any command fails.
The PostgreSQL reset targets only the configured local Compose `postgres` service;
Redis, Maildev, and the test database are not reset.

```sh
# Build the corrected source before stopping the current backend.
docker compose build backend

# Stop the old process so it cannot recreate tables during the reset.
docker compose stop backend

# Reset the entire development schema, including old audit functions/triggers.
docker compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'

# Execute real migrations against the empty schema, with the app stopped.
docker compose run --rm --no-deps backend yarn migration:run

# Recreate the development-only Super Admin.
docker compose run --rm --no-deps backend yarn admin:seed:local

# Start the corrected backend and inspect migration history.
docker compose up -d --no-deps backend
docker compose exec backend yarn migration:show
```

All migrations should be marked applied (`[X]`). Running `migration:run` again
should report no pending migrations. No marketplace fixtures or extra Admins are
created. Invite new Admins again after logging in.

Local Super Admin:

```text
Email: superadmin@example.com
Password: LocalSuperAdmin123!
Login: POST http://localhost:8000/api/v1/superadmin/auth/login
Origin: http://localhost:3000
```

## Validation

The complete sequence is tested on a disposable PostgreSQL 17 database, with
synchronization disabled. Tests apply every migration, rerun with none pending,
verify the password-reset foreign key and audit trigger, exercise Super Admin
bootstrap/login and all-session logout, fully revert, then apply the chain again.
The database supplied to this test must be empty and disposable:

```sh
NODE_ENV=test MIGRATION_TEST_DATABASE_URL=postgres://... corepack yarn test src/__tests__/migrations/fullSequence.integration.test.ts --coverage=false
```

This repairs fresh-database execution; it does not automatically reconcile an
existing shared database whose schema and migration history have diverged.
