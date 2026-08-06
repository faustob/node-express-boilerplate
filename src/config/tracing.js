/**
 * OpenTelemetry tracing bootstrap — traces only (no metrics instruments).
 * Spans are exported via OTLP to the collector configured through
 * OTEL_EXPORTER_OTLP_* env vars (see docker-compose otel-collector service).
 */
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { trace } = require('@opentelemetry/api');
const { metrics } = require('@opentelemetry/api');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  // metrics pipeline: exports via OTEL_EXPORTER_OTLP_ENDPOINT (no hardcoded endpoint)
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  // official framework integrations: emit http.server.request.duration (seconds)
  // with semconv http.request.method / http.route / http.response.status_code
  instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
});
sdk.start();

const tracer = trace.getTracer('node-express-boilerplate');

const meter = metrics.getMeter('node-express-boilerplate');

/** Availability SLI: inbound requests by route + outcome class (success/failure). */
const httpRequestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'Inbound HTTP requests by route template and outcome class',
});

/** Concurrency signal: requests currently being served (goes up and down). */
const httpActiveRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of inbound HTTP requests currently in flight',
});

/**
 * Express middleware recording the request-outcome counter used by the
 * availability SLI. Latency (http.server.request.duration, seconds) comes from
 * the HTTP/Express auto-instrumentation registered above.
 */
function httpMetricsMiddleware(req, res, next) {
  const baseAttributes = {
    'http.request.method': req.method,
    'url.scheme': req.protocol,
  };
  httpActiveRequests.add(1, baseAttributes);
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    // route TEMPLATE (low cardinality), never the raw path
    const route = (req.route && req.route.path) || (req.baseUrl ? `${req.baseUrl}/*` : 'unknown');
    const statusCode = res.statusCode;
    const attributes = {
      ...baseAttributes,
      'http.route': route,
      'http.response.status_code': statusCode,
      outcome: statusCode < 500 ? 'success' : 'failure',
    };
    if (statusCode >= 500) {
      attributes['error.type'] = String(statusCode);
    }
    httpActiveRequests.add(-1, baseAttributes);
    httpRequestOutcomes.add(1, attributes);
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

module.exports = { sdk, tracer, withSpan, meter, httpMetricsMiddleware, httpRequestOutcomes, httpActiveRequests };
