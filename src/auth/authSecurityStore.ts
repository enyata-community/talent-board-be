import { createHash, randomInt } from "crypto";
import AppDataSource from "@src/datasource";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

// Bound cleanup work per request; expiry checks do not depend on cleanup running.
async function cleanupExpired(): Promise<void> {
  if (randomInt(100) === 0) {
    await AppDataSource.manager
      .query(`DELETE FROM auth_security_state WHERE key IN
      (SELECT key FROM auth_security_state WHERE expires_at <= NOW() ORDER BY expires_at LIMIT 500)`);
  }
}

export async function saveAuthChallenge(
  key: string,
  binding: string,
  payload: Record<string, string>,
  ttlSeconds: number,
): Promise<void> {
  await cleanupExpired();
  await AppDataSource.manager.query(
    `INSERT INTO auth_security_state (key, binding_hash, payload, expires_at)
     VALUES ($1, $2, $3::jsonb, NOW() + $4 * INTERVAL '1 second')`,
    [digest(key), digest(binding), JSON.stringify(payload), ttlSeconds],
  );
}

export async function consumeAuthChallenge(
  key: string,
  binding: string,
): Promise<Record<string, string> | null> {
  // DELETE is atomic: only one concurrent caller can receive the challenge.
  const rows = await AppDataSource.manager.query(
    `WITH consumed AS (
       DELETE FROM auth_security_state
       WHERE key = $1 AND binding_hash = $2 AND expires_at > NOW()
       RETURNING payload
     ) SELECT payload FROM consumed`,
    [digest(key), digest(binding)],
  );
  return rows[0]?.payload ?? null;
}

export async function incrementAuthCounter(
  key: string,
  ttlSeconds: number,
): Promise<number> {
  await cleanupExpired();
  const rows = await AppDataSource.manager.query(
    `INSERT INTO auth_security_state (key, hits, expires_at)
     VALUES ($1, 1, NOW() + $2 * INTERVAL '1 second')
     ON CONFLICT (key) DO UPDATE SET hits = auth_security_state.hits + 1
     RETURNING hits`,
    [digest(key), ttlSeconds],
  );
  return Number(rows[0].hits);
}
