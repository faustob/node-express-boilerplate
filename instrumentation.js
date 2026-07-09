const { registerOTel } = require('@vercel/otel');

let registered = false;

try {
  registerOTel({ serviceName: process.env.OTEL_SERVICE_NAME || 'node-express-boilerplate' });
  registered = true;
} catch (err) {
  // Tolerate an already-registered global provider (e.g. an attached OTel agent)
  // so the app still starts correctly.
  // eslint-disable-next-line no-console
  console.warn('OpenTelemetry SDK registration skipped:', err.message);
}

module.exports = { registered };
