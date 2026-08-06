const {
  getHttpServerRequests,
  getHttpServerRequestDuration,
  getHttpServerActiveRequests,
} = require('../config/telemetry');

/**
 * Records the HTTP availability + latency SLIs for every inbound request.
 * Uses the MATCHED route template (never the raw path) to keep attribute
 * cardinality bounded, and does not alter request/response handling.
 */
const httpTelemetry = (req, res, next) => {
  const startNs = process.hrtime.bigint();
  const baseAttributes = {
    'http.request.method': req.method,
    'url.scheme': req.protocol,
  };
  getHttpServerActiveRequests().add(1, baseAttributes);

  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;

    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    // Route TEMPLATE only — falls back to the mount path, never the raw URL.
    const routeTemplate = (req.route && req.route.path) || req.baseUrl || 'unmatched';
    const route = `${req.baseUrl && req.route ? req.baseUrl : ''}${req.route ? req.route.path : routeTemplate}` || 'unmatched';
    const statusCode = res.statusCode;

    const attributes = {
      ...baseAttributes,
      'http.route': route,
      'http.response.status_code': statusCode,
      'network.protocol.version': req.httpVersion,
    };
    if (statusCode >= 500) {
      attributes['error.type'] = String(statusCode);
    }

    getHttpServerActiveRequests().add(-1, baseAttributes);
    getHttpServerRequestDuration().record(durationSeconds, attributes);
    getHttpServerRequests().add(1, {
      ...attributes,
      outcome: statusCode < 500 ? 'success' : 'failure',
    });
  };

  res.on('finish', record);
  res.on('close', record);

  next();
};

module.exports = httpTelemetry;
