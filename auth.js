const jwt = require("jsonwebtoken");
const logger = require("./logger");

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";

async function optionalAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return next();

  const token = match[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.uid) return next();

    const db = req.app && req.app.locals && req.app.locals.db;
    if (!db || typeof db.query !== "function") return next();

    try {
      const rowRes = await db.query("SELECT id, username, phone, balance, createdat, updatedat FROM users WHERE id = $1", [payload.uid]);
      const row = rowRes.rows[0];
      if (!row) return next();

      req.user = {
        id: row.id,
        username: row.username,
        phone: row.phone,
        balance: Number(row.balance || 0),
        createdAt: row.createdat,
        updatedAt: row.updatedat
      };
    } catch (dbErr) {
      logger.warn("optionalAuth.db_query_failed", { message: dbErr && dbErr.message ? dbErr.message : String(dbErr) });
    }
    return next();
  } catch (err) {
    logger.warn("optionalAuth.invalid_token", { message: err && err.message ? err.message : String(err) });
    return next();
  }
}

module.exports = {
  optionalAuth
};
