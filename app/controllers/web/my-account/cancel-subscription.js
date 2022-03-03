const Boom = require('@hapi/boom');
const Stripe = require('stripe');
const isSANB = require('is-string-and-not-blank');

const env = require('#config/env');
const config = require('#config');

const { paypalAgent } = require('#helpers/paypal');

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

async function cancelSubscription(ctx, next) {
  if (
    !isSANB(ctx.state.user[config.userFields.stripeSubscriptionID]) &&
    !isSANB(ctx.state.user[config.userFields.paypalSubscriptionID])
  )
    throw Boom.badRequest(ctx.translateError('SUBSCRIPTION_ALREADY_CANCELLED'));

  await Promise.all([
    isSANB(ctx.state.user[config.userFields.stripeSubscriptionID])
      ? stripe.subscriptions.del(
          ctx.state.user[config.userFields.stripeSubscriptionID]
        )
      : Promise.resolve(),
    isSANB(ctx.state.user[config.userFields.paypalSubscriptionID])
      ? paypalAgent.post(
          `/v1/billing/subscriptions/${
            ctx.state.user[config.userFields.paypalSubscriptionID]
          }/cancel`
        )
      : Promise.resolve()
  ]);

  ctx.state.user[config.userFields.stripeSubscriptionID] = null;
  ctx.state.user[config.userFields.paypalSubscriptionID] = null;

  ctx.state.user.plan = 'free';

  await ctx.state.user.save();

  ctx.flash('success', ctx.translate('SUBSCRIPTION_CANCELLED'));

  return next();
}

module.exports = cancelSubscription;
