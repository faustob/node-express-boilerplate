/*
 * OpenTelemetry SDK bootstrap for this Express service.
 * Loaded as the FIRST require in src/index.js so it registers the global
 * tracer/meter providers before any instrumented module is loaded.
 *
 * Endpoint is env-driven (OTEL_EXPORTER_OTLP_ENDPOINT). Registration is
 * guarded so that if an OTel agent/preload already registered a global SDK,
 * this process still starts normally and simply uses the existing provider.
 */
/* eslint-disable global-require */
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');

if (process.env.OTEL_DIAG_LOG_LEVEL === 'debug') {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
}

try {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
  const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

  const sdk = new NodeSDK({
    serviceName: process.env.OTEL_SERVICE_NAME || 'node-express-boilerplate',
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: Number(process.env.OTEL_METRIC_EXPORT_INTERVAL || 60000),
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });

  sdk.start();

  const shutdown = () => {
    sdk
      .shutdown()
      .catch((err) => diag.error('OpenTelemetry shutdown failed', err))
      .finally(() => undefined);
  };
  process.on('SIGTERM', shutdown);
} catch (err) {
  // An OTel agent/preload may already have registered a global SDK, or the SDK
  // packages may be unavailable — never crash the application for telemetry.
  diag.warn('OpenTelemetry SDK not started; using any already-registered global provider', err);
}
