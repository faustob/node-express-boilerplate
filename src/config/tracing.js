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
  // Metrics pipeline: OTLP endpoint comes from OTEL_EXPORTER_OTLP_* env vars.
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  // Official HTTP/Express integrations emit http.server.request.duration with semconv attributes.
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
});
sdk.start();

const tracer = trace.getTracer('node-express-boilerplate');
const meter = metrics.getMeter('node-express-boilerplate');

/**
 * Latency SLI (p95) AND availability SLI, in one semconv histogram, in SECONDS.
 * Availability is computed from its count series:
 *   count(http.server.request.duration{http.response.status_code < 500})
 *     / count(http.server.request.duration)
 * so no separate outcome counter is needed (it would double-count the same event).
 */
const httpServerRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP requests',
  unit: 's',
});

/** Concurrency: requests currently being handled (goes up and down). */
const httpServerActiveRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of in-flight inbound HTTP requests',
});

/** Matched route TEMPLATE (never the raw path) to keep attribute cardinality low. */
function routeTemplate(req) {
  const base = req.baseUrl || '';
  const path = req.route && req.route.path ? req.route.path : '';
  const template = `${base}${path === '/' ? '' : path}`;
  return template || 'unmatched';
}

/**
 * Express middleware recording the HTTP availability and latency SLIs.
 * Purely observational: it never touches the response or the middleware chain outcome.
 */
function httpMetricsMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();
  const inFlightAttributes = { 'http.request.method': req.method };
  httpServerActiveRequests.add(1, inFlightAttributes);
  let recorded = false;

  const record = () => {
    if (recorded) return;
    recorded = true;
    httpServerActiveRequests.add(-1, inFlightAttributes);
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
    const statusCode = res.statusCode;
    const attributes = {
      'http.request.method': req.method,
      'url.scheme': req.protocol,
      'http.route': routeTemplate(req),
      'http.response.status_code': statusCode,
      'network.protocol.version': req.httpVersion,
    };
    if (statusCode >= 500) {
      attributes['error.type'] = String(statusCode);
    }
    httpServerRequestDuration.record(durationSeconds, attributes);
  };

  res.on('finish', record);
  res.on('close', record);
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

module.exports = { sdk, tracer, meter, withSpan, httpMetricsMiddleware };
