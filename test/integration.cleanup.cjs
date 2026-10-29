const { Client } = require("pg");
afterAll(async () => {
  const name = process.env.INTEGRATION_SUITE_DATABASE;
  if (!/^talent_test_[a-f0-9]{32}$/.test(name || ""))
    throw new Error(
      "Refusing to clean up a database not created by the test harness",
    );
  const admin = new Client({
    connectionString: process.env.INTEGRATION_ADMIN_DATABASE_URL,
  });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
  } finally {
    await admin.end();
  }
});
