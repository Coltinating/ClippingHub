import pino from 'pino';

// In-memory event ring shared between the pino logger and the admin event-stream.
// Capped at MAX_EVENTS to bound memory; oldest entries drop off the front.
const MAX_EVENTS = 5000;
const ring = [];
const subscribers = new Set(); // each entry is a function(event)

function record(level, payload, message) {
  const evt = {
    ts: Date.now(),
    level,
    message: message || (payload && payload.evt) || '',
    ...((typeof payload === 'object' && payload) ? payload : { value: payload })
  };
  ring.push(evt);
  if (ring.length > MAX_EVENTS) ring.shift();
  // Fan-out to subscribers (admin web panels). Errors in one subscriber must not
  // stop the others.
  for (const fn of subscribers) {
    try { fn(evt); } catch (_) { /* ignore */ }
  }
  return evt;
}

export function makeLogger(level = 'info') {
  const pinoLogger = pino({
    level,
    transport: process.env.NODE_ENV === 'production'
      ? undefined
      : { target: 'pino-pretty', options: { colorize: true } }
  });

  // Wrap each level so calls land in BOTH pino (stdout) AND the event ring.
  function wrap(lvl, pinoFn) {
    return function (payload, message) {
      try { pinoFn.call(pinoLogger, payload, message); } catch (_) {}
      record(lvl, payload, message);
    };
  }

  return {
    trace: wrap('trace', pinoLogger.trace),
    debug: wrap('debug', pinoLogger.debug),
    info:  wrap('info',  pinoLogger.info),
    warn:  wrap('warn',  pinoLogger.warn),
    error: wrap('error', pinoLogger.error),
    fatal: wrap('fatal', pinoLogger.fatal)
  };
}

export function getEventRing() { return ring.slice(); }

export function subscribeEvents(fn) {
  subscribers.add(fn);
  return function unsubscribe() { subscribers.delete(fn); };
}
