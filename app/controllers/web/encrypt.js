const { Buffer } = require('node:buffer');

const Boom = require('@hapi/boom');
const isSANB = require('is-string-and-not-blank');
const striptags = require('striptags');

const env = require('#config/env');
const { encrypt } = require('#helpers/encrypt-decrypt');

async function encryptTxt(ctx) {
  if (!isSANB(ctx.request.body.input))
    throw Boom.badRequest(ctx.translateError('UNKNOWN_ERROR'));

  // if string is longer than 1000 characters then error (rudimentary safeguard)
  if (ctx.request.body.input.length >= 1000)
    throw Boom.badRequest(ctx.translateError('UNKNOWN_ERROR'));

  const isPort = /forward-email-port/i.test(ctx.request.body.input);

  ctx.request.body.input = ctx.request.body.input
    .replace(/forward-email=/i, '')
    .replace(/forward-email-port=/i, '');

  if (
    ctx.request.body.input
      .toLowerCase()
      .includes('forward-email-site-verification=')
  )
    throw Boom.badRequest(ctx.translateError('INPUT_HAD_FE_SV'));

  const encryptedValue = await encrypt(
    ctx.request.body.input.trim(),
    12,
    env.TXT_ENCRYPTION_KEY,
    'chacha20-poly1305'
  );

  const b64encryptedValue = Buffer.from(encryptedValue, 'hex').toString(
    'base64'
  );

  const html = ctx.translate(
    'ENCRYPTED_VALUE',
    striptags(ctx.request.body.input.trim()),
    isPort ? 'forward-email-port' : 'forward-email',
    b64encryptedValue
  );

  const swal = {
    title: ctx.request.t('Success'),
    html,
    grow: 'fullscreen',
    backdrop: 'rgba(0,0,0,0.8)',
    customClass: {
      container: 'swal2-grow-fullscreen'
    },
    confirmButtonText: ctx.translate('CLOSE_POPUP'),
    type: 'success',
    allowEscapeKey: false,
    allowOutsideClick: false,
    focusConfirm: false
  };

  if (ctx.api) {
    ctx.body = b64encryptedValue;
    return;
  }

  if (ctx.accepts('html')) {
    ctx.flash('custom', swal);
    ctx.redirect(ctx.state.l('/encrypt'));
    return;
  }

  ctx.body = { swal };
}

module.exports = encryptTxt;