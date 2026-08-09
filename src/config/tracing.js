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
  // Metrics pipeline; endpoint comes from OTEL_EXPORTER_OTLP_ENDPOINT (never hardcoded).
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  // http/express auto-instrumentation for semconv HTTP server telemetry.
  instrumentations: [getNodeAutoInstrumentations()],
});
try {
  sdk.start();
} catch (err) {
  // An OTel agent/preload may already have registered a global SDK; keep using that one.
  diag.warn('OpenTelemetry SDK already registered; using the existing global provider', err);
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

/**
 * HTTP SLI instruments, resolved LAZILY on first request.
 *
 * OTel-JS does not proxy meters: metrics.getMeter() evaluated on the same
 * synchronous pass as sdk.start() would return a NoopMeter whose instruments
 * never rebind. Resolving on first use guarantees the global MeterProvider
 * registered by sdk.start() is already in place.
 */
let instruments;

function getInstruments() {
  if (!instruments) {
    const meter = metrics.getMeter('node-express-boilerplate');
    instruments = {
      meter,
      // Inbound HTTP request duration in SECONDS (OTel semconv) — backs the P95 latency SLI.
      httpServerRequestDuration: meter.createHistogram('http.server.request.duration', {
        description: 'Duration of inbound HTTP server requests',
        unit: 's',
      }),
      // Inbound requests by route, status code and outcome class — backs the availability SLI.
      httpServerRequestCount: meter.createCounter('http.server.request.count', {
        description: 'Number of inbound HTTP requests served',
      }),
      // Requests currently being served (goes up and down).
      httpServerActiveRequests: meter.createUpDownCounter('http.server.active_requests', {
        description: 'Number of in-flight inbound HTTP requests',
      }),
    };
  }
  return instruments;
}

module.exports = { sdk, tracer, withSpan, getInstruments };
