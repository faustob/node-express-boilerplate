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
// Start the SDK before resolving any tracer/meter so instruments bind to the real
// providers. A genuine startup failure must surface rather than be swallowed.
sdk.start();

const tracer = trace.getTracer('node-express-boilerplate');
const meter = metrics.getMeter('node-express-boilerplate');

/** Inbound HTTP request duration, seconds (OTel semconv). */
const httpServerRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP server requests',
  unit: 's',
});

/** Requests by route and outcome class, for availability. */
const httpServerRequestOutcomes = meter.createCounter('http.server.requests', {
  description: 'HTTP requests by route and outcome class',
});

/** Business/auth operation outcomes (register, login, ...). */
const authOperations = meter.createCounter('auth.operations', {
  description: 'Authentication operations by operation name and outcome',
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

/** Express middleware recording semconv HTTP server metrics on response finish. */
function httpMetricsMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
    const route = (req.route && req.baseUrl ? req.baseUrl + req.route.path : req.route && req.route.path) || 'unknown';
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
    httpServerRequestOutcomes.add(1, {
      'http.route': route,
      'http.request.method': req.method,
      outcome: res.statusCode < 500 ? 'success' : 'failure',
    });
  });
  next();
}

module.exports = { sdk, tracer, meter, withSpan, httpMetricsMiddleware, authOperations };
