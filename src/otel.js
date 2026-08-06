/* eslint-disable no-console */
/*
 * OpenTelemetry SDK bootstrap for this Express service.
 * Registered as the GLOBAL SDK at process startup — required by src/index.js
 * as its FIRST line, before any instrumented module is loaded.
 *
 * Endpoint is env-driven: OTEL_EXPORTER_OTLP_ENDPOINT (never hardcoded).
 */
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

const serviceName = process.env.OTEL_SERVICE_NAME || 'node-express-boilerplate';

let sdk;
try {
  sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });
  sdk.start();
} catch (err) {
  // An OTel agent/preload may already have registered a global SDK.
  // Tolerate that: keep the existing provider and continue starting the app.
  console.warn(`OpenTelemetry SDK not started by app bootstrap: ${err && err.message}`);
}

process.on('SIGTERM', () => {
  if (sdk && typeof sdk.shutdown === 'function') {
    Promise.resolve(sdk.shutdown()).catch(() => {});
  }
});

module.exports = sdk;
