const express = require("express");
const router = express.Router();

const users = require("./users");
const { optionalAuth } = require("./auth");

// Health endpoint for frontend probe
router.get("/health", (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// Attach optional authentication for all subsequent API routes
router.use(optionalAuth);

// Mount auth & user endpoints
router.use("/", users);

module.exports = router;
