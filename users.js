const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const logger = require("./logger");
const { sendError, sendSuccess, wrapAsync } = require("./apiResponses");
const RateLimiter = require("./rateLimiter");

const JWT_SECRET = process.env.JWT_SECRET || "change-this-secret";

const registerLimiter = new RateLimiter({
  maxRequests: 10,
  windowMs: 3600000
});

const loginLimiter = new RateLimiter({
  maxRequests: 10,
  windowMs: 900000
});

function sanitizeUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    phone: row.phone,
    balance: Number(row.balance || 0),
    createdAt: row.createdat,
    updatedAt: row.updatedat,
  };
}

router.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

router.post("/auth/register", 
  registerLimiter.middleware({
    keyFn: (req) => req.ip,
    onLimitExceeded: (req, res) => sendError(res, 429, "Too many registration attempts. Please try again later.")
  }),
  express.json(), 
  wrapAsync(async (req, res) => {
    const db = req.app.locals.db;
    const { username, phone, password } = req.body || {};

    if (!phone || String(phone).trim().length === 0) {
      return sendError(res, 400, "Phone number is required");
    }

    if (!password || String(password).trim().length === 0) {
      return sendError(res, 400, "Password is required");
    }

    if (!username || String(username).trim().length === 0) {
      return sendError(res, 400, "Username is required");
    }

    const trimmedPhone = String(phone).trim();
    const trimmedUsername = String(username).trim();
    const trimmedPassword = String(password).trim();

    try {
      const existing = await db.query("SELECT id FROM users WHERE phone = $1", [trimmedPhone]);
      if (existing.rows.length > 0) {
        return sendError(res, 409, "Phone number already registered");
      }

      const id = uuidv4();
      const now = new Date().toISOString();
      const password_hash = await bcrypt.hash(trimmedPassword, 10);

      await db.query(
        `INSERT INTO users (id, username, phone, password_hash, balance, createdat, updatedat)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, trimmedUsername, trimmedPhone, password_hash, 0, now, now]
      );

      const userRow = await db.query("SELECT * FROM users WHERE id = $1", [id]);
      const user = sanitizeUser(userRow.rows[0]);
      const token = jwt.sign({ uid: id }, JWT_SECRET, { expiresIn: "30d" });

      logger.info('auth.register.success', { userId: id, username: trimmedUsername, phone: trimmedPhone });

      return res.status(201).json({ token, user });
    } catch (err) {
      logger.error('auth.register.error', { message: err && err.message ? err.message : String(err) });
      
      if (err.code === '23505') {
        return sendError(res, 409, "Phone number already registered");
      }

      return sendError(res, 400, "Registration failed: " + (err && err.message ? err.message : "Unknown error"));
    }
  })
);

router.post("/auth/login",
  loginLimiter.middleware({
    keyFn: (req) => req.ip,
    onLimitExceeded: (req, res) => sendError(res, 429, "Too many login attempts. Please try again later.")
  }),
  express.json(),
  wrapAsync(async (req, res) => {
    const db = req.app.locals.db;
    const { phone, password } = req.body || {};

    if (!phone || String(phone).trim().length === 0) {
      return sendError(res, 400, "Phone number is required");
    }

    if (!password || String(password).trim().length === 0) {
      return sendError(res, 400, "Password is required");
    }

    const trimmedPhone = String(phone).trim();
    const trimmedPassword = String(password).trim();

    try {
      const rowRes = await db.query("SELECT * FROM users WHERE phone = $1", [trimmedPhone]);
      const row = rowRes.rows[0];
      
      if (!row) {
        logger.warn('auth.login.user_not_found', { phone: trimmedPhone });
        return sendError(res, 401, "Invalid phone or password");
      }

      const ok = await bcrypt.compare(trimmedPassword, row.password_hash || "");
      if (!ok) {
        logger.warn('auth.login.invalid_password', { phone: trimmedPhone });
        return sendError(res, 401, "Invalid phone or password");
      }

      const user = sanitizeUser(row);
      const token = jwt.sign({ uid: row.id }, JWT_SECRET, { expiresIn: "30d" });

      logger.info('auth.login.success', { userId: row.id, phone: trimmedPhone });

      return res.json({ token, user });
    } catch (err) {
      logger.error('auth.login.error', { message: err && err.message ? err.message : String(err) });
      return sendError(res, 500, "Server error");
    }
  })
);

async function requireAuth(req, res, next) {
  const db = req.app.locals.db;
  const auth = req.headers.authorization || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return sendError(res, 401, "Missing authorization token");

  const token = match[1];
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.uid) return sendError(res, 401, "Invalid token");

    const rowRes = await db.query("SELECT * FROM users WHERE id = $1", [payload.uid]);
    const row = rowRes.rows[0];
    if (!row) return sendError(res, 401, "User not found");

    req.user = sanitizeUser(row);
    req.userRaw = row;
    next();
  } catch (err) {
    logger.error("Auth verify error", { message: err && err.message ? err.message : String(err) });
    return sendError(res, 401, "Invalid or expired token");
  }
}

router.get("/users/me", requireAuth, (req, res) => {
  return res.json(req.user);
});

module.exports = router;
