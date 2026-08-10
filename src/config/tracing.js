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
  // An OTel agent/SDK may already be registered globally (e.g. via --require);
  // in that case keep using the existing global providers instead of crashing.
  // eslint-disable-next-line no-console
  console.warn('OpenTelemetry SDK already started or failed to start:', err && err.message);
}

const tracer = trace.getTracer('node-express-boilerplate');
const meter = metrics.getMeter('node-express-boilerplate');

/** Inbound HTTP request duration in SECONDS (OTel semconv). */
const httpServerRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP server requests',
  unit: 's',
});

/** Request outcome counter for availability (success / failure by route). */
const httpServerRequestOutcomes = meter.createCounter('http.server.request.count', {
  description: 'HTTP requests by route and outcome class',
});

/**
 * Express middleware recording semconv HTTP server latency + an outcome counter.
 * Purely additive: it only observes the response 'finish'/'close' events.
 */
function httpMetricsMiddleware(req, res, next) {
  const startNs = process.hrtime.bigint();
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    const route = (req.route && req.route.path) || (req.baseUrl ? `${req.baseUrl}` : undefined);
    const attributes = {
      'http.request.method': req.method,
      'url.scheme': req.protocol,
      'http.response.status_code': res.statusCode,
      'http.route': route || 'unknown',
      'network.protocol.version': req.httpVersion,
    };
    if (res.statusCode >= 500) {
      attributes['error.type'] = String(res.statusCode);
    }
    httpServerRequestDuration.record(durationSeconds, attributes);
    httpServerRequestOutcomes.add(1, {
      'http.request.method': req.method,
      'http.route': route || 'unknown',
      'http.response.status_code': res.statusCode,
      outcome: res.statusCode < 500 ? 'success' : 'failure',
    });
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

/** Auth outcome counter (business SLI: registration / login success rate). */
const authOperations = meter.createCounter('auth.operations', {
  description: 'Authentication operations by type and outcome',
});

module.exports = { sdk, tracer, meter, withSpan, httpMetricsMiddleware, authOperations };
