// services/stripeService.js
const Stripe = require('stripe');
const User = require('../models/User');
const Product = require('../models/Product');
const Purchase = require('../models/Purchase');
const {
  createInvoice,
  recordInvoicePayment
} = require('./ghlService');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * Create Stripe Checkout Session
 */
async function createCheckoutSession({ userId, product, purchaseId }) {
  const credits = product.credits || 50;

  return stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],

    line_items: [
      {
        price_data: {
          currency: (product.currency || 'usd').toLowerCase(),
          unit_amount: Math.round(product.price * 100),
          product_data: {
            name: product.name,
            description: `Purchase ${credits} credits`
          }
        },
        quantity: 1
      }
    ],

    success_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard.html?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:3000'}/dashboard.html?payment=cancel`,

    metadata: {
      purchaseId: purchaseId.toString(),
      userId: userId.toString(),
      productId: product.productId || product._id.toString(),
      productName: product.name,
      credits: credits.toString(),
      price: (product.price || 0).toString()
    }
  });
}

/**
 * Handle Stripe checkout.session.completed webhook
 * Idempotent & race-condition safe
 */
async function handleCheckoutCompleted(session) {
  try {
    console.log('🔄 Processing Stripe webhook:', session.id);

    const { purchaseId, userId, productId, credits } = session.metadata || {};

    if (!purchaseId || !userId || !credits) {
      console.error('❌ Missing metadata:', session.id);
      return; // ⚠️ DO NOT throw (Stripe retries forever)
    }

    /* ===============================
       1. ATOMIC PURCHASE UPDATE
    ================================ */

    const purchase = await Purchase.findOneAndUpdate(
      {
        _id: purchaseId,
        status: { $ne: 'paid' }
      },
      {
        $set: {
          status: 'paid',
          stripeSessionId: session.id,
          paymentIntentId: session.payment_intent
        }
      },
      { new: true }
    );

    // Duplicate webhook → already processed
    if (!purchase) {
      console.log('⚠️ Purchase already processed:', purchaseId);
      return;
    }

    /* ===============================
       2. FETCH USER
    ================================ */

    const user = await User.findById(userId);
    if (!user) {
      console.error(`❌ User not found: ${userId}`);
      return;
    }

    // Wallet safety
    if (!user.wallet) user.wallet = { balance: 0 };
    if (user.wallet.balance == null) user.wallet.balance = 0;

    const creditsToAdd = Number(credits);
    const previousBalance = user.wallet.balance;

    user.wallet.balance += creditsToAdd;

    // Arrays safety
    if (!Array.isArray(user.creditHistory)) user.creditHistory = [];
    if (!Array.isArray(user.transactions)) user.transactions = [];

    user.creditHistory.push({
      amount: creditsToAdd,
      description: `Credit purchase via Stripe (${session.id.slice(0, 10)}...)`,
      date: new Date(),
      type: 'purchase',
      status: 'completed'
    });

    user.transactions.push({
      type: 'credit_purchase',
      amount: creditsToAdd,
      stripeSessionId: session.id,
      productId,
      date: new Date(),
      status: 'completed'
    });

    await user.save();

    console.log(`✅ ${creditsToAdd} credits added to user ${userId}`);
    console.log(`💰 ${previousBalance} → ${user.wallet.balance}`);

    /* ===============================
       3. PRODUCT STATS (NON-CRITICAL)
    ================================ */

    let product = null;

    if (productId) {
      try {
        product = await Product.findOneAndUpdate(
          { productId },
          { $inc: { purchaseCount: 1 } },
          { new: true }
        );
      } catch (err) {
        console.error('⚠️ Product count update failed:', err.message);
      }
    }

    /* ===============================
       4. 🧾 CREATE GHL INVOICE (DRAFT)
    ================================ */

    if (product && user.ghl?.contactId) {
      const invoice = await createInvoice({
        contact: {
          contactId: user.ghl.contactId,
          name: user.displayName,
          email: user.email
        },
        product,
        amount: product.price?.amount || session.amount_total / 100,
        invoiceNumber: `INV-${Date.now()}`
      });

      /* ===============================
         5. 💰 RECORD PAYMENT
      ================================ */

const invoiceId = invoice?._id;

console.log('🧾 GHL Invoice ID:', invoiceId);

if (invoiceId) {
  const amountToRecord =
    product?.price?.amount ??
    (session.amount_total ? session.amount_total / 100 : 0);

  await recordInvoicePayment(invoiceId, amountToRecord);

  console.log('💰 GHL payment recorded for invoice:', invoiceId);
}
 else {
  console.warn('⚠️ Invoice created but ID missing, payment skipped');
}
    }

  } catch (error) {
    console.error('❌ Stripe webhook error:', error);
    // ❗ DO NOT throw — prevents Stripe retry storms
  }
}


module.exports = {
  createCheckoutSession,
  handleCheckoutCompleted
};
