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

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter(),
  }),
});
sdk.start();

const tracer = trace.getTracer('node-express-boilerplate');
const meter = metrics.getMeter('node-express-boilerplate');

/** Inbound HTTP request duration, seconds (OTel semconv). */
const httpServerDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP server requests',
  unit: 's',
});

/** Request outcome counter used for the availability SLI. */
const httpRequestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route and outcome class',
});

/** In-flight inbound HTTP requests. */
const httpActiveRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of in-flight inbound HTTP requests',
});

/** Successful auth operations (register/login) — business signal. */
const authOperations = meter.createCounter('auth.operations', {
  description: 'Authentication operations by operation name and outcome',
});

/**
 * Attach HTTP server metrics to an http.Server without touching the Express
 * middleware chain: we only observe the request/response lifecycle.
 */
function instrumentHttpServer(server) {
  server.on('request', (req, res) => {
    const startTime = process.hrtime.bigint();
    const baseAttributes = {
      'http.request.method': req.method,
      'url.scheme': req.secure ? 'https' : 'http',
    };
    httpActiveRequests.add(1, baseAttributes);
    let settled = false;
    const record = (errorType) => {
      if (settled) {
        return;
      }
      settled = true;
      const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
      // Matched route TEMPLATE (low cardinality), never the raw path.
      const route = req.route ? `${req.baseUrl || ''}${req.route.path}` : 'unmatched';
      const attributes = {
        ...baseAttributes,
        'http.route': route,
        'network.protocol.version': req.httpVersion,
      };
      if (errorType) {
        attributes['error.type'] = errorType;
      } else {
        attributes['http.response.status_code'] = res.statusCode;
        if (res.statusCode >= 500) {
          attributes['error.type'] = String(res.statusCode);
        }
      }
      httpServerDuration.record(durationSeconds, attributes);
      httpRequestOutcomes.add(1, {
        'http.request.method': req.method,
        'http.route': route,
        'http.response.status_code': errorType ? 0 : res.statusCode,
        outcome: !errorType && res.statusCode < 500 ? 'success' : 'failure',
      });
      httpActiveRequests.add(-1, baseAttributes);
    };
    res.on('finish', () => record(null));
    res.on('close', () => record(res.writableFinished ? null : 'connection_closed'));
  });
  return server;
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

module.exports = { sdk, tracer, withSpan, meter, instrumentHttpServer, authOperations };
