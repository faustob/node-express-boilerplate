const { getInstruments } = require('../config/telemetry');

/**
 * Records HTTP server availability + latency SLI metrics.
 * Uses the matched Express route TEMPLATE (low cardinality), never the raw URL.
 */
const telemetry = (req, res, next) => {
  const { requestCount, requestDuration, requestsInFlight } = getInstruments();
  const startNs = process.hrtime.bigint();
  requestsInFlight.add(1, { 'http.request.method': req.method });

  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    const routeTemplate = (req.route && `${req.baseUrl || ''}${req.route.path}`) || req.baseUrl || 'unknown';
    const statusCode = res.statusCode;

    const attributes = {
      'http.request.method': req.method,
      'url.scheme': req.protocol,
      'http.route': routeTemplate,
      'http.response.status_code': statusCode,
      'network.protocol.version': req.httpVersion,
    };

    if (statusCode >= 500) {
      attributes['error.type'] = String(statusCode);
    }

    requestDuration.record(durationSeconds, attributes);
    requestCount.add(1, {
      'http.request.method': req.method,
      'http.route': routeTemplate,
      'http.response.status_code': statusCode,
      'http.outcome': statusCode < 500 ? 'success' : 'failure',
    });
    requestsInFlight.add(-1, { 'http.request.method': req.method });
  });

  next();
};

module.exports = telemetry;
