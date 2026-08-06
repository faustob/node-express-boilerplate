/*
 * Shared OpenTelemetry instruments for this service.
 * The SDK is registered in src/otel.js at process startup; here we only read
 * the global meter via @opentelemetry/api.
 */
const { metrics } = require('@opentelemetry/api');

// Metrics have NO proxy provider in OTel-JS: a meter/instrument resolved at
// import time (before the SDK registers) would be a permanent no-op. So the
// meter and every instrument are resolved LAZILY on first use and memoised.
let memoMeter;
const getMeter = () => {
  if (!memoMeter) {
    memoMeter = metrics.getMeter('node-express-boilerplate');
  }
  return memoMeter;
};

const memo = {};
const lazy = (key, factory) => () => {
  if (!memo[key]) {
    memo[key] = factory(getMeter());
  }
  return memo[key];
};

// Availability SLI: inbound requests by route template and outcome class.
const getHttpServerRequests = lazy('httpServerRequests', (m) =>
  m.createCounter('http.server.requests', {
    description: 'Inbound HTTP requests by route template and outcome class',
  })
);

// Latency SLI: semconv inbound request duration histogram, in SECONDS.
const getHttpServerRequestDuration = lazy('httpServerRequestDuration', (m) =>
  m.createHistogram('http.server.request.duration', {
    description: 'Duration of inbound HTTP requests',
    unit: 's',
  })
);

// Concurrency: goes up and down, so an UpDownCounter.
const getHttpServerActiveRequests = lazy('httpServerActiveRequests', (m) =>
  m.createUpDownCounter('http.server.active_requests', {
    description: 'Number of in-flight inbound HTTP requests',
  })
);

// Business signal for the auth flows this boilerplate exposes.
const getAuthOperations = lazy('authOperations', (m) =>
  m.createCounter('auth.operations', {
    description: 'Authentication operations by operation and outcome',
  })
);

module.exports = {
  getMeter,
  getHttpServerRequests,
  getHttpServerRequestDuration,
  getHttpServerActiveRequests,
  getAuthOperations,
};
