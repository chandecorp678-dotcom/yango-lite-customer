const { Pool } = require("pg");
const logger = require("./logger");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }
    : false,
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
});

const DB_STATEMENT_TIMEOUT_MS = Number(process.env.DB_STATEMENT_TIMEOUT_MS || 5000);

pool.on('connect', (client) => {
  try {
    client.query(`SET statement_timeout = ${DB_STATEMENT_TIMEOUT_MS}`).catch((err) => {
      logger.warn('db.pool.set_statement_timeout_failed', { message: err && err.message ? err.message : String(err) });
    });
    logger.info('db.pool.client_connected', { statement_timeout_ms: DB_STATEMENT_TIMEOUT_MS });
  } catch (e) {
    logger.warn('db.pool.connect_handler_failed', { message: e && e.message ? e.message : String(e) });
  }
});

async function initDb() {
  try {
    await pool.query("SELECT 1");
    logger.info("db.connected", {});
  } catch (err) {
    logger.error("db.connect_failed", { message: err && err.message ? err.message : String(err) });
    throw err;
  }
}

module.exports = {
  pool,
  initDb,
};
