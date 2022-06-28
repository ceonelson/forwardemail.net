const validator = require('validator');
const mongoose = require('mongoose');
const mongooseCommonPlugin = require('mongoose-common-plugin');

const Session = new mongoose.Schema({
  ip: {
    type: String,
    trim: true,
    validate: (val) => validator.isIP(val)
  },
  sid: {
    type: String,
    trim: true,
    index: true
  },
  last_activity: Date
});

Session.plugin(mongooseCommonPlugin, {
  object: 'session',
  omitCommonFields: false,
  omitExtraFields: ['_id', '__v'],
  uniqueId: false
});

module.exports.SessionSchema = Session;
