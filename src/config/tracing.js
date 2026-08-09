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
sdk.start();

const tracer = trace.getTracer('node-express-boilerplate');
const meter = metrics.getMeter('node-express-boilerplate');

/** Inbound HTTP request latency, in SECONDS (OTel semantic convention). */
const httpServerRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP server requests',
  unit: 's',
});

/** Requests by route and outcome class, for availability. */
const httpServerRequestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route and outcome class',
});

/** Auth business outcomes (register/login/...) by operation and outcome. */
const authOperations = meter.createCounter('auth.operations', {
  description: 'Authentication operations by operation name and outcome',
});

/**
 * Express middleware recording http.server.request.duration (seconds) and an
 * outcome counter, using the matched route TEMPLATE (low cardinality).
 */
function httpMetricsMiddleware(req, res, next) {
  const startNs = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    const route = (req.route && req.baseUrl ? req.baseUrl + req.route.path : (req.route && req.route.path)) || req.baseUrl || 'unknown';
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
      'http.request.method': req.method,
      'http.route': route,
      'http.response.status_code': res.statusCode,
      outcome: res.statusCode < 500 ? 'success' : 'failure',
    });
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

module.exports = { sdk, tracer, meter, withSpan, httpMetricsMiddleware, authOperations };
