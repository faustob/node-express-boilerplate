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
  // Endpoint is env-driven via OTEL_EXPORTER_OTLP_ENDPOINT (see otel-collector-config.yaml).
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  // Emits http.server.request.duration (semconv) with http.request.method /
  // http.route / http.response.status_code for the HTTP availability + latency SLIs.
  instrumentations: [getNodeAutoInstrumentations()],
});
// Register the SDK globally BEFORE any instrument is created below, so the meter
// binds to the real MeterProvider. Only the "already registered" case (an OTel
// agent/preload attached at runtime) is tolerated; any genuine startup failure is
// rethrown rather than swallowed, so it can never leave metrics silently no-op.
try {
  sdk.start();
} catch (err) {
  if (!/already (been )?registered|already started/i.test((err && err.message) || '')) {
    throw err;
  }
}

const tracer = trace.getTracer('node-express-boilerplate');

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

// Created AFTER sdk.start() above, so these bind to the registered MeterProvider.
const meter = metrics.getMeter('node-express-boilerplate');

/** SLI: HTTP availability — request count by route template; outcome class is an attribute. */
const httpServerRequest = meter.createCounter('http.server.request', {
  description: 'Inbound HTTP requests, dimensioned by route template and outcome class',
});

/** SLI: HTTP latency P95 — request duration in SECONDS with a business dimension. */
const httpServerRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of the inbound HTTP request',
  unit: 's',
});

// Both instruments are recorded on every response in src/app.js.
module.exports = { sdk, tracer, withSpan, meter, httpServerRequest, httpServerRequestDuration };
