const httpStatus = require('http-status');
const { metrics, trace } = require('@opentelemetry/api');
const catchAsync = require('../utils/catchAsync');
const { authService, userService, tokenService, emailService } = require('../services');

const meter = metrics.getMeter('node-express-boilerplate');
const tracer = trace.getTracer('node-express-boilerplate');

const authAttempts = meter.createCounter('auth.attempts', {
  description: 'Authentication/authorization attempts by outcome and reason',
});

const flowOutcomes = meter.createCounter('flow.outcomes', {
  description: 'Terminal outcomes of the registration flow',
});

const flowEntries = meter.createCounter('flow.entries', {
  description: 'Entries into the registration flow',
});

const flowDuration = meter.createHistogram('flow.duration', {
  description: 'End-to-end duration of the registration flow',
  unit: 's',
});

const register = catchAsync(async (req, res) => {
  flowEntries.add(1, { flow: 'registration' });
  const flowStart = process.hrtime.bigint();
  const flowSpan = tracer.startSpan('flow.registration');
  try {
    const user = await userService.createUser(req.body);
    const tokens = await tokenService.generateAuthTokens(user);
    res.status(httpStatus.CREATED).send({ user, tokens });
    flowOutcomes.add(1, { flow: 'registration', outcome: 'success' });
    flowSpan.setAttribute('flow.outcome', 'success');
  } finally {
    const durationSeconds = Number(process.hrtime.bigint() - flowStart) / 1e9;
    flowDuration.record(durationSeconds, { flow: 'registration' });
    flowSpan.end();
  }
});

const login = catchAsync(async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await authService.loginUserWithEmailAndPassword(email, password);
    const tokens = await tokenService.generateAuthTokens(user);
    authAttempts.add(1, { outcome: 'success' });
    res.send({ user, tokens });
  } catch (err) {
    authAttempts.add(1, { outcome: 'denied', reason: 'invalid_credentials' });
    throw err;
  }
});

const logout = catchAsync(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  res.status(httpStatus.NO_CONTENT).send();
});

const refreshTokens = catchAsync(async (req, res) => {
  const tokens = await authService.refreshAuth(req.body.refreshToken);
  res.send({ ...tokens });
});

const forgotPassword = catchAsync(async (req, res) => {
  const resetPasswordToken = await tokenService.generateResetPasswordToken(req.body.email);
  await emailService.sendResetPasswordEmail(req.body.email, resetPasswordToken);
  res.status(httpStatus.NO_CONTENT).send();
});

const resetPassword = catchAsync(async (req, res) => {
  await authService.resetPassword(req.query.token, req.body.password);
  res.status(httpStatus.NO_CONTENT).send();
});

const sendVerificationEmail = catchAsync(async (req, res) => {
  const verifyEmailToken = await tokenService.generateVerifyEmailToken(req.user);
  await emailService.sendVerificationEmail(req.user.email, verifyEmailToken);
  res.status(httpStatus.NO_CONTENT).send();
});

const verifyEmail = catchAsync(async (req, res) => {
  await authService.verifyEmail(req.query.token);
  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  register,
  login,
  logout,
  refreshTokens,
  forgotPassword,
  resetPassword,
  sendVerificationEmail,
  verifyEmail,
};
