const logger = require('./logger');

function sendError(res, status = 500, message = 'Server error', detail) {
  try {
    logger.error('api.error.response', { status, message, detail });
  } catch (e) {
    console.error('apiResponses.logger_failed', e && e.message ? e.message : e);
  }

  const body = { error: message };
  body.errorCode = status;

  if (detail && process.env.NODE_ENV !== 'production') {
    body.detail = typeof detail === 'string' ? detail : JSON.stringify(detail);
  }

  try {
    return res.status(status).json(body);
  } catch (e) {
    try { return res.status(status).send(body.error); } catch (e2) { return res.end(); }
  }
}

function sendSuccess(res, payload = {}) {
  try {
    return res.json(payload);
  } catch (e) {
    logger.error('api.success.send_failed', { message: e && e.message ? e.message : String(e) });
    try { return res.send(typeof payload === 'string' ? payload : JSON.stringify(payload)); } catch (e2) { return res.end(); }
  }
}

function wrapAsync(fn) {
  return function (req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = {
  sendError,
  sendSuccess,
  wrapAsync
};
