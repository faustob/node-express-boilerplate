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
  // Metrics pipeline: OTLP endpoint comes from OTEL_EXPORTER_OTLP_ENDPOINT (never hardcoded).
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  // Official HTTP/Express integrations emit http.server.request.duration with semconv attributes.
  instrumentations: [getNodeAutoInstrumentations()],
});

// Tolerate an OTel language agent / preloaded SDK already owning the global providers.
try {
  sdk.start();
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn('OpenTelemetry SDK already registered; using the existing global provider.', err && err.message);
}

const tracer = trace.getTracer('node-express-boilerplate');

// Meter and instruments are created AFTER sdk.start() — OTel-JS does not rebind
// meters obtained before the SDK registers.
const meter = metrics.getMeter('node-express-boilerplate');

/** Inbound request duration, in SECONDS, per OTel HTTP server semantic conventions. */
const httpServerRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP requests',
  unit: 's',
});

/** Request outcome counter backing the availability SLI (success = status < 500). */
const httpServerRequestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route and outcome class',
});

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

/**
 * Express middleware recording the HTTP server SLIs on response completion.
 * Uses the matched route TEMPLATE (never the raw path) to keep cardinality low.
 */
function httpMetricsMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
    const route = (req.route && req.route.path && `${req.baseUrl || ''}${req.route.path}`) || req.baseUrl || 'unknown';
    const statusCode = res.statusCode;
    const attributes = {
      'http.request.method': req.method,
      'url.scheme': req.protocol,
      'http.route': route,
      'http.response.status_code': statusCode,
      'network.protocol.version': req.httpVersion,
    };
    if (statusCode >= 500) {
      attributes['error.type'] = String(statusCode);
    }
    httpServerRequestDuration.record(durationSeconds, attributes);
    httpServerRequestOutcomes.add(1, {
      'http.route': route,
      'http.request.method': req.method,
      outcome: statusCode < 500 ? 'success' : 'failure',
    });
  });
  next();
}

module.exports = { sdk, tracer, withSpan, meter, httpMetricsMiddleware };
