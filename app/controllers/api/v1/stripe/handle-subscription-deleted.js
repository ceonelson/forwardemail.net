const Stripe = require('stripe');
// const isSANB = require('is-string-and-not-blank');
const _ = require('lodash');
// const ms = require('ms');
const dayjs = require('dayjs-with-plugins');
// const delay = require('delay');

const env = require('#config/env');
const logger = require('#helpers/logger');
const Payments = require('#models/payment');

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

// const { STRIPE_MAPPING, STRIPE_PRODUCTS } = config.payments;

// <https://stripe.com/docs/webhooks/signatures>

// stripe events for subscriptions
// https://stripe.com/docs/billing/subscriptions/cancel

async function handleSubscriptionDeleted(event) {
  try {
    const subscription = event.data.object;

    console.log('subscription', subscription);

    let invoice;
    if (subscription?.latest_invoice)
      invoice = await stripe.invoices.retrieve(subscription.latest_invoice);

    console.log('invoice', invoice);

    let paymentIntent;
    if (invoice.payment_intent)
      paymentIntent = await stripe.paymentIntents.retrieve(
        invoice.payment_intent
      );

    console.log('paymentIntent', paymentIntent);

    const amount = _.toSafeInteger(
      paymentIntent.amount *
        ((subscription.current_period_end - subscription.canceled_at) /
          (subscription.current_period_end - subscription.current_period_start))
    );

    console.log('amount to refund', amount);

    // refund the payment via stripe

    // TODO: if its first payment made in first 30 days give full refund for both 1-time and subscriptions
    //       otherwise refund full amount in first 24hours of creation - otherwise pro-rate

    await stripe.refunds.create({
      payment_intent: paymentIntent.id,
      // if they cancel very quickly, just give them a full refund
      // TODO: change this to
      ...(amount > paymentIntent.amount - 5 ? {} : { amount })
    });

    // refund the payment in our system

    const payment = await Payments.findOne({
      stripe_payment_intent_id: paymentIntent.id
    });

    payment.amount_refunded = amount;
    payment.refunded_at = dayjs.utc(subscription.cancelled_at).toDate();

    await payment.save();

    // reflect the refund amount for the latest subscription
  } catch (err) {
    logger.error(err);
  }
}

module.exports = handleSubscriptionDeleted;
