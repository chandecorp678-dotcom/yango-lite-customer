const logger = require('./logger');

class RateLimiter {
  constructor(opts = {}) {
    this.maxRequests = opts.maxRequests || 5;
    this.windowMs = opts.windowMs || 60000;
    this.pruneIntervalMs = opts.pruneIntervalMs || 300000;
    this.store = new Map();
    this._startPrune();
  }

  _startPrune() {
    if (this.pruneTimer) return;
    try {
      this.pruneTimer = setInterval(() => this.prune(), this.pruneIntervalMs);
      if (typeof this.pruneTimer.unref === 'function') this.pruneTimer.unref();
    } catch (e) {
      logger.warn('rateLimiter.prune_start_failed', { message: e && e.message ? e.message : String(e) });
    }
  }

  check(key) {
    if (!key) return { allowed: false, remaining: 0, resetAt: null };

    const now = Date.now();
    let entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      entry = { count: 1, resetAt: now + this.windowMs };
      this.store.set(key, entry);
      return { allowed: true, remaining: this.maxRequests - 1, resetAt: entry.resetAt };
    }

    if (entry.count < this.maxRequests) {
      entry.count++;
      return { allowed: true, remaining: this.maxRequests - entry.count, resetAt: entry.resetAt };
    }

    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  reset(key) {
    this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  prune() {
    try {
      const now = Date.now();
      for (const [key, entry] of this.store) {
        if (now >= entry.resetAt) {
          this.store.delete(key);
        }
      }
    } catch (e) {
      logger.warn('rateLimiter.prune_failed', { message: e && e.message ? e.message : String(e) });
    }
  }

  middleware(opts = {}) {
    const keyFn = opts.keyFn || ((req) => req.ip);
    const onLimitExceeded = opts.onLimitExceeded || ((req, res) => {
      res.status(429).json({ error: 'Too many requests, please try again later' });
    });

    return (req, res, next) => {
      const key = keyFn(req);
      const result = this.check(key);

      res.setHeader('X-RateLimit-Limit', this.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, result.remaining));
      if (result.resetAt) {
        res.setHeader('X-RateLimit-Reset', result.resetAt);
      }

      if (!result.allowed) {
        logger.warn('rateLimiter.limit_exceeded', { key, maxRequests: this.maxRequests, windowMs: this.windowMs });
        return onLimitExceeded(req, res);
      }

      next();
    };
  }

  destroy() {
    try {
      if (this.pruneTimer) {
        clearInterval(this.pruneTimer);
        this.pruneTimer = null;
      }
      this.store.clear();
    } catch (e) {
      logger.warn('rateLimiter.destroy_failed', { message: e && e.message ? e.message : String(e) });
    }
  }
}

module.exports = RateLimiter;
