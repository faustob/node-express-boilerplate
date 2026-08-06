const { metrics } = require('@opentelemetry/api');

// Instruments are resolved lazily on first use so the globally-registered SDK
// meter provider is picked up regardless of module load order.
let instruments;

const getInstruments = () => {
  if (!instruments) {
    const meter = metrics.getMeter('node-express-boilerplate');
    instruments = {
      meter,
      httpServerRequestDuration: meter.createHistogram('http.server.request.duration', {
        description: 'Duration of inbound HTTP server requests',
        unit: 's',
      }),
      httpServerRequestOutcomes: meter.createCounter('http.server.request.outcomes', {
        description: 'HTTP requests by route and outcome class',
      }),
      httpServerActiveRequests: meter.createUpDownCounter('http.server.active_requests', {
        description: 'Number of in-flight inbound HTTP requests',
      }),
    };
  }
  return instruments;
};

// Returns the low-cardinality matched route template, never the raw path.
const routeTemplate = (req) => {
  if (req.route && req.route.path) {
    const base = req.baseUrl || '';
    return `${base}${req.route.path}` || req.route.path;
  }
  return req.baseUrl || 'unknown';
};

const httpMetrics = () => (req, res, next) => {
  const { httpServerRequestDuration, httpServerRequestOutcomes, httpServerActiveRequests } = getInstruments();
  const start = process.hrtime.bigint();
  const baseAttributes = {
    'http.request.method': req.method,
    'url.scheme': req.protocol,
  };
  httpServerActiveRequests.add(1, baseAttributes);

  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = routeTemplate(req);
    const attributes = {
      ...baseAttributes,
      'http.route': route,
      'http.response.status_code': res.statusCode,
      'network.protocol.version': req.httpVersion,
    };
    if (res.statusCode >= 500) {
      attributes['error.type'] = String(res.statusCode);
    }
    httpServerActiveRequests.add(-1, baseAttributes);
    httpServerRequestDuration.record(durationSeconds, attributes);
    httpServerRequestOutcomes.add(1, {
      'http.request.method': req.method,
      'http.route': route,
      'http.response.status_code': res.statusCode,
      outcome: res.statusCode < 500 ? 'success' : 'failure',
    });
  };

  res.on('finish', record);
  res.on('close', record);
  next();
};

module.exports = {
  httpMetrics,
  getInstruments,
};
