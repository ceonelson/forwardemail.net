const Stripe = require('stripe');
const isSANB = require('is-string-and-not-blank');
const _ = require('lodash');
const ms = require('ms');

const env = require('#config/env');
const config = require('#config');
const logger = require('#helpers/logger');
const emailHelper = require('#helpers/email');
const Users = require('#models/user');
const Payments = require('#models/payment');

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

const { STRIPE_MAPPING, STRIPE_PRODUCTS } = config.payments;

// <https://stripe.com/docs/webhooks/signatures>

// stripe events for subscriptions
// https://stripe.com/docs/billing/subscriptions/overview#subscription-lifecycle

async function handlePaymentIntentSucceeded(event) {
  try {
    const paymentIntent = event.data.object;

    const customer = await Users.findOne({
      [config.userFields.stripeCustomerId]: paymentIntent.customer
    });

    // charges will usually just be an array of the successful charge,
    // but I think it may be possible a failed charge could be there as well
    // so we need to find the successful one for any payment details
    const stripeCharge = paymentIntent.charges.data.find(
      (charge) => charge.paid && charge.status === 'succeeded'
    );

    let amount_refunded;
    if (stripeCharge.refunded) ({ amount_refunded } = stripeCharge);

    const hasInvoice = isSANB(paymentIntent.invoice);

    // one time payments have no invoice nor subscription
    const isOneTime = !hasInvoice;

    if (!stripeCharge)
      throw new Error('No successful stripe charge on payment intent.');

    // there should only ever be 1 checkout
    // session per successful payment intent
    const { data: checkoutSessions } = await stripe.checkout.sessions.list({
      payment_intent: paymentIntent.id
    });

    const [checkoutSession] = checkoutSessions;

    // invoices only on subscription payments
    let invoice;
    if (hasInvoice)
      invoice = await stripe.invoices.retrieve(paymentIntent.invoice);

    let productId;
    let priceId;
    if (_.isObject(invoice)) {
      productId = invoice.lines.data[0].price.product;
      priceId = invoice.lines.data[0].price.id;
    } else {
      // for one-time payments we must retrieve the lines from the checkout session
      const lines = await stripe.checkout.sessions.listLineItems(
        checkoutSession?.id
      );
      productId = lines.data[0].price.product;
      priceId = lines.data[0].price.id;
    }

    // this logic is the same in rerieve-domain-billing
    const plan = STRIPE_PRODUCTS[productId];
    const kind = isOneTime ? 'one-time' : 'subscription';
    const duration = ms(
      _.keys(STRIPE_MAPPING[plan][kind]).find(
        (key) => STRIPE_MAPPING[plan][kind][key] === priceId
      )
    );

    if (checkoutSession?.metadata?.plan) {
      console.log('YAYAYAYYAYAYAY');
      console.log(checkoutSession.metadata.plan);
      console.log('YAYAYAYYAYAYA');

      if (checkoutSession.metadata.plan !== plan) {
        // Err maybe
      }

      customer.plan = checkoutSession.metadata.plan;
      await customer.save();
    }

    // checkout session will only exist as a field on the one-time payments
    // if the redirect creates the payment first - this is the unique field
    // we can check to make sure it didn't get created first

    // scenarios:

    // 1. Automated subscription payment

    // 2. One-time payment, which will be simultaneously handled in the redirect
    //      a. it hits the redirect and creates the payment first
    //      b. it hits webhook here and creates the payment first

    // 3. First time subscription payment, which will be simultaneously handled in the redirect
    //      a. it hits the redirect and creates the payment first
    //      b. it hits webhook here and creates the payment first

    const payment = await Payments.findOne({
      user: customer._id,
      stripe_payment_intent_id: paymentIntent.id
    });

    if (payment) {
      console.log('payment was already created in REDIRECT');
    }

    if (!payment) {
      console.log('payment not found, creating new payment');
      await Payments.create({
        user: customer._id,
        plan,
        kind,
        duration,
        amount_refunded,
        amount: paymentIntent.amount,
        method: stripeCharge.payment_method_details.card.brand,
        exp_month: stripeCharge.payment_method_details.card.exp_month,
        exp_year: stripeCharge.payment_method_details.card.exp_year,
        last4: stripeCharge.payment_method_details.card.last4,
        stripe_sessions_id: checkoutSession?.id,
        stripe_payment_intent_id: paymentIntent.id,
        stripe_invoice_id: invoice?.id,
        stripe_subscription_id: invoice?.subscription
      });

      logger.info(
        `Successfully created new payment for stripe payment_intent ${paymentIntent.id}`
      );
    }
  } catch (err) {
    emailHelper({
      template: 'alert',
      message: {
        to: config.email.message.from,
        subject: `Stripe Webhook Error`
      },
      locals: { message: err.message }
    });
  }
}

module.exports = handlePaymentIntentSucceeded;
