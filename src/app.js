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
const { httpRequestOutcomes, httpRequestDurationByTier, httpActiveRequests } = require('./config/tracing');

const app = express();

if (config.env !== 'test') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}

// record HTTP request outcome + latency SLIs (never alters the request/response flow)
app.use((req, res, next) => {
  const startNs = process.hrtime.bigint();
  const baseAttributes = { 'http.request.method': req.method, 'url.scheme': req.protocol };
  httpActiveRequests.add(1, baseAttributes);
  let settled = false;
  const record = () => {
    if (settled) return;
    settled = true;
    const durationSeconds = Number(process.hrtime.bigint() - startNs) / 1e9;
    // Matched route TEMPLATE (e.g. /users/:userId), never the raw path — keeps cardinality low.
    const route = `${req.baseUrl || ''}${(req.route && req.route.path) || ''}` || 'unmatched';
    const statusCode = res.statusCode;
    const attributes = { ...baseAttributes, 'http.route': route, 'http.response.status_code': statusCode };
    httpActiveRequests.add(-1, baseAttributes);
    httpRequestOutcomes.add(1, {
      ...attributes,
      outcome: statusCode < 500 ? 'success' : 'failure',
      ...(statusCode >= 500 ? { 'error.type': String(statusCode) } : {}),
    });
    httpRequestDurationByTier.record(durationSeconds, {
      ...attributes,
      tier: req.headers['x-tenant-tier'] || 'standard',
    });
  };
  res.on('finish', record);
  res.on('close', record);
  next();
});

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
