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

// Auto-instrumentation for http/express emits the semantic-convention metric
// `http.server.request.duration` (histogram, SECONDS) with http.request.method,
// http.route and http.response.status_code — the metric both target SLIs query.
// The OTLP endpoint stays env-driven via OTEL_EXPORTER_OTLP_ENDPOINT.
const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

// Register defensively: an OTel language agent may already have registered a
// global SDK (via --require/NODE_OPTIONS outside this repo). Starting a second
// one must never crash the app — fall back to the agent's global provider.
try {
  sdk.start();
} catch (err) {
  // eslint-disable-next-line no-console
  console.warn(`OpenTelemetry SDK already registered, using existing provider: ${err.message}`);
}

const tracer = trace.getTracer('node-express-boilerplate');
const meter = metrics.getMeter('node-express-boilerplate');

// SLI: HTTP Service Availability — requests by route and outcome class.
const requestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route and outcome class',
});

// SLI: HTTP Response Time P95 — route latency with a business dimension
// (tenant tier) for cohort-aware latency SLOs.
const requestDurationBusiness = meter.createHistogram('http.server.request.duration.business', {
  description: 'Inbound HTTP request duration by route and tenant tier',
  unit: 'ms',
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
 * Express middleware recording the SLI instruments on response completion.
 * Purely observational: it never touches the response and always calls next().
 */
function sliMetricsMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();
  res.on('finish', () => {
    // Use the MATCHED route template (e.g. /v1/users/:userId), never the raw
    // path, to keep metric cardinality bounded. req.route is only populated
    // after routing, which has happened by the time 'finish' fires.
    const route = req.route && req.route.path ? `${req.baseUrl || ''}${req.route.path}` : 'unknown';
    const durationMs = Number(process.hrtime.bigint() - startTime) / 1e6;

    requestOutcomes.add(1, {
      'http.request.method': req.method,
      'http.route': route,
      'http.response.status_code': res.statusCode,
      outcome: res.statusCode < 500 ? 'success' : 'failure',
    });

    requestDurationBusiness.record(durationMs, {
      'http.request.method': req.method,
      'http.route': route,
      'http.response.status_code': res.statusCode,
      tier: req.headers['x-tenant-tier'] || 'standard',
    });
  });
  next();
}

module.exports = { sdk, tracer, meter, withSpan, sliMetricsMiddleware };
