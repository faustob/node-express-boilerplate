const winston = require('winston');
const { OpenTelemetryTransportV3 } = require('@opentelemetry/winston-transport');
const config = require('./config');
const { loggerProvider } = require('./tracing');

const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.stack });
  }
  return info;
});

const logger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    enumerateErrorFormat(),
    config.env === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
    winston.format.splat(),
    winston.format.printf(({ level, message }) => `${level}: ${message}`)
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
    // Added alongside the console transport: bridges winston log records into
    // the same OTel pipeline used for traces/metrics, carrying trace/span
    // correlation automatically from the active context.
    new OpenTelemetryTransportV3({ loggerProvider }),
  ],
});

module.exports = logger;
