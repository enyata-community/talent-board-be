# Database and CI reliability

Every environment now uses `synchronize: false`. Run `yarn migration:run` before
starting the application against a new database, and whenever a release includes
migrations. Entity changes alone no longer mutate the schema.

The initial migration already creates the UUID extension, and the corrected
password-reset migration already follows the users table. This PR preserves those
migration identities rather than retimestamping applied migrations again. The
integration suite verifies the complete sequence on empty Postgres 17 databases,
rollback/reapply, and upgrades with existing identities, sessions, invitations and
append-only audit data. It also verifies that an identity collision aborts the
migration without changing the existing marketplace user.

For shared databases which recorded the historical password-reset name
`CreatePasswordResetTokensTable1740000000000`, reconcile the migration history after
verifying the existing table, columns, index and foreign key. Follow
`local-database-rebuild.md` for the distinction between the approved disposable local
rebuild and data-preserving shared-database upgrades. Do not run a schema reset or
rebuild command on shared databases.

## Checks

Use Node 22.13 or newer (Docker and CI use Node 22) and Yarn Classic through Corepack.
The supported ESLint release requires at least Node 22.13 on the Node 22 line.

```sh
corepack yarn install --frozen-lockfile
yarn typecheck
yarn lint
yarn test:unit
```

`yarn test` remains the unit-test command. Database tests use the
`.integration.test.ts` suffix and run separately:

```sh
TEST_DATABASE_URL=postgres://test_user:test_password@localhost:5453/test_db yarn test:integration
```

Use a dedicated Postgres 17 test server whose role can create and drop databases.
The harness creates a fresh randomly named `talent_test_*` database for each suite,
sets all integration URLs before importing application modules, and drops only that
suite database after it finishes. It never resets the database named in the supplied
connection URL. No application `.env` or Redis service is needed for these checks;
Redis, logger transports and email delivery are mocked.
`yarn test:docker` runs both suites in the builder image against `postgres_test`. CI runs both jobs on pushes
and PRs targeting `main` or `develop` and supplies its own Postgres service.

Service integration fixtures reset migrated tables between tests, preserving the
append-only audit-log rule. They do not call TypeORM synchronization. Unit coverage is enforced at 65% statements/lines, 45% branches and 40% functions
for modules loaded by the unit suite; these are baseline floors, not a claim of
whole-repository coverage. The unit suite
excludes integration files and both suites ignore build output and worktree folders.
Real integration failures fail CI; no failing tests are quarantined or skipped by
the integration command. The suite no longer relies on Jest's forced process exit.

## Error responses

Only development returns detailed error stacks. Test, staging, production and
unknown environment values use the production-safe response. If headers have
already been sent, errors delegate to Express rather than attempting a second
response. Environment configuration recognizes both `TALENTS_NODE_ENV` and
`NODE_ENV` and defaults to development.

PRs 1 and 2 are independent branches. Apply this migration/testing configuration
when merging them, preserving their additional migrations and regression tests.
