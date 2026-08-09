/**
 * OpenTelemetry tracing bootstrap — traces only (no metrics instruments).
 * Spans are exported via OTLP to the collector configured through
 * OTEL_EXPORTER_OTLP_* env vars (see docker-compose otel-collector service).
 */
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { trace, metrics } = require('@opentelemetry/api');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});
// Start the SDK. Failures are not swallowed: the only tolerated case is an
// external OTel agent having already registered a global provider.
sdk.start();

const tracer = trace.getTracer('node-express-boilerplate');

// Instruments are resolved lazily on first use so that they bind to the
// MeterProvider that is actually registered globally (whether by the SDK above
// or by an already-attached agent), never to an early no-op meter.
let meterInstance;
function getMeter() {
  if (!meterInstance) {
    meterInstance = metrics.getMeter('node-express-boilerplate');
  }
  return meterInstance;
}

const instrumentCache = {};
function getInstrument(key, factory) {
  if (!instrumentCache[key]) {
    instrumentCache[key] = factory(getMeter());
  }
  return instrumentCache[key];
}

/** Inbound HTTP request duration (OTel semantic convention, SECONDS). */
const httpServerRequestDuration = {
  record: (value, attributes) =>
    getInstrument('http.server.request.duration', (m) =>
      m.createHistogram('http.server.request.duration', {
        description: 'Duration of inbound HTTP server requests',
        unit: 's',
      })
    ).record(value, attributes),
};

/** Request outcome counter used for the availability SLI. */
const httpServerRequestOutcomes = {
  add: (value, attributes) =>
    getInstrument('http.server.request.outcomes', (m) =>
      m.createCounter('http.server.request.outcomes', {
        description: 'HTTP requests by route and outcome class',
      })
    ).add(value, attributes),
};

/** Concurrent in-flight inbound HTTP requests. */
const httpServerActiveRequests = {
  add: (value, attributes) =>
    getInstrument('http.server.active_requests', (m) =>
      m.createUpDownCounter('http.server.active_requests', {
        description: 'Number of in-flight inbound HTTP requests',
      })
    ).add(value, attributes),
};

/** Business-level auth operation counter (register/login/... outcomes). */
const authOperations = {
  add: (value, attributes) =>
    getInstrument('auth.operations', (m) =>
      m.createCounter('auth.operations', {
        description: 'Authentication controller operations by operation name and outcome',
      })
    ).add(value, attributes),
};

/**
 * Express middleware emitting http.server.request.duration (semconv, seconds),
 * an outcome counter and an in-flight up/down counter.
 */
function httpMetricsMiddleware(req, res, next) {
  const startNs = process.hrtime.bigint();
  const method = (req.method || 'GET').toUpperCase();
  httpServerActiveRequests.add(1, { 'http.request.method': method });
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    const route = (req.route && req.route.path) || (req.baseUrl ? `${req.baseUrl}` : undefined);
    const statusCode = res.statusCode;
    const attributes = {
      'http.request.method': method,
      'url.scheme': req.protocol || 'http',
      'http.response.status_code': statusCode,
      'network.protocol.version': (req.httpVersion || '1.1'),
    };
    if (route) {
      attributes['http.route'] = route;
    }
    if (statusCode >= 500) {
      attributes['error.type'] = String(statusCode);
    }
    httpServerRequestDuration.record(durationSeconds, attributes);
    httpServerRequestOutcomes.add(1, {
      'http.route': route || 'unknown',
      'http.request.method': method,
      'http.response.status_code': statusCode,
      outcome: statusCode < 500 ? 'success' : 'failure',
    });
    httpServerActiveRequests.add(-1, { 'http.request.method': method });
  });
  next();
}

/** Run fn inside a named span; always ends the span. */
function withSpan(name, fn) {
  return tracer.startActiveSpan(name, (span) => {
    try {
      return fn(span);
    } finally {
      span.end();
    }
  });
}

module.exports = {
  sdk,
  tracer,
  withSpan,
  getMeter,
  httpServerRequestDuration,
  httpServerRequestOutcomes,
  httpServerActiveRequests,
  authOperations,
  httpMetricsMiddleware,
};
