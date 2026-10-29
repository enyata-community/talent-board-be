const { randomUUID } = require("crypto");
const { Client } = require("pg");

// Every suite receives a database created by this harness, never the application DB.
module.exports = async () => {
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl)
    throw new Error(
      "Set TEST_DATABASE_URL to a Postgres test server with CREATE DATABASE permission",
    );
  const database = `talent_test_${randomUUID().replaceAll("-", "")}`;
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  process.env.INTEGRATION_ADMIN_DATABASE_URL = adminUrl;
  process.env.INTEGRATION_SUITE_DATABASE = database;
  process.env.DATABASE_URL = url.href;
  process.env.TALENTS_DATABASE_URL = url.href;
  process.env.ADMIN_TEST_DATABASE_URL = url.href;
  process.env.MIGRATION_TEST_DATABASE_URL = url.href;
};
