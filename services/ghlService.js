const axios = require('axios');
const Product = require('../models/Product');

const GHL_HEADERS = {
  Authorization: `Bearer ${process.env.GHL_API_KEY}`,
  'Content-Type': 'application/json',
  'Version': '2021-07-28'
};

const GHL_BASE = process.env.GHL_BASE_URL;

/* ===============================
   CONTACTS
================================ */

// 🔍 Find contact by email
async function findContactByEmail(email) {
  try {
    const res = await axios.get(
      `${GHL_BASE}/contacts/search?email=${email}`,
      { headers: GHL_HEADERS }
    );
    return res.data?.contacts?.[0] || null;
  } catch (err) {
    console.error('GHL findContactByEmail error:', err.response?.data || err.message);
    return null;
  }
}

// ➕ Create new contact
async function createContact(user) {
  try {
    const payload = {
      locationId: process.env.GHL_LOCATION_ID,
      email: user.email,
      name: user.displayName,
      profilePhoto: user.avatar,
      tags: ['google-login', 'velvet-junction']
    };

    const res = await axios.post(
      `${GHL_BASE}/contacts/`,
      payload,
      { headers: GHL_HEADERS }
    );

    return res.data?.contact || null;
  } catch (err) {
    console.error('GHL createContact error:', err.response?.data || err.message);
    return null;
  }
}

/* ===============================
   PRODUCTS / CREDIT PACKAGES
================================ */

// 📦 Fetch all credit packages
async function fetchProducts() {
  try {
    const res = await axios.get(
      `${GHL_BASE}/products/`,
      {
        headers: GHL_HEADERS,
        params: { locationId: process.env.GHL_LOCATION_ID }
      }
    );

    return res.data?.products || [];

  } catch (err) {
    console.error('GHL fetchProducts error:', err.response?.data || err.message);
    return [];
  }
}

// 💰 Fetch product price
async function fetchProductPrice(productId) {
  try {
    const res = await axios.get(
      `${GHL_BASE}/products/${productId}/price`,
      {
        headers: GHL_HEADERS,
        params: { locationId: process.env.GHL_LOCATION_ID }
      }
    );

    const price = res.data?.prices?.[0];

    return price
      ? {
          amount: price.amount,
          currency: price.currency,
          priceId: price._id
        }
      : null;

  } catch (err) {
    console.error(
      `GHL fetchProductPrice error (${productId}):`,
      err.response?.data || err.message
    );
    return null;
  }
}

/* ===============================
   SMART SYNC (updatedAt based)
================================ */

async function syncProductsFromGHL() {
  console.log('🔍 Syncing products from GHL (updatedAt based)');

  const ghlProducts = await fetchProducts();
  const operations = [];

  for (const p of ghlProducts) {
    const existing = await Product.findOne({ productId: p._id });

    const ghlUpdated = new Date(p.updatedAt);
    const localUpdated = existing?.ghlUpdatedAt
      ? new Date(existing.ghlUpdatedAt)
      : null;

    // 🆕 New product OR 🔄 Updated product
    if (!existing || ghlUpdated > localUpdated) {
      console.log(
        existing ? `♻️ Updating: ${p.name}` : `🆕 New product: ${p.name}`
      );

      const price = await fetchProductPrice(p._id);
      
      // 🔥 EXTRACT CREDITS FROM VARIANTS (RELIABLE SOURCE)
      let credits = 0;
      
      // Check if product has variants with the name "Credits"
      if (p.variants && Array.isArray(p.variants) && p.variants.length > 0) {
        // Find the variant named "Credits"
        const creditsVariant = p.variants.find(v => 
          v.name && v.name.toLowerCase() === 'credits'
        );
        
        if (creditsVariant && 
            creditsVariant.options && 
            Array.isArray(creditsVariant.options) && 
            creditsVariant.options.length > 0) {
          
          // Get the first option value (e.g., "300", "450", etc.)
          const optionValue = creditsVariant.options[0].name;
          
          // Extract numeric value
          const numericMatch = optionValue.match(/(\d+)/);
          if (numericMatch) {
            credits = parseInt(numericMatch[1]);
            console.log(`💰 Extracted ${credits} credits from variant for: ${p.name}`);
          } else {
            console.warn(`⚠️ Could not extract numeric credits from variant option: "${optionValue}" for product: ${p.name}`);
            
            // Fallback: Try to parse from product name as last resort
            const nameMatch = p.name.match(/(\d+)\s*credits?/i);
            if (nameMatch) {
              credits = parseInt(nameMatch[1]);
              console.log(`🔄 Using fallback: ${credits} credits from product name`);
            }
          }
        } else {
          console.warn(`⚠️ No "Credits" variant found for product: ${p.name}`);
          
          // Fallback: Try to parse from product name
          const nameMatch = p.name.match(/(\d+)\s*credits?/i);
          if (nameMatch) {
            credits = parseInt(nameMatch[1]);
            console.log(`🔄 Using fallback: ${credits} credits from product name`);
          }
        }
      } else {
        console.warn(`⚠️ No variants found for product: ${p.name}`);
        
        // Fallback: Try to parse from product name
        const nameMatch = p.name.match(/(\d+)\s*credits?/i);
        if (nameMatch) {
          credits = parseInt(nameMatch[1]);
          console.log(`🔄 Using fallback: ${credits} credits from product name`);
        }
      }

      // If still 0, use a safe default
      if (credits === 0) {
        credits = 50; // Safe default
        console.log(`⚠️ Using default ${credits} credits for: ${p.name}`);
      }

      operations.push(
        Product.findOneAndUpdate(
          { productId: p._id },
          {
            productId: p._id,
            name: p.name,
            image: p.image,
            productType: p.productType,

            price: price?.amount || null,
            currency: price?.currency || 'USD',
            priceId: price?.priceId || null,
            
            credits: credits, // ← SAVE THE CREDITS

            ghlUpdatedAt: ghlUpdated,
            lastSyncedAt: new Date(),
            locationId: process.env.GHL_LOCATION_ID
          },
          { upsert: true, new: true }
        )
      );
    }
  }

  if (operations.length) {
    await Promise.all(operations);
  } else {
    console.log('✅ No product changes detected');
  }

  return Product.find().sort({ price: 1 });
}


/* ===============================
   Create invoice in GHL (DRAFT)
  ================================ */
async function createInvoice({ contact, product, amount, invoiceNumber }) {
  try {
    const payload = {
      altId: process.env.GHL_LOCATION_ID,
      altType: 'location',
      name: `Invoice for ${product.name}`,
      currency: 'USD',

      businessDetails: {
        name: 'Velvet Junction'
      },

      items: [
        {
          name: product.name,
          productId: product.productId,
          priceId: product.price?.priceId || 'manual',
          qty: 1,
          amount,
          currency: 'USD',
          type: 'one_time'
        }
      ],

      contactDetails: {
        id: contact.contactId,
        name: contact.name,
        email: contact.email
      },

      invoiceNumber,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date().toISOString().slice(0, 10),
      liveMode: true,
      automaticTaxesEnabled: false
    };

    const res = await axios.post(
      `${GHL_BASE}/invoices/`,
      payload,
      { headers: GHL_HEADERS }
    );

    console.log('🧾 GHL invoice created:', res.data._id);

    // ✅ IMPORTANT FIX HERE
    return res.data || null;

  } catch (err) {
    console.error(
      '❌ GHL createInvoice error:',
      err.response?.data || err.message
    );
    return null;
  }
}


/* ===============================
   record  invoice payment in GHL
  ================================ */
  // 💰 Record payment for invoice
async function recordInvoicePayment(invoiceId, amount) {
  try {
    const payload = {
      altId: process.env.GHL_LOCATION_ID,
      altType: 'location',
      mode: 'other',
      notes: 'Payment from dashboard (Stripe)',
      amount,
      fulfilledAt: new Date().toISOString()
    };

    const res = await axios.post(
      `${GHL_BASE}/invoices/${invoiceId}/record-payment`,
      payload,
      { headers: GHL_HEADERS }
    );

    return res.data || null;

  } catch (err) {
    console.error(
      '❌ GHL recordPayment error:',
      err.response?.data || err.message
    );
    return null;
  }
}


/* ===============================
   EXPORTS
================================ */

module.exports = {
  findContactByEmail,
  createContact,
  fetchProducts,
  fetchProductPrice,
  syncProductsFromGHL,
  createInvoice,
  recordInvoicePayment
};
