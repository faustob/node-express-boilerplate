'use strict';

// OpenTelemetry bootstrap for a plain Node/Express app.
// This module MUST be required as the first line of the process entrypoint
// (see src/index.js) so that instrumentation patches modules before they
// are required elsewhere.

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

const serviceName = process.env.OTEL_SERVICE_NAME || 'node-express-boilerplate';
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

// When OTEL_EXPORTER_OTLP_ENDPOINT is set, honor it explicitly for both
// signals. When unset, omit the url option entirely so the exporters fall
// back to the SDK's standard OTLP env-var resolution (OTEL_EXPORTER_OTLP_*)
// instead of silently defaulting to localhost.
const traceExporter = otlpEndpoint
  ? new OTLPTraceExporter({ url: `${otlpEndpoint}/v1/traces` })
  : new OTLPTraceExporter();

const metricExporter = otlpEndpoint
  ? new OTLPMetricExporter({ url: `${otlpEndpoint}/v1/metrics` })
  : new OTLPMetricExporter();

const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
  }),
  traceExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

try {
  sdk.start();
} catch (err) {
  // Defensive: if an OTel agent or another SDK instance already registered
  // global providers, tolerate it instead of crashing the process.
  // eslint-disable-next-line no-console
  console.error('OpenTelemetry SDK failed to start (continuing without crashing):', err);
}

process.on('SIGTERM', () => {
  sdk.shutdown().catch(() => {});
});

module.exports = sdk;
