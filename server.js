'use strict';
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const http = require("http");

const logger = require("./logger");
const { initDb, pool } = require("./db");
const routes = require("./routes");

const app = express();

// Validation
function validateEnv() {
  const required = ['JWT_SECRET', 'DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    logger.warn('server.startup.env_validation_warning', { missing, message: 'Some environment variables are not set.' });
  }
}

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);

app.use((req, res, next) => {
  logger.info('http.request.start', { method: req.method, url: req.originalUrl, ip: req.ip });
  next();
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", routes);

// HTTP server with Socket.IO support
const httpServer = http.createServer(app);

let io = null;
let socketAvailable = false;
try {
  const { Server: IOServer } = require("socket.io");
  io = new IOServer(httpServer, {
    cors: { origin: true, credentials: true }
  });
  socketAvailable = true;
  logger.info('socket.io.loaded');
} catch (err) {
  socketAvailable = false;
  io = null;
  logger.warn('socket.io.missing', { message: 'socket.io not installed. Running without realtime sockets.' });
}

// Safe emit wrapper
function safeEmit(event, payload) {
  try {
    if (socketAvailable && io && typeof io.emit === 'function') {
      io.emit(event, payload);
    }
  } catch (e) {
    logger.warn('safeEmit.error', { event, message: e && e.message ? e.message : String(e) });
  }
}

// Error handler
app.use((err, req, res, next) => {
  if (res.headersSent) {
    logger.warn('api.error.headers_already_sent', { error: err && err.message ? err.message : String(err) });
    return next(err);
  }
  const status = (err && err.status && Number(err.status)) ? Number(err.status) : 500;
  let message = (err && err.publicMessage) ? err.publicMessage : (err && err.message) ? err.message : 'Server error';
  if (status >= 500 && process.env.NODE_ENV === 'production') message = 'Server error';
  logger.error('api.error.unhandled', { status, message, stack: err && err.stack ? err.stack : undefined });
  return res.status(status).json({ error: message });
});

// Startup
async function start() {
  try {
    validateEnv();
    await initDb();
    app.locals.db = pool;

    const PORT = process.env.PORT || 3001;
    httpServer.listen(PORT, () => {
      logger.info("server.started", { port: PORT });
      if (!socketAvailable) {
        logger.warn('server.running_without_socketio', { message: 'Socket.IO not available; realtime disabled.' });
      }
    });

    // Socket.IO connection handling
    if (socketAvailable && io) {
      io.on('connection', (socket) => {
        try {
          logger.info('socket.connected', { id: socket.id });
          socket.on('disconnect', (reason) => {
            logger.info('socket.disconnected', { id: socket.id, reason });
          });
        } catch (e) {
          logger.warn('socket.connection.handler_error', { message: e && e.message ? e.message : String(e) });
        }
      });
    }

  } catch (err) {
    logger.error("server.start.failed", { message: err && err.message ? err.message : String(err) });
    process.exit(1);
  }
}

start();

// Graceful shutdown
let shuttingDown = false;
async function gracefulShutdown(reason = 'signal') {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutdown.start', { reason });
  try {
    try {
      await new Promise((resolve) => {
        httpServer.close(() => resolve());
      });
    } catch (e) {}
    try { if (socketAvailable && io && typeof io.close === 'function') io.close(); } catch (e) {}
    try { if (pool && pool.end) await pool.end(); } catch (e) {}
    logger.info('shutdown.complete');
    process.exit(0);
  } catch (e) {
    logger.error('shutdown.error', { message: e && e.message ? e.message : String(e) });
    process.exit(1);
  }
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('uncaughtException', (err) => { logger.error('uncaughtException', { message: err && err.message ? err.message : String(err) }); gracefulShutdown('uncaughtException'); });
process.on('unhandledRejection', (reason) => { logger.error('unhandledRejection', { reason: reason && reason.message ? reason.message : String(reason) }); gracefulShutdown('unhandledRejection'); });

module.exports = { app, httpServer, _internal: { socketAvailable } };
