/**
 * OpenTelemetry tracing bootstrap — traces only (no metrics instruments).
 * Spans are exported via OTLP to the collector configured through
 * OTEL_EXPORTER_OTLP_* env vars (see docker-compose otel-collector service).
 */
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { trace, metrics } = require('@opentelemetry/api');

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  // metrics are exported via OTLP using the same OTEL_EXPORTER_OTLP_* env configuration
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
});
sdk.start();

const tracer = trace.getTracer('node-express-boilerplate');

// Instruments are created AFTER sdk.start() above so they bind to the registered SDK meter provider.
const meter = metrics.getMeter('node-express-boilerplate');

const httpServerDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP server requests',
  unit: 's',
});

const httpRequestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route and outcome class',
});

/**
 * Express middleware recording OTel semantic-convention HTTP server metrics.
 * Uses the response 'finish' event (no response wrapping, no control-flow change).
 */
function httpMetricsMiddleware(req, res, next) {
  const startTime = process.hrtime.bigint();
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
    // matched route TEMPLATE (e.g. /v1/users/:userId), never the raw path
    const route = req.route ? `${req.baseUrl || ''}${req.route.path}` : undefined;
    const attributes = {
      'http.request.method': req.method,
      'url.scheme': req.protocol,
      'http.response.status_code': res.statusCode,
      'network.protocol.version': req.httpVersion,
    };
    if (route) {
      attributes['http.route'] = route;
    }
    if (res.statusCode >= 500) {
      attributes['error.type'] = String(res.statusCode);
    }
    httpServerDuration.record(durationSeconds, attributes);
    httpRequestOutcomes.add(1, {
      'http.request.method': req.method,
      'http.route': route || 'unknown',
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

module.exports = { sdk, tracer, withSpan, httpMetricsMiddleware };
