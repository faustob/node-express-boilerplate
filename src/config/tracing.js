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
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

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
  // An OTel agent/SDK may already be registered globally; keep using it.
  // eslint-disable-next-line no-console
  console.warn('OpenTelemetry SDK already registered, reusing existing provider:', err && err.message);
}

const tracer = trace.getTracer('node-express-boilerplate');
const meter = metrics.getMeter('node-express-boilerplate');

/** Inbound HTTP request duration, semconv (seconds). */
const httpServerRequestDuration = meter.createHistogram('http.server.request.duration', {
  description: 'Duration of inbound HTTP server requests',
  unit: 's',
});

/** Availability: requests by route and outcome class. */
const httpServerRequestOutcomes = meter.createCounter('http.server.request.outcomes', {
  description: 'HTTP requests by route and outcome class',
});

/** In-flight inbound HTTP requests. */
const httpServerActiveRequests = meter.createUpDownCounter('http.server.active_requests', {
  description: 'Number of in-flight inbound HTTP requests',
});

/** Express middleware recording semconv HTTP server metrics. */
function metricsMiddleware(req, res, next) {
  const start = process.hrtime.bigint();
  const baseAttrs = {
    'http.request.method': req.method,
    'url.scheme': req.protocol,
  };
  httpServerActiveRequests.add(1, baseAttrs);
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
    const route = (req.route && req.route.path) || (req.baseUrl ? `${req.baseUrl}` : undefined);
    const attrs = { ...baseAttrs };
    if (route) {
      attrs['http.route'] = route;
    }
    attrs['http.response.status_code'] = res.statusCode;
    if (req.httpVersion) {
      attrs['network.protocol.version'] = req.httpVersion;
    }
    if (res.statusCode >= 500) {
      attrs['error.type'] = String(res.statusCode);
    }
    httpServerActiveRequests.add(-1, baseAttrs);
    httpServerRequestDuration.record(durationSeconds, attrs);
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

/** Auth business outcomes (register/login/etc.). */
const authOutcomes = meter.createCounter('auth.operations', {
  description: 'Authentication operations by operation name and outcome',
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

/** Flush and shut down the OTel SDK so the last metric interval / batched spans are exported. */
async function shutdownTelemetry() {
  try {
    await sdk.shutdown();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('OpenTelemetry SDK shutdown failed:', err && err.message);
  }
}

module.exports = { sdk, tracer, withSpan, meter, metricsMiddleware, authOutcomes, shutdownTelemetry };
