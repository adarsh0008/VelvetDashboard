// services/stripeService.js
const Stripe = require('stripe');
const User = require('../models/User');
const Product = require('../models/Product');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function createCheckoutSession({ userId, product }) {
  const credits = product.credits || 50;
  
  return await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],
    
    line_items: [
      {
        price_data: {
          currency: product.currency.toLowerCase() || 'usd',
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
      userId: userId.toString(),
      productId: product.productId || product._id.toString(),
      productName: product.name,
      credits: credits.toString(),
      price: (product.price || 0).toString()
    }
  });
}

async function handleCheckoutCompleted(session) {
  try {
    console.log('🔄 Processing Stripe webhook for session:', session.id);
    
    const { userId, productId, credits } = session.metadata;

    if (!userId || !credits) {
      console.error('❌ Missing metadata in session:', session.id);
      throw new Error('Missing required metadata');
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      console.error(`❌ User not found: ${userId}`);
      throw new Error('User not found');
    }

    console.log('👤 Current user wallet:', user.wallet);

    // Initialize wallet if it doesn't exist
    if (!user.wallet) {
      user.wallet = { balance: 0 };
      console.log('📦 Initialized new wallet');
    }

    // Ensure wallet has balance field
    if (user.wallet.balance === undefined || user.wallet.balance === null) {
      user.wallet.balance = 0;
      console.log('📝 Set default balance to 0');
    }

    // Add credits to balance
    const creditsToAdd = parseInt(credits, 10);
    const currentBalance = user.wallet.balance || 0;
    const newBalance = currentBalance + creditsToAdd;
    
    user.wallet.balance = newBalance;

    // Initialize creditHistory if it doesn't exist
    if (!user.creditHistory) {
      user.creditHistory = [];
      console.log('📦 Initialized creditHistory array');
    }

    // Add to credit history
    user.creditHistory.push({
      amount: creditsToAdd,
      description: `Credit purchase via Stripe - Session: ${session.id.slice(0, 10)}...`,
      date: new Date(),
      type: 'purchase',
      status: 'completed'
    });

    // Also add to transactions if field exists
    if (!user.transactions) {
      user.transactions = [];
    }

    user.transactions.push({
      type: 'credit_purchase',
      amount: creditsToAdd,
      stripeSessionId: session.id,
      productId: productId,
      date: new Date(),
      status: 'completed'
    });

    // Save the user
    await user.save();

    console.log(`✅ ${creditsToAdd} credits added to user ${userId}.`);
    console.log(`💰 Old balance: ${currentBalance}`);
    console.log(`💰 New balance: ${newBalance}`);

    // Update product purchase count
    if (productId) {
      try {
        await Product.findOneAndUpdate(
          { productId: productId },
          { $inc: { purchaseCount: 1 } },
          { new: true }
        );
        console.log(`✅ Purchase count updated for product ${productId}`);
      } catch (productErr) {
        console.error('⚠️ Could not update product purchase count:', productErr.message);
      }
    }

    return user;

  } catch (error) {
    console.error('❌ Error in handleCheckoutCompleted:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
}

module.exports = {
  createCheckoutSession,
  handleCheckoutCompleted
};