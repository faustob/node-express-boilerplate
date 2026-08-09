const express = require('express');
const helmet = require('helmet');
const xss = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');
const compression = require('compression');
const cors = require('cors');
const passport = require('passport');
const httpStatus = require('http-status');
const config = require('./config/config');
const morgan = require('./config/morgan');
const { jwtStrategy } = require('./config/passport');
const { authLimiter } = require('./middlewares/rateLimiter');
const routes = require('./routes/v1');
const { errorConverter, errorHandler } = require('./middlewares/error');
const ApiError = require('./utils/ApiError');
const { getInstruments } = require('./config/tracing');

const app = express();

// HTTP SLI telemetry: request duration (seconds), request outcome class and in-flight requests.
app.use((req, res, next) => {
  // Resolved on first request, once the global MeterProvider is registered.
  const { httpServerRequestDuration, httpServerRequestCount, httpServerActiveRequests } = getInstruments();
  const startTime = process.hrtime.bigint();
  const baseAttributes = {
    'http.request.method': req.method,
    'url.scheme': req.protocol,
    'network.protocol.version': req.httpVersion,
  };
  httpServerActiveRequests.add(1, baseAttributes);
  res.on('finish', () => {
    const durationSeconds = Number(process.hrtime.bigint() - startTime) / 1e9;
    // Matched route TEMPLATE only — never the raw path (keeps cardinality low).
    const route = (req.route && `${req.baseUrl || ''}${req.route.path}`) || req.baseUrl || undefined;
    const attributes = {
      ...baseAttributes,
      'http.response.status_code': res.statusCode,
      ...(route ? { 'http.route': route } : {}),
      ...(res.statusCode >= 400 ? { 'error.type': String(res.statusCode) } : {}),
    };
    httpServerActiveRequests.add(-1, baseAttributes);
    httpServerRequestDuration.record(durationSeconds, attributes);
    httpServerRequestCount.add(1, {
      ...attributes,
      outcome: res.statusCode < 500 ? 'success' : 'failure',
    });
  });
  next();
});

if (config.env !== 'test') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}

// set security HTTP headers
app.use(helmet());

// parse json request body
app.use(express.json());

// parse urlencoded request body
app.use(express.urlencoded({ extended: true }));

// sanitize request data
app.use(xss());
app.use(mongoSanitize());

// gzip compression
app.use(compression());

// enable cors
app.use(cors());
app.options('*', cors());

// jwt authentication
app.use(passport.initialize());
passport.use('jwt', jwtStrategy);

// limit repeated failed requests to auth endpoints
if (config.env === 'production') {
  app.use('/v1/auth', authLimiter);
}

// v1 api routes
app.use('/v1', routes);

// send back a 404 error for any unknown api request
app.use((req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
});

// convert error to ApiError, if needed
app.use(errorConverter);

// handle error
app.use(errorHandler);

module.exports = app;
