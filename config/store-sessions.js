const { SessionSchema } = require('#models/session');
const logger = require('#helpers/logger');

module.exports = {
  logger,
  schema: SessionSchema,
  fields: {
    ip: 'ip',
    sessions: 'sessions',
    sid: 'sid',
    lastActivity: 'last_activity'
  }
};
