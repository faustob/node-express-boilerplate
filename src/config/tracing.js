/**
 * OpenTelemetry bootstrap — traces plus logs, sharing the same OTLP
 * configuration (OTEL_EXPORTER_OTLP_* env vars / collector endpoint).
 * Logs are bridged from winston via OpenTelemetryTransportV3 in
 * src/config/logger.js, reusing this LoggerProvider so log records carry
 * trace/span correlation from the active context automatically.
 */
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { LoggerProvider, BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { trace } = require('@opentelemetry/api');

const loggerProvider = new LoggerProvider();
loggerProvider.addLogRecordProcessor(new BatchLogRecordProcessor(new OTLPLogExporter()));

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter(),
});
sdk.start();

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

module.exports = { sdk, tracer, withSpan, loggerProvider };
