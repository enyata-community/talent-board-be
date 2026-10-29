import "reflect-metadata";
import AppDataSource from "../../datasource";
import { UserEntity, UserRole, UserProvider } from "../../entities/user.entity";
import { recordUserActivity } from "../../users/userActivity";

describe("Persisted user activity PostgreSQL integration", () => {
  let talentId: string;
  let recruiterId: string;
  let unknownId: string;
  let deletedId: string;
  let internalId: string;

  beforeAll(async () => {
    await AppDataSource.initialize();
    await AppDataSource.runMigrations();
    await AppDataSource.undoLastMigration();
    const insert = async (email: string, role: string, deleted = false) => {
      const [row] = await AppDataSource.query(
        `INSERT INTO users (email, role, provider, deleted_at)
         VALUES ($1, $2, 'local', $3) RETURNING id`,
        [email, role, deleted ? new Date() : null],
      );
      return row.id as string;
    };
    talentId = await insert("talent@example.com", "talent");
    recruiterId = await insert("recruiter@example.com", "recruiter");
    unknownId = await insert("unknown@example.com", "talent");
    deletedId = await insert("deleted@example.com", "talent", true);
    internalId = await insert("admin@example.com", "admin");
    for (const id of [talentId, deletedId, internalId])
      await AppDataSource.query(
        `INSERT INTO refresh_tokens (user_id, token, created_at)
         VALUES ($1, 'legacy-session', '2026-01-20 00:00:00')`,
        [id],
      );
    await AppDataSource.query(
      `INSERT INTO refresh_tokens (user_id, token, created_at, deleted_at)
       VALUES ($1, 'deleted-session', '2026-10-01', now())`,
      [unknownId],
    );
    const [thread] = await AppDataSource.query(
      `INSERT INTO conversation_threads (talent_id, recruiter_id, talent_last_seen_at, recruiter_last_seen_at)
       VALUES ($1, $2, '2026-01-15', '2026-03-01') RETURNING id`,
      [talentId, recruiterId],
    );
    await AppDataSource.query(
      `INSERT INTO messages (thread_id, sender_id, body, created_at)
       VALUES ($1, $2, 'legacy message', '2026-02-01')`,
      [thread.id, talentId],
    );
    const [deletedThread] = await AppDataSource.query(
      `INSERT INTO conversation_threads (talent_id, recruiter_id, talent_last_seen_at, deleted_at)
       VALUES ($1, $2, '2026-10-01', now()) RETURNING id`,
      [unknownId, recruiterId],
    );
    await AppDataSource.query(
      `INSERT INTO messages (thread_id, sender_id, body, created_at, deleted_at)
       VALUES ($1, $2, 'deleted message', '2026-10-01', now())`,
      [deletedThread.id, unknownId],
    );
    // Use a single connection to verify backfill is independent of session timezone.
    const runner = AppDataSource.createQueryRunner();
    await runner.connect();
    try {
      await runner.query(`SET TIME ZONE 'Africa/Lagos'`);
      const { AddUserLastActivity1793100003000 } = await import(
        "../../migrations/1793100003000-add-user-last-activity"
      );
      await runner.startTransaction();
      await new AddUserLastActivity1793100003000().up(runner);
      await runner.query(
        `INSERT INTO migrations (timestamp, name) VALUES (1793100003000, 'AddUserLastActivity1793100003000')`,
      );
      await runner.commitTransaction();
    } finally {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.query(`SET TIME ZONE 'UTC'`);
      await runner.release();
    }
    await AppDataSource.query(`
      CREATE TABLE activity_test_writes (user_id uuid NOT NULL);
      CREATE FUNCTION activity_test_count_write() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN INSERT INTO activity_test_writes VALUES (NEW.id); RETURN NEW; END;
      $$;
      CREATE TRIGGER activity_test_count_write AFTER UPDATE OF last_activity_at ON users
        FOR EACH ROW EXECUTE FUNCTION activity_test_count_write();
    `);
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it("backfills the latest session, sent message and own conversation observation once", async () => {
    const rows = await AppDataSource.getRepository(UserEntity).find({
      withDeleted: true,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(talentId).last_activity_at).toEqual(
      new Date("2026-02-01T00:00:00Z"),
    );
    expect(byId.get(recruiterId).last_activity_at).toEqual(
      new Date("2026-03-01T00:00:00Z"),
    );
    for (const id of [unknownId, deletedId, internalId])
      expect(byId.get(id).last_activity_at).toBeNull();
    expect(await AppDataSource.runMigrations()).toHaveLength(0);
    const indexes = await AppDataSource.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'users'`,
    );
    expect(indexes.map((row: any) => row.indexname)).toEqual(
      expect.arrayContaining([
        "IDX_users_activity_asc",
        "IDX_users_activity_desc",
      ]),
    );
  });

  it("writes once for concurrent stale requests and preserves the profile edit timestamp", async () => {
    const account = await AppDataSource.getRepository(
      UserEntity,
    ).findOneByOrFail({ id: unknownId });
    const editedAt = account.updated_at;
    const requests = Array.from({ length: 12 }, () =>
      Object.assign(new UserEntity(), account),
    );
    await Promise.all(
      requests.map((snapshot) =>
        recordUserActivity(snapshot, AppDataSource.manager),
      ),
    );
    const [writes] = await AppDataSource.query(
      `SELECT count(*)::int AS count FROM activity_test_writes WHERE user_id = $1`,
      [unknownId],
    );
    expect(writes.count).toBe(1);
    const current = await AppDataSource.getRepository(
      UserEntity,
    ).findOneByOrFail({ id: unknownId });
    expect(current.last_activity_at.getTime()).toBeGreaterThan(
      Date.now() - 10000,
    );
    expect(current.updated_at).toEqual(editedAt);
    // Even a stale snapshot from a different application instance cannot write again.
    await recordUserActivity(account, AppDataSource.manager);
    expect(
      (
        await AppDataSource.getRepository(UserEntity).findOneByOrFail({
          id: unknownId,
        })
      ).last_activity_at,
    ).toEqual(current.last_activity_at);
    const [after] = await AppDataSource.query(
      `SELECT count(*)::int AS count FROM activity_test_writes WHERE user_id = $1`,
      [unknownId],
    );
    expect(after.count).toBe(1);
  });

  it("never replaces newer database activity with a stale observation", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    await AppDataSource.getRepository(UserEntity).update(talentId, {
      last_activity_at: future,
    });
    const stale = Object.assign(new UserEntity(), {
      id: talentId,
      role: UserRole.TALENT,
      last_activity_at: null,
    });
    await recordUserActivity(stale, AppDataSource.manager);
    expect(
      (
        await AppDataSource.getRepository(UserEntity).findOneByOrFail({
          id: talentId,
        })
      ).last_activity_at,
    ).toEqual(future);
  });

  it("resumes tracking after the throttle interval and ignores deleted users", async () => {
    const repository = AppDataSource.getRepository(UserEntity);
    const account = await repository.save(
      repository.create({
        email: "stale@example.com",
        role: UserRole.RECRUITER,
        provider: UserProvider.LOCAL,
        last_activity_at: new Date(Date.now() - 6 * 60 * 1000),
      }),
    );
    const old = account.last_activity_at;
    await recordUserActivity(account, AppDataSource.manager);
    expect(
      (
        await repository.findOneByOrFail({ id: account.id })
      ).last_activity_at.getTime(),
    ).toBeGreaterThan(old.getTime());
    const deleted = Object.assign(new UserEntity(), {
      id: deletedId,
      role: UserRole.TALENT,
      last_activity_at: null,
    });
    await recordUserActivity(deleted, AppDataSource.manager);
    const [row] = await AppDataSource.query(
      `SELECT last_activity_at FROM users WHERE id = $1`,
      [deletedId],
    );
    expect(row.last_activity_at).toBeNull();
  });
});
