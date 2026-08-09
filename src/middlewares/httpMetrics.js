/**
 * Server-level HTTP metrics for the availability and P95 latency SLIs.
 *
 * Attached as an additional 'request' listener on the http.Server returned by app.listen(),
 * so the express middleware stack, response objects and control flow stay completely untouched
 * (no response wrapping -> streaming / upgrades keep working).
 */
const {
  recordHttpServerRequestDuration,
  addHttpServerRequest,
  addHttpServerActiveRequests,
} = require('../config/metrics');

const KNOWN_TIERS = ['standard', 'premium', 'enterprise'];

/** Matched route TEMPLATE (never the raw path): express sets req.route when a route matches. */
const resolveRoute = (req) => {
  if (req.route && req.route.path) {
    return `${req.baseUrl || ''}${req.route.path}`;
  }
  return undefined;
};

/** Business dimension, clamped to a known set to keep cardinality bounded. */
const resolveTier = (req) => {
  const tier = String(req.headers['x-tenant-tier'] || '').toLowerCase();
  return KNOWN_TIERS.includes(tier) ? tier : 'standard';
};

const instrumentHttpServer = (server) => {
  server.on('request', (req, res) => {
    const startedAt = process.hrtime.bigint();
    const method = (req.method || 'GET').toUpperCase();
    const scheme = req.socket && req.socket.encrypted ? 'https' : 'http';
    const inFlightAttributes = { 'http.request.method': method, 'url.scheme': scheme };
    addHttpServerActiveRequests(1, inFlightAttributes);

    let recorded = false;
    const record = () => {
      if (recorded) {
        return;
      }
      recorded = true;
      addHttpServerActiveRequests(-1, inFlightAttributes);

      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      const route = resolveRoute(req);
      const statusCode = res.statusCode;
      const responded = Boolean(res.headersSent);

      const attributes = { ...inFlightAttributes, 'network.protocol.version': req.httpVersion };
      if (route) {
        attributes['http.route'] = route;
      }
      if (responded) {
        attributes['http.response.status_code'] = statusCode;
        if (statusCode >= 500) {
          attributes['error.type'] = `${statusCode}`;
        }
      } else {
        attributes['error.type'] = 'connection_closed';
      }

      recordHttpServerRequestDuration(durationSeconds, attributes);
      addHttpServerRequest(1, {
        'http.request.method': method,
        'http.route': route || 'unmatched',
        outcome: responded && statusCode < 500 ? 'success' : 'failure',
        tier: resolveTier(req),
      });
    };

    res.on('finish', record);
    res.on('close', record);
  });
};

module.exports = { instrumentHttpServer };
