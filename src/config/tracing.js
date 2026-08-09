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
const { trace, metrics, diag } = require('@opentelemetry/api');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  // Metrics pipeline: exports over OTLP/HTTP to the endpoint given by
  // OTEL_EXPORTER_OTLP_ENDPOINT (never hardcoded here).
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  // Auto-instrumentation emits the semconv `http.server.request.duration`
  // histogram (seconds) with http.request.method / http.route /
  // http.response.status_code, plus express route templates and mongodb spans.
  instrumentations: [getNodeAutoInstrumentations()],
});
// Registering the SDK sets the global tracer/meter providers. If an OTel agent
// already registered a global provider, keep using that one instead of crashing.
try {
  sdk.start();
} catch (err) {
  diag.warn('OpenTelemetry SDK already registered; using the existing global provider', err);
}

const tracer = trace.getTracer('node-express-boilerplate');

// Meter is obtained AFTER sdk.start() above so instruments bind to the real provider.
const meter = metrics.getMeter('node-express-boilerplate');

/** HTTP requests by route template and outcome class — backs the availability SLI. */
const httpRequestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route template and outcome class',
});

/** Request duration with a business dimension (tenant tier) for cohort-aware latency SLOs. */
const httpRequestDurationByTier = meter.createHistogram('http.server.request.duration.by_tier', {
  description: 'Inbound HTTP request duration by route template and tenant tier',
  unit: 's',
});

/** Requests currently being served — goes up and down, so an UpDownCounter. */
const httpActiveRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of in-flight inbound HTTP requests',
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

module.exports = {
  sdk,
  tracer,
  withSpan,
  meter,
  httpRequestOutcomes,
  httpRequestDurationByTier,
  httpActiveRequests,
};
