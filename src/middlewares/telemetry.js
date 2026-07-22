const { metrics } = require('@opentelemetry/api');

// Custom business-level SLI instruments, built on top of the OTel API.
// The global MeterProvider is registered once in otel.js at process
// startup (required as the first line of src/index.js), so getMeter here
// resolves to the real provider, not a no-op.
const meter = metrics.getMeter('node-express-boilerplate');

const requestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route and outcome class',
});

const requestDurationByTier = meter.createHistogram('business.request.duration', {
  description: 'HTTP request duration tagged with a business dimension (tenant tier)',
  unit: 's',
});

const requestTelemetryMiddleware = (req, res, next) => {
  const start = performance.now();
  res.on('finish', () => {
    const route = (req.route && req.route.path) || req.baseUrl || 'unknown';
    const outcome = res.statusCode < 500 ? 'success' : 'failure';

    requestOutcomes.add(1, {
      route,
      outcome,
    });

    requestDurationByTier.record((performance.now() - start) / 1000, {
      route,
      tier: req.headers['x-tenant-tier'] || 'standard',
    });
  });
  next();
};

module.exports = requestTelemetryMiddleware;
