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
try {
  sdk.start();
} catch (err) {
  // An OTel agent/SDK may already be registered globally; keep running with it.
  // eslint-disable-next-line no-console
  console.warn('OpenTelemetry SDK already started or failed to start:', err && err.message);
}

const tracer = trace.getTracer('node-express-boilerplate');
const meter = metrics.getMeter('node-express-boilerplate');

/** Requests by route + outcome class (availability SLI). */
const requestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route and outcome class',
});

/** Inbound request duration in SECONDS (OTel semantic convention). */
const httpServerRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP server requests',
  unit: 's',
});

/** Business-level auth operation outcomes (register/login/...). */
const authOperations = meter.createCounter('auth.operations', {
  description: 'Authentication operations by operation name and outcome',
});

/**
 * Express middleware recording http.server.request.duration and request outcomes.
 * Uses the matched route TEMPLATE to keep attribute cardinality low.
 */
function httpMetricsMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
    const route = (req.route && req.route.path) || req.baseUrl || 'unknown';
    const attributes = {
      'http.request.method': req.method,
      'url.scheme': req.protocol,
      'http.route': route,
      'http.response.status_code': res.statusCode,
      'network.protocol.version': req.httpVersion,
    };
    if (res.statusCode >= 500) {
      attributes['error.type'] = String(res.statusCode);
    }
    httpServerRequestDuration.record(durationSeconds, attributes);
    requestOutcomes.add(1, {
      'http.route': route,
      'http.request.method': req.method,
      outcome: res.statusCode < 500 ? 'success' : 'failure',
    });
  });
  next();
}

/**
 * Flush and shut down the OTel SDK so buffered metrics/spans are exported
 * before the process exits. Never rejects.
 */
function shutdownTelemetry() {
  return Promise.resolve()
    .then(() => sdk.shutdown())
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn('OpenTelemetry SDK shutdown failed:', err && err.message);
    });
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

module.exports = { sdk, tracer, meter, withSpan, httpMetricsMiddleware, authOperations, shutdownTelemetry };
