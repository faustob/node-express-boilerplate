require('./config/tracing');
const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config/config');
const logger = require('./config/logger');
const { sdk } = require('./config/tracing');

let server;
mongoose.connect(config.mongoose.url, config.mongoose.options).then(() => {
  logger.info('Connected to MongoDB');
  server = app.listen(config.port, () => {
    logger.info(`Listening to port ${config.port}`);
  });
});

const shutdownTelemetry = () => {
  const timeout = new Promise((resolve) => setTimeout(resolve, 2000));
  return Promise.race([sdk.shutdown().catch(() => {}), timeout]);
};

const exitHandler = () => {
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      shutdownTelemetry().then(() => process.exit(1));
    });
  } else {
    shutdownTelemetry().then(() => process.exit(1));
  }
};

const unexpectedErrorHandler = (error) => {
  logger.error(error);
  exitHandler();
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  if (server) {
    server.close();
  }
  shutdownTelemetry();
});
