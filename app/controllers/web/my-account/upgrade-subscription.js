const Boom = require('@hapi/boom');
const Stripe = require('stripe');
const isSANB = require('is-string-and-not-blank');
const ms = require('ms');

const env = require('#config/env');
const config = require('#config');

const { paypalAgent } = require('#helpers/paypal');

const { STRIPE_MAPPING, STRIPE_PRODUCTS_BY_PLAN } = config.payments;

const stripe = new Stripe(env.STRIPE_SECRET_KEY);

async function upgradeSubscription(ctx) {
  if (!ctx.state.user[config.userFields.stripeSubscriptionID])
    throw Boom.badRequest(
      'You must have an active stripe subscription in order to upgrade.'
    );

  if (ctx.state.user.plan !== 'enhanced_protection')
    throw Boom.badRequest(
      'You must have an enhanced protection plan in order to upgrade.'
    );

  const subscription = await stripe.subscriptions.retrieve(
    ctx.state.user[config.userFields.stripeSubscriptionID]
  );
  console.log('subscription', JSON.stringify(subscription, null, 2));

  // get their current duration from the price point
  // and use that duration to get the equivalent team subscription price
  const [duration] = Object.entries(
    STRIPE_MAPPING.enhanced_protection.subscription
  ).find(([, priceId]) => priceId === subscription.plan.id);

  const items = [
    {
      id: subscription.items.data[0].id,
      price: STRIPE_MAPPING.team.subscription[duration]
    }
  ];

  const proration_date = Math.floor(Date.now() / 1000);
  const invoice = await stripe.invoices.retrieveUpcoming({
    customer: ctx.state.user[config.userFields.stripeCustomerID],
    subscription: subscription.id,
    subscription_items: items,
    subscription_proration_date: proration_date
  });

  console.log('invoice', invoice);

  const sub = await stripe.subscriptions.update(subscription.id, {
    items,
    proration_date
  });

  console.log('sub', sub);

  ctx.body = { ok: 'ok', invoice };
}

module.exports = upgradeSubscription;
