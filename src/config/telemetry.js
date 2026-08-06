const { metrics } = require('@opentelemetry/api');

// Instruments are resolved lazily and memoised on first use so they bind to the SDK
// registered globally by src/otel.js.
let instruments;

const getInstruments = () => {
  if (!instruments) {
    const meter = metrics.getMeter('node-express-boilerplate');
    instruments = {
      meter,
      // Availability SLI: request counter, dimensioned by route template + outcome class.
      requestCount: meter.createCounter('http.server.request', {
        description: 'Inbound HTTP requests by route template and outcome class',
      }),
      // Latency SLI: semconv server request duration histogram, recorded in seconds.
      requestDuration: meter.createHistogram('http.server.request.duration', {
        description: 'Duration of inbound HTTP requests',
        unit: 's',
      }),
      // Concurrency SLI: value goes up and down, recorded via an UpDownCounter.
      requestsInFlight: meter.createUpDownCounter('http.server.active_requests', {
        description: 'Number of in-flight inbound HTTP requests',
      }),
      // Business outcome counter for auth operations (register/login).
      authOperationCount: meter.createCounter('auth.operations', {
        description: 'Authentication operations by type and outcome',
      }),
    };
  }
  return instruments;
};

module.exports = {
  getInstruments,
};
