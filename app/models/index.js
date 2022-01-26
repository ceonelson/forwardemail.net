const Aliases = require('./alias');
const Domains = require('./domain');
const Inquiries = require('./inquiry');
const SPFErrors = require('./spf-errors');
const SelfTests = require('./self-test');
const Users = require('./user');
const Payments = require('./payment');
const Sessions = require('./session');

module.exports = {
  Aliases,
  Domains,
  Inquiries,
  SPFErrors,
  SelfTests,
  Sessions,
  Users,
  Payments
};
