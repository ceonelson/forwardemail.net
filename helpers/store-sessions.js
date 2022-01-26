const StoreSessions = require('@ladjs/store-sessions');
const config = require('#config/store-sessions');

const storeSessions = new StoreSessions(config);

module.exports = storeSessions;
