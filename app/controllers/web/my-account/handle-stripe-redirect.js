const Stripe = require('stripe');
const _ = require('lodash');
const isSANB = require('is-string-and-not-blank');
const ms = require('ms');

const env = require('#config/env');
const config = require('#config');
const logger = require('#helpers/logger');
const { Payments } = require('#models');
const { paypalAgent } = require('#helpers/paypal');
const emailHelper = require('#helpers/email');

const { STRIPE_MAPPING, STRIPE_PRODUCTS } = config.payments;

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// eslint-disable-next-line complexity
async function handleStripeRedirect(ctx) {
  // if the querystring contained a Stripe checkout session ID then verify it and upgrade user
  const session = await stripe.checkout.sessions.retrieve(ctx.query.session_id);

  console.log('session', session);

  // validate session exists
  if (!session) throw ctx.translateError('UNKNOWN_ERROR');

  ctx.logger.info('stripe.checkout.sessions.retrieve', { session });

  // if payment status was not paid then throw an error
  if (session.payment_status !== 'paid')
    throw ctx.translateError('UNKNOWN_ERROR');

  let subscription;
  let invoice;

  if (!session.payment_intent && session.subscription)
    subscription = await stripe.subscriptions.retrieve(session.subscription);

  console.log('subscription', subscription);

  // this call always creates a new subscription -
  // so we must cancel the precious subscription and refund the user for it
  if (
    _.isObject(subscription) &&
    ctx.state.user[config.userFields.stripeSubscriptionID] !== subscription.id
  ) {
    try {
      if (isSANB(ctx.state.user[config.userFields.stripeSubscriptionID]))
        await stripe.subscriptions.del(
          ctx.state.user[config.userFields.stripeSubscriptionID]
        );
      // save the new subscription ID to their account (so they can 1-click cancel subscriptions)
      ctx.state.user[config.userFields.stripeSubscriptionID] = subscription.id;
    } catch (err) {
      ctx.logger.fatal(err);
      // email admins here
      try {
        await emailHelper({
          template: 'alert',
          message: {
            to: config.email.message.from,
            subject: `Error deleting Stripe subscription ID ${
              ctx.state.user[config.userFields.stripeSubscriptionID]
            } for ${ctx.state.user.email}`
          },
          locals: { message: err.message }
        });
      } catch (err) {
        ctx.logger.fatal(err);
      }
    }
  }

  if (!session.payment_intent && subscription && subscription.latest_invoice)
    invoice = await stripe.invoices.retrieve(subscription.latest_invoice);

  const paymentIntent = await stripe.paymentIntents.retrieve(
    !session.payment_intent && invoice.payment_intent
      ? invoice.payment_intent
      : session.payment_intent
  );

  console.log('paymentIntent', paymentIntent);

  if (!paymentIntent) throw ctx.translateError('UNKNOWN_ERROR');

  const stripeCharge = paymentIntent.charges.data.find(
    (charge) => charge.paid && charge.status === 'succeeded'
  );

  if (!stripeCharge) throw ctx.translateError('UNKNOWN_ERROR');

  let productId;
  let priceId;
  if (_.isObject(invoice)) {
    // for subscriptions we have all the needed info on the invoice
    logger.debug(`invoice ${invoice.id}`);
    productId = invoice.lines.data[0].price.product;
    priceId = invoice.lines.data[0].price.id;
  } else {
    // for one-time payments we must retrieve the lines from the checkout session
    const lines = await stripe.checkout.sessions.listLineItems(session.id);
    productId = lines.data[0].price.product;
    priceId = lines.data[0].price.id;
  }

  // this logic is the same in rerieve-domain-billing
  const plan = STRIPE_PRODUCTS[productId];
  const kind = isSANB(session.payment_intent) ? 'one-time' : 'subscription';
  const duration = ms(
    _.keys(STRIPE_MAPPING[plan][kind]).find(
      (key) => STRIPE_MAPPING[plan][kind][key] === priceId
    )
  );

  let payment = await Payments.findOne({
    user: ctx.state.user._id,
    stripe_payment_intent_id: paymentIntent.id
  });

  if (payment) console.log('Stripe payment was already created in WEBHOOK');

  if (!payment) {
    logger.debug('creating new payment');
    payment = {
      user: ctx.state.user._id,
      plan,
      kind,
      duration,
      amount: paymentIntent.amount,
      method: stripeCharge.payment_method_details.card.brand,
      exp_month: stripeCharge.payment_method_details.card.exp_month,
      exp_year: stripeCharge.payment_method_details.card.exp_year,
      last4: stripeCharge.payment_method_details.card.last4,
      stripe_sessions_id: session?.id,
      stripe_payment_intent_id: paymentIntent?.id,
      stripe_invoice_id: invoice?.id,
      stripe_subscription_id: invoice?.subscription
    };

    await Payments.create(payment);

    logger.debug(
      `Successfully created new payment for stripe payment_intent ${paymentIntent.id}`
    );
  }

  ctx.state.user.plan = plan;
  ctx.state.user = await ctx.state.user.save();

  // cancel the user's paypal subscription if they had one
  // and if the session.mode was equal to subscription
  if (
    session.mode === 'subscription' &&
    isSANB(ctx.state.user[config.userFields.paypalSubscriptionID])
  ) {
    try {
      await paypalAgent.post(
        `/v1/billing/subscriptions/${
          ctx.state.user[config.userFields.paypalSubscriptionID]
        }/cancel`
      );
      ctx.state.user[config.userFields.paypalSubscriptionID] = null;
      ctx.state.user = await ctx.state.user.save();
    } catch (err) {
      ctx.logger.fatal(err);
      // email admins here
      try {
        await emailHelper({
          template: 'alert',
          message: {
            to: config.email.message.from,
            subject: `Error deleting PayPal subscription ID ${
              ctx.state.user[config.userFields.paypalSubscriptionID]
            } for ${ctx.state.user.email}`
          },
          locals: { message: err.message }
        });
      } catch (err) {
        ctx.logger.fatal(err);
      }
    }
  }
}

module.exports = handleStripeRedirect;
