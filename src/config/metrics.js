/**
 * OpenTelemetry metric instruments (API-only).
 *
 * The SDK itself is registered globally in ./tracing.js, which src/index.js requires as its
 * first statement — so by the time this module is loaded the global MeterProvider is in place.
 */
const { metrics } = require('@opentelemetry/api');

// Instruments are created LAZILY (memoised on first use) so they bind to the MeterProvider that
// is registered by the SDK bootstrap, not to the no-op meter installed at import time.
let cache = null;

const instruments = () => {
  if (cache) {
    return cache;
  }
  const meter = metrics.getMeter('node-express-boilerplate');
  cache = {
    // Semantic convention: duration of the inbound HTTP request, in SECONDS.
    httpServerRequestDuration: meter.createHistogram('http.server.request.duration', {
      description: 'Duration of inbound HTTP requests',
      unit: 's',
    }),
    // Availability SLI: inbound requests by route template and outcome class.
    httpServerRequestCount: meter.createCounter('http.server.request.count', {
      description: 'Inbound HTTP requests by route and outcome class',
      unit: '{request}',
    }),
    // In-flight requests go up and down -> UpDownCounter.
    httpServerActiveRequests: meter.createUpDownCounter('http.server.active_requests', {
      description: 'Number of in-flight inbound HTTP requests',
      unit: '{request}',
    }),
    // Business signal: authentication operations by operation type and outcome.
    authOperations: meter.createCounter('auth.operations', {
      description: 'Authentication operations by operation type and outcome',
      unit: '{operation}',
    }),
  };
  return cache;
};

const recordHttpServerRequestDuration = (value, attributes) =>
  instruments().httpServerRequestDuration.record(value, attributes);
const addHttpServerRequest = (value, attributes) => instruments().httpServerRequestCount.add(value, attributes);
const addHttpServerActiveRequests = (value, attributes) =>
  instruments().httpServerActiveRequests.add(value, attributes);
const addAuthOperation = (value, attributes) => instruments().authOperations.add(value, attributes);

module.exports = {
  recordHttpServerRequestDuration,
  addHttpServerRequest,
  addHttpServerActiveRequests,
  addAuthOperation,
};
