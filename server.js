require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const path = require('path');
const Product = require('./models/Product');
const User = require('./models/User');
const Model = require('./models/Agent');
const { 
  findContactByEmail, 
  createContact, 
  syncProductsFromGHL
} = require('./services/ghlService');
const {
  createCheckoutSession,
  handleCheckoutCompleted
} = require('./services/stripeService');


const app = express();
const expressWs = require('express-ws')(app);
const { createElevenLabsBridge } = require('./services/elevenLabsService');

/* ===============================
   IMPORTANT: Body Parser Setup
================================ */

// First, handle JSON parsing for most routes
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    // Store raw body for Stripe webhook
    if (req.originalUrl === '/webhooks/stripe') {
      req.rawBody = buf.toString(encoding || 'utf8');
    }
  }
}));

app.use(express.urlencoded({ extended: true }));

/* ===============================
   1. MongoDB Connection
================================ */

const uri = process.env.MONGO_URI;

async function connectDB() {
  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB Connected');
  } catch (err) {
    console.error('❌ MongoDB Connection Error:', err);
    process.exit(1);
  }
}

connectDB();

/* ===============================
   2. Passport Google Strategy
================================ */

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;

        let user = await User.findOne({ googleId: profile.id });

        if (!user) {
          user = await User.create({
            googleId: profile.id,
            displayName: profile.displayName,
            email,
            avatar: profile.photos?.[0]?.value,
            lastLogin: new Date(),
            wallet: { credits: 0 },
            creditHistory: []
          });
        } else {
          user.lastLogin = new Date();
        }

        if (!user.ghl?.contactId && email) {
          const ghlContact = await findContactByEmail(email);

          if (ghlContact) {
            user.ghl = {
              contactId: ghlContact.id,
              locationId: process.env.GHL_LOCATION_ID
            };
          } else {
            const newContact = await createContact(user);
            if (newContact) {
              user.ghl = {
                contactId: newContact.id,
                locationId: process.env.GHL_LOCATION_ID
              };
            }
          }
        }

        await user.save();
        return done(null, user);

      } catch (err) {
        console.error('❌ Google Auth Error:', err);
        return done(err, null);
      }
    }
  )
);

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

/* ===============================
   3. Middleware
================================ */

app.use(express.static('public'));

const sessionStore = MongoStore.create({
  mongoUrl: uri,
  collectionName: 'sessions',
  ttl: 14 * 24 * 60 * 60
});

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 14,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax'
    }
  })
);

app.use(passport.initialize());
app.use(passport.session());

/* ===============================
   4. AUTH ROUTES
================================ */

app.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

app.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/' }),
  (req, res) => res.redirect('/dashboard.html')
);

/* ===============================
   5. LOGOUT
================================ */

app.get('/logout', (req, res, next) => {
  req.logout(err => {
    if (err) return next(err);

    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.redirect('/');
    });
  });
});

/* ===============================
   6. API ROUTES
================================ */

app.get('/api/user', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // NEW CODE - Fixed to match your schema
  const wallet = req.user.wallet || { balance: 0 };
  
  res.json({
    id: req.user._id,
    displayName: req.user.displayName,
    email: req.user.email,
    avatar: req.user.avatar,
    wallet: {
      balance: wallet.balance || 0  // Use balance instead of credits
    },
    ghl: req.user.ghl
  });
});

const ensureAuth = (req, res, next) => {
  if (req.isAuthenticated()) return next();
  res.redirect('/');
};

app.get('/dashboard.html', ensureAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/api/models', ensureAuth, async (req, res) => {
  try {
    const models = await Model.find({ status: 'active' }).sort({ createdAt: -1 });
    res.json(models);
  } catch (err) {
    console.error('❌ Fetch models error:', err);
    res.status(500).json({ error: 'Failed to load models' });
  }
});

app.get('/api/products', ensureAuth, async (req, res) => {
  try {
    const products = await syncProductsFromGHL();
    res.json(products);
  } catch (err) {
    console.error('❌ Failed to load products:', err);
    res.status(500).json({ error: 'Failed to load products' });
  }
});

app.post('/api/checkout/create', ensureAuth, async (req, res) => {
  try {
    const { productId } = req.body;

    if (!productId) {
      return res.status(400).json({ error: 'Product ID is required' });
    }

    const product = await Product.findOne({ productId });
    if (!product || !product.price) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const session = await createCheckoutSession({
      userId: req.user._id.toString(),
      product
    });

    res.json({ checkoutUrl: session.url });

  } catch (err) {
    console.error('❌ Checkout error:', err);
    res.status(500).json({ error: 'Checkout failed' });
  }
});

/* ===============================
   7. GHL MODEL WEBHOOK
================================ */

app.post('/webhooks/ghl/model', async (req, res) => {
  try {
    console.log('📥 GHL MODEL WEBHOOK RECEIVED');

    const payload = req.body;

    if (!payload?.id || !payload?.name) {
      console.warn('⚠️ Invalid webhook payload');
      return res.status(400).json({ error: 'Invalid payload' });
    }

    const recordId = payload.id;

    await Model.findOneAndUpdate(
      { recordId },
      {
        recordId,
        name: payload.name,
        imageUrl: payload.imageUrl,
        ratePerMinute: Number(payload.ratePerMinute) || 1,
        status: payload.status || 'active'
      },
      { upsert: true, new: true }
    );

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('❌ GHL MODEL WEBHOOK ERROR:', err);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

/* ===============================
   🔥🔥🔥 FIXED: STRIPE WEBHOOK HANDLER
================================ */

app.post('/webhooks/stripe', async (req, res) => {
  console.log('📥 Stripe webhook received');
  
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers['stripe-signature'];

  if (!sig) {
    console.error('❌ No Stripe signature found');
    return res.status(400).send('No Stripe signature');
  }

  // Check if we have the raw body
  if (!req.rawBody) {
    console.error('❌ No raw body available for verification');
    // Try to get body from regular parsed body
    if (req.body) {
      console.log('⚠️ Using parsed body instead of raw body');
      req.rawBody = JSON.stringify(req.body);
    } else {
      return res.status(400).send('No request body');
    }
  }

  let event;
  
  try {
    console.log('🔐 Verifying Stripe signature...');
    
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    
    console.log(`✅ Stripe signature verified! Event type: ${event.type}`);
    
  } catch (err) {
    console.error('❌ Stripe webhook verification failed:', err.message);
    
    // For debugging: print what we received
    console.log('=== DEBUG INFO ===');
    console.log('Signature header:', sig ? `${sig.substring(0, 50)}...` : 'Missing');
    console.log('Raw body length:', req.rawBody?.length || 0);
    console.log('Raw body preview:', req.rawBody?.substring(0, 200) || 'None');
    console.log('Webhook secret configured:', process.env.STRIPE_WEBHOOK_SECRET ? 'Yes' : 'No');
    console.log('==================');
    
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      console.log('💰 Processing successful checkout...');
      
      const session = event.data.object;
      console.log('Session ID:', session.id);
      console.log('Metadata:', session.metadata);
      
      try {
        await handleCheckoutCompleted(session);
        console.log('✅ Credits added successfully!');
      } catch (err) {
        console.error('❌ Failed to process checkout:', err);
        // Don't return error to Stripe - we'll acknowledge receipt
      }
      break;
      
    case 'payment_intent.succeeded':
      console.log('💳 Payment succeeded:', event.data.object.id);
      break;
      
    case 'charge.succeeded':
      console.log('💸 Charge succeeded:', event.data.object.id);
      break;
      
    default:
      console.log(`ℹ️  Unhandled event type: ${event.type}`);
  }

  // Always return 200 to acknowledge receipt
  res.json({ received: true });
});

/* ===============================
   8. DEBUG & TESTING ENDPOINTS
================================ */

// Test if Stripe webhook endpoint is reachable
app.get('/webhooks/stripe/test', (req, res) => {
  res.json({ 
    status: 'ok', 
    message: 'Stripe webhook endpoint is reachable',
    timestamp: new Date().toISOString()
  });
});

// Manual test endpoint (for development only)
if (process.env.NODE_ENV !== 'production') {
  app.post('/debug/test-checkout', ensureAuth, async (req, res) => {
    try {
      const { credits = 100 } = req.body;
      
      // Simulate a Stripe session object
      const testSession = {
        id: 'test_session_' + Date.now(),
        metadata: {
          userId: req.user._id.toString(),
          productId: 'test_product',
          credits: credits.toString(),
          productName: 'Test Product'
        },
        amount_total: 1000, // $10.00
        currency: 'usd',
        customer_details: {
          email: req.user.email,
          name: req.user.displayName
        },
        payment_intent: 'test_pi_' + Date.now(),
        payment_status: 'paid'
      };
      
      console.log('🧪 Running test checkout simulation...');
      await handleCheckoutCompleted(testSession);
      
      // Get updated user
      const user = await User.findById(req.user._id);
      
      res.json({ 
        success: true, 
        message: `Test completed. Added ${credits} credits.`,
        newCredits: user.wallet?.credits || 0
      });
      
    } catch (err) {
      console.error('Test error:', err);
      res.status(500).json({ error: err.message });
    }
  });
}

// Get current user credits
app.get('/api/user/credits', ensureAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    res.json({ 
      credits: user.wallet?.credits || 0,
      creditHistory: user.creditHistory || []
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch credits' });
  }
});

/* ===============================
    Eleven Labs Code
================================ */
app.ws('/ws/elevenlabs', (ws, req) => {
  const agentId = req.query.agentId;
  console.log('📞 Call request for agent:', agentId);
  createElevenLabsBridge(ws, agentId);
});


/* ===============================
   9. HOME ROUTE
================================ */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ===============================
   10. ERROR HANDLER
================================ */

app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

/* ===============================
   11. SERVER START
================================ */

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server running on http://localhost:${PORT}`);
  console.log(`\n📋 Important setup instructions:`);
  console.log(`1. Start Stripe CLI in a new terminal:`);
  console.log(`   stripe listen --forward-to http://localhost:${PORT}/webhooks/stripe`);
  console.log(`\n2. Get your webhook signing secret from Stripe CLI output`);
  console.log(`   It will look like: whsec_xxxxxxxxxxxxx`);
  console.log(`\n3. Add it to your .env file:`);
  console.log(`   STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxx`);
  console.log(`\n4. Test webhook:`);
  console.log(`   stripe trigger checkout.session.completed`);
  console.log(`\n5. Test endpoint directly:`);
  console.log(`   http://localhost:${PORT}/webhooks/stripe/test`);
});