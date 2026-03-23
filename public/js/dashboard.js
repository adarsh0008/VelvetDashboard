/* ===============================
   1. Load User Data
================================ */
let activeAgentId = null;
let waitingAudio = null;

async function loadWalletData() {

  try {

    const response = await fetch('/api/user');

    if (response.status === 401) {
      window.location.href = '/';
      return;
    }

    const user = await response.json();

    document.getElementById('userName').innerText = user.displayName;
    document.getElementById('userAvatar').src = user.avatar;
    document.getElementById('creditCount').innerText = user.wallet.balance;

  } catch (err) {
    console.error('Wallet load error:', err);
  }

}

async function loadDashboardStats() {

  try {

    const statsRes = await fetch('/api/dashboard/stats');
    const stats = await statsRes.json();

    document.getElementById('activeModels').innerText =
      stats.activeModels ?? 0;

    document.getElementById('totalChats').innerText =
      stats.totalChats ?? 0;

  } catch (err) {
    console.error('Stats load error:', err);
  }

}

document.addEventListener('DOMContentLoaded', async () => {

  checkMicrophoneStatus();
document.getElementById('micStatusCard').style.display = 'flex';
  await loadWalletData();
  await loadDashboardStats();

});

/* ===============================
   MICROPHONE STATUS
================================ */

async function checkMicrophoneStatus() {
  try {
    if (!navigator.permissions) {
      updateMicUI("Permission API not supported", false);
      return;
    }

    const permission = await navigator.permissions.query({ name: 'microphone' });

    if (permission.state === 'granted') {
      updateMicUI("🟢 Microphone access granted", true);
    } else if (permission.state === 'denied') {
      updateMicUI("🔴 Microphone blocked", false);
    } else {
      updateMicUI("🟡 Permission required", false);
    }

    permission.onchange = () => {
      checkMicrophoneStatus();
    };

  } catch (err) {
    console.error("Mic permission check failed:", err);
  }
}

function updateMicUI(message, granted) {
  const text = document.getElementById('micStatusText');
  const btn = document.getElementById('micGrantBtn');

  if (text) text.innerText = message;

  if (granted) {
    btn?.classList.add('hidden');
  } else {
    btn?.classList.remove('hidden');
  }
}

async function requestMicPermission() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // Immediately stop after granting permission
    stream.getTracks().forEach(track => track.stop());

    checkMicrophoneStatus();

  } catch (err) {
    console.error("Microphone permission denied:", err);
    checkMicrophoneStatus();
  }
}



/* ===============================
   2. Load Models
================================ */
async function loadModels() {
    try {
        const res = await fetch('/api/models');
        const models = await res.json();

        const grid = document.getElementById('modelsGrid');
        grid.innerHTML = '';

        document.getElementById('activeModels').innerText = models.length;

        models.forEach(model => {
            const card = document.createElement('div');
            card.className = 'model-card';

            card.innerHTML = `
                <img src="${model.imageUrl}" alt="${model.name}">
                <div class="model-card-content">
                    <div class="model-name">${model.name}</div>
                    <div class="model-rate">
                        ${model.ratePerMinute} credits / Second
                    </div>
                    <button class="model-action-btn" onclick="startCall('agent_${model.elevenLabsAgentId}')">
                        Talk Now
                    </button>
                </div>
            `;

            grid.appendChild(card);
        });

    } catch (err) {
        console.error('Models load error:', err);
    }
}

function showPlanSkeletons(count = 6) {
    const grid = document.getElementById('plansGrid');
    grid.innerHTML = '';

    for (let i = 0; i < count; i++) {
        const skel = document.createElement('div');
        skel.className = 'skeleton-card';
        grid.appendChild(skel);
    }
}

/* ===============================
    2. Toast Notifications
================================ */

function showToast(message, type = "info", duration = 4000) {

  const container = document.getElementById("toastContainer");

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerText = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";

    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

/* ===============================
   3. Section Switcher
================================ */
function showSection(id, el) {

  document.querySelectorAll('.section').forEach(sec => sec.style.display = 'none');
  document.getElementById(id).style.display = 'block';

  document.querySelectorAll('.menu li').forEach(li => li.classList.remove('active'));
  el.classList.add('active');

  const micCard = document.getElementById('micStatusCard');

  // 🔥 Show mic only on dashboard
  if (id === 'wallet') {
    if (micCard) micCard.style.display = 'flex';
    loadWalletData?.();
    loadDashboardStats?.();
  } else {
    if (micCard) micCard.style.display = 'none';
  }

  if (id === 'models') {
    loadModels();
  }

  if (id === 'chat-history') {
    loadCallHistory();
  }

  if (id === 'orders') {
    loadOrders();
  }
}

/* ===============================
   4.Start Call with eleven labs
================================ */
// ======================
// STATE
// ======================
let socket = null;
let callTimerInterval = null;
let secondsElapsed = 0;
let callStartedAt = null; // 🔥 call start timestamp


// ======================
// POPUP
// ======================
function openCallPopup() {
  document.getElementById('callPopup')?.classList.remove('hidden');
}

function closeCallPopup() {
  document.getElementById('callPopup')?.classList.add('hidden');
  stopWaitingAudio();
  stopCallTimer();
}

// ======================
// CALL TIMER
// ======================
function startCallTimer() {
  stopCallTimer(); // 🔒 prevent duplicate intervals

  secondsElapsed = 0;
  updateTimerText();

  callTimerInterval = setInterval(() => {
    secondsElapsed++;
    updateTimerText();
  }, 1000);
}

function stopCallTimer() {
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
  }
}

function updateTimerText() {
  const mins = String(Math.floor(secondsElapsed / 60)).padStart(2, "0");
  const secs = String(secondsElapsed % 60).padStart(2, "0");
  const el = document.getElementById("callTimer");
  if (el) el.innerText = `${mins}:${secs}`;
}

// ======================
// ELEVENLABS SOCKET CONNECT (via backend proxy)
// ======================

// ======================
// ELEVENLABS AUDIO STREAMING
// ======================

let audioContext;
let processor;
let micStream;
let nextStartTime = 0;

async function startStreaming() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(micStream);

    processor = audioContext.createScriptProcessor(4096, 1, 1);
    source.connect(processor);
    processor.connect(audioContext.destination);

    processor.onaudioprocess = (e) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;

      const input = e.inputBuffer.getChannelData(0);
      const pcm16 = new Int16Array(input.length);

      for (let i = 0; i < input.length; i++) {
        pcm16[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
      }

      const base64Audio = btoa(
        String.fromCharCode(...new Uint8Array(pcm16.buffer))
      );

      socket.send(JSON.stringify({ user_audio_chunk: base64Audio }));
    };
  } catch (err) {
    console.error("🎙️ Mic access error:", err);
    alert("Microphone access required to start call.");
  }
}

function stopStreaming() {
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }

  if (processor) {
    processor.disconnect();
    processor = null;
  }

  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
}

// ======================
// PLAY AGENT AUDIO
// ======================
function playAgentAudio(base64Audio) {
  if (!audioContext) return;

  const binary = atob(base64Audio);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const int16Data = new Int16Array(bytes.buffer);
  const float32Data = new Float32Array(int16Data.length);

  for (let i = 0; i < int16Data.length; i++) {
    float32Data[i] = int16Data[i] / 32768;
  }

  const buffer = audioContext.createBuffer(1, float32Data.length, 16000);
  buffer.getChannelData(0).set(float32Data);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);

  if (nextStartTime < audioContext.currentTime) {
    nextStartTime = audioContext.currentTime;
  }

  source.start(nextStartTime);
  nextStartTime += buffer.duration;
}

function connectElevenLabsAgent(agentId) {
  if (!agentId) {
    console.error("❌ Agent ID missing");
    return;
  }

  // auto ws / wss based on protocol
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socketUrl = `${protocol}://${location.host}/ws/elevenlabs?agentId=${agentId}`;

  // close old socket if exists
  if (socket) {
    socket.close();
    socket = null;
  }

  socket = new WebSocket(socketUrl);

  socket.onopen = async () => {
    console.log("🟢 ElevenLabs connected via proxy");
    if (typeof startStreaming === "function") {
      await startStreaming();
    } else {
      console.error("❌ startStreaming() not found");
    }
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "audio" && msg.audio_event?.audio_base_64) {
        if (typeof playAgentAudio === "function") {
          stopWaitingAudio();
          playAgentAudio(msg.audio_event.audio_base_64);
        }
      }
    } catch (err) {
      console.error("WS message parse error:", err);
    }
  };

  socket.onclose = () => {
    console.log("🔴 ElevenLabs connection closed");

    // 🔥 Auto log call if disconnected
    if (callStartedAt) {
      const durationSeconds = getCallDurationSeconds();
      sendCallDurationToServer(durationSeconds);
    }

    stopStreaming?.();
    closeCallPopup();
    resetCallState();
    socket = null;
  };

  socket.onerror = (err) => {
    console.error("❌ WebSocket error:", err);
  };
}
// ======================
// Call Connecting Ring 
// ======================

function playWaitingAudio() {
  if (waitingAudio) return;

  waitingAudio = new Audio('https://storage.googleapis.com/msgsndr/z564sMeUVeNjJZEOUBYt/media/6980704f1f68d199bc02466f.mp3');
  waitingAudio.loop = true;
  waitingAudio.volume = 0.7;

  waitingAudio.play().catch(err => {
    console.warn('Waiting audio autoplay blocked:', err);
  });
}

function stopWaitingAudio() {
  if (waitingAudio) {
    waitingAudio.pause();
    waitingAudio.currentTime = 0;
    waitingAudio = null;
  }
}


// ======================
// START CALL (Button click)
// ======================

function startCall(modelId) {

  const credits = parseInt(
    document.getElementById('creditCount').innerText || 0
  );

  if (credits <= 0) {
    showToast("You have no credits left. Please top up.", "warning");
    openTopUp();
    return;
  }

  if (!modelId) {
    alert("Invalid agent");
    return;
  }

  activeAgentId = modelId;
  callStartedAt = Date.now();

  openCallPopup();
  startCallTimer();
  playWaitingAudio();
  connectElevenLabsAgent(modelId);

  // 🔥 AUTO DISCONNECT TIMER
  const allowedSeconds = credits;

  creditTimeout = setTimeout(async () => {

  console.log("⚠️ Credits finished. Auto disconnect.");

  const durationSeconds = getCallDurationSeconds();

  // 🔥 send deduction to server
  await sendCallDurationToServer(durationSeconds);

  if (socket) {
    socket.close();
    socket = null;
  }

  stopStreaming?.();
  resetCallState();
  closeCallPopup();


}, allowedSeconds * 1000);
}



// ======================
// Calculate Call Duration
// ======================

function getCallDurationSeconds() {
  if (!callStartedAt) return 0;

  const endedAt = Date.now();
  const durationMs = endedAt - callStartedAt;

  return Math.ceil(durationMs / 1000);
}
// ======================
// send Call Duration
// ======================

async function sendCallDurationToServer(durationSeconds) {
  try {
    const res = await fetch('/api/call/end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        durationSeconds,
        agentId: activeAgentId,
        startTime: callStartedAt,
        endTime: Date.now()
      })
    });

    const data = await res.json();

    if (data.success) {

  const creditEl = document.getElementById('creditCount');
  creditEl.innerText = data.remainingCredits;

  // 🚨 If credits finished during call
  if (data.remainingCredits <= 0) {

    showToast("⚠️ Credits finished. Call disconnected.", "warning");

    if (socket) {
      socket.close();
      socket = null;
    }

    stopStreaming?.();
    resetCallState();
    closeCallPopup();
  }
}

    // ✅ reset AFTER successful logging
    callStartedAt = null;
    activeAgentId = null;

  } catch (err) {
    console.error('❌ Failed to update credits:', err);
  }
}
// ======================
// HANGUP
// ======================
document.getElementById("hangupBtn")?.addEventListener("click", async () => {
  const durationSeconds = getCallDurationSeconds();

  console.log("📞 Call duration (seconds):", durationSeconds);

  await sendCallDurationToServer(durationSeconds);

  stopStreaming?.();

  if (socket) {
    socket.close();
    socket = null;
  }
  resetCallState();
  closeCallPopup();
});

/* ===============================
   RESET Call state
================================ */

function resetCallState() {
  if (creditTimeout) {
  clearTimeout(creditTimeout);
  creditTimeout = null;
}
  // 🔌 socket
  if (socket) {
    try { socket.close(); } catch {}
    socket = null;
  }

  // 🎙 mic
  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }

  // 🎛 processor
  if (processor) {
    processor.disconnect();
    processor = null;
  }

  // 🔊 audio context
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }

  // ⏱ timers
  stopCallTimer();
  callStartedAt = null;
  secondsElapsed = 0;

  // 🔁 audio queue (THIS FIXES DELAY)
  nextStartTime = 0;

  // 🔔 waiting tone
  stopWaitingAudio();

  activeAgentId = null;
}


/* ===============================
   TOP UP MODAL
================================ */

async function openTopUp() {
    document.getElementById('topUpModal').style.display = 'flex';
    showPlanSkeletons();
    loadPlans();
}

/* function closeTopUp() {
    document.getElementById('topUpModal').style.display = 'none';
}

/* ===============================
   LOAD CREDIT PLANS
================================ */

/* async function loadPlans() {
    try {
        const res = await fetch('/api/products');
        const plans = await res.json();

        const grid = document.getElementById('plansGrid');
        grid.innerHTML = ''; // remove skeletons

        plans.forEach((plan, index) => {
            const card = document.createElement('div');
            card.className = 'plan-card';

            if (index === Math.floor(plans.length / 2)) {
                card.classList.add('featured');
            }

            card.innerHTML = `
                <div class="plan-title">${plan.name}</div>
                <div class="plan-price">
                    ${plan.price ? `$${plan.price}` : '—'}
                </div>
                <div class="plan-meta">${plan.currency || 'USD'}</div>
                <button class="plan-btn" onclick="startCheckout('${plan.productId}')">
                    Buy Now
                </button>
            `;

            grid.appendChild(card);
        });

    } catch (err) {
        console.error('Failed to load plans:', err);

        const grid = document.getElementById('plansGrid');
        grid.innerHTML = `
            <p style="text-align:center;opacity:.7">
                Failed to load plans. Please try again.
            </p>
        `;
    }
}


/* ===============================
   COUPON STATE MANAGEMENT
================================ */

let activeCoupon = null;
let currentPlans = [];

// Apply coupon button click handler
async function applyCoupon() {
    const couponCode = document.getElementById('couponInput').value.trim();
    
    if (!couponCode) {
        showCouponMessage('Please enter a coupon code', 'error');
        return;
    }
    
    const applyBtn = document.getElementById('applyCouponBtn');
    applyBtn.disabled = true;
    applyBtn.textContent = 'Applying...';
    
    try {
        // Validate coupon with backend
        const response = await fetch('/api/coupons/validate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ couponCode })
        });
        
        const result = await response.json();
        
        if (result.valid) {
            activeCoupon = result.coupon;
            showCouponMessage(`✅ Coupon applied! ${result.discountText} discount`, 'success');
            updateAllPlanPrices(); // Update all plan prices with discount
        } else {
            activeCoupon = null;
            showCouponMessage(result.message || 'Invalid coupon code', 'error');
            resetAllPlanPrices(); // Reset to original prices
        }
        
    } catch (err) {
        console.error('Coupon validation error:', err);
        showCouponMessage('Failed to validate coupon. Please try again.', 'error');
        activeCoupon = null;
        resetAllPlanPrices();
    } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = 'Apply';
    }
}

// Show message in coupon section
function showCouponMessage(message, type) {
    const messageDiv = document.getElementById('couponMessage');
    messageDiv.textContent = message;
    messageDiv.className = `coupon-message ${type}`;
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
        if (messageDiv.textContent === message) {
            messageDiv.textContent = '';
            messageDiv.className = 'coupon-message';
        }
    }, 5000);
}

// Calculate discounted price
function calculateDiscountedPrice(originalPrice, coupon) {
    if (!coupon) return originalPrice;
    
    let discounted = originalPrice;
    
    if (coupon.type === 'percentage') {
        discounted = originalPrice * (1 - coupon.value / 100);
    } else if (coupon.type === 'fixed') {
        discounted = originalPrice - coupon.value;
    }
    
    return Math.max(0, discounted);
}

// Update all plan cards with discounted prices
function updateAllPlanPrices() {
    const planCards = document.querySelectorAll('.plan-card');
    
    planCards.forEach(card => {
        const originalPrice = parseFloat(card.dataset.originalPrice);
        const productId = card.dataset.productId;
        
        if (activeCoupon) {
            const discountedPrice = calculateDiscountedPrice(originalPrice, activeCoupon);
            const priceElement = card.querySelector('.plan-price');
            const priceContainer = card.querySelector('.price-container');
            
            if (discountedPrice !== originalPrice) {
                // Show strikethrough original price
                priceContainer.innerHTML = `
                    <span class="original-price">$${originalPrice.toFixed(2)}</span>
                    <span class="discounted-price">$${discountedPrice.toFixed(2)}</span>
                `;
                priceElement.style.display = 'none';
                
                // Store discounted price for checkout
                card.dataset.discountedPrice = discountedPrice;
            }
        }
    });
}

// Reset all plan prices to original
function resetAllPlanPrices() {
    const planCards = document.querySelectorAll('.plan-card');
    
    planCards.forEach(card => {
        const originalPrice = parseFloat(card.dataset.originalPrice);
        const priceElement = card.querySelector('.plan-price');
        const priceContainer = card.querySelector('.price-container');
        
        // Restore original display
        priceElement.style.display = 'block';
        priceElement.textContent = `$${originalPrice.toFixed(2)}`;
        priceContainer.innerHTML = '';
        priceContainer.appendChild(priceElement);
        
        delete card.dataset.discountedPrice;
    });
}

// Modified loadPlans function with price containers
async function loadPlans() {
    try {
        const res = await fetch('/api/products');
        const plans = await res.json();
        currentPlans = plans;
        
        const grid = document.getElementById('plansGrid');
        grid.innerHTML = '';
        
        plans.forEach((plan, index) => {
            const card = document.createElement('div');
            card.className = 'plan-card';
            card.dataset.productId = plan.productId;
            card.dataset.originalPrice = plan.price;
            
            if (index === Math.floor(plans.length / 2)) {
                card.classList.add('featured');
            }
            
            // Create price container
            const priceContainer = document.createElement('div');
            priceContainer.className = 'price-container';
            
            const priceElement = document.createElement('div');
            priceElement.className = 'plan-price';
            priceElement.textContent = `$${plan.price.toFixed(2)}`;
            priceContainer.appendChild(priceElement);
            
            card.innerHTML = `
                <div class="plan-title">${plan.name}</div>
                ${priceContainer.outerHTML}
                <div class="plan-meta">${plan.currency || 'USD'}</div>
                <button class="plan-btn" onclick="startCheckout('${plan.productId}')">
                    Buy Now
                </button>
            `;
            
            // Re-insert price element reference
            const newCard = grid.appendChild(card);
            const newPriceElement = newCard.querySelector('.plan-price');
            const newPriceContainer = newCard.querySelector('.price-container');
            
            // If there's an active coupon, apply discount to newly loaded plans
            if (activeCoupon) {
                const discountedPrice = calculateDiscountedPrice(plan.price, activeCoupon);
                if (discountedPrice !== plan.price) {
                    newPriceContainer.innerHTML = `
                        <span class="original-price">$${plan.price.toFixed(2)}</span>
                        <span class="discounted-price">$${discountedPrice.toFixed(2)}</span>
                    `;
                    newCard.dataset.discountedPrice = discountedPrice;
                }
            }
        });
        
    } catch (err) {
        console.error('Failed to load plans:', err);
        const grid = document.getElementById('plansGrid');
        grid.innerHTML = `
            <p style="text-align:center;opacity:.7">
                Failed to load plans. Please try again.
            </p>
        `;
    }
}

// Modified startCheckout to use discounted price if available
async function startCheckout(productId) {
    try {
        const planCard = document.querySelector(`.plan-card[data-product-id="${productId}"]`);
        const discountedPrice = planCard?.dataset.discountedPrice;
        const couponCode = document.getElementById('couponInput')?.value?.trim() || '';
        
        // Disable buttons
        document.querySelectorAll('.plan-btn').forEach(btn => {
            btn.disabled = true;
            btn.innerText = 'Redirecting...';
        });
        
        const payload = {
            productId,
            couponCode
        };
        
        // If we have a discounted price from coupon preview, send it to ensure backend uses it
        if (discountedPrice && activeCoupon) {
            payload.expectedPrice = discountedPrice;
        }
        
        const res = await fetch('/api/checkout/create', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        const data = await res.json();
        
        if (!res.ok || !data.checkoutUrl) {
            throw new Error(data.error || 'Checkout failed');
        }
        
        window.location.href = data.checkoutUrl;
        
    } catch (err) {
        alert('Unable to start checkout. Please try again.');
        
        document.querySelectorAll('.plan-btn').forEach(btn => {
            btn.disabled = false;
            btn.innerText = 'Buy Now';
        });
        
        console.error('Checkout error:', err);
    }
}

// Clear coupon when modal closes
function closeTopUp() {
    document.getElementById('topUpModal').style.display = 'none';
    // Reset coupon state when modal closes
    activeCoupon = null;
    document.getElementById('couponInput').value = '';
    document.getElementById('couponMessage').textContent = '';
    resetAllPlanPrices();
}

/* ===============================
   BUY PLAN (Placeholder)
================================ */

 /* async function startCheckout(productId) {
  try {
    // Optional UX: disable all buttons
    document.querySelectorAll('.plan-btn').forEach(btn => {
      btn.disabled = true;
      btn.innerText = 'Redirecting...';
    });

    const res = await fetch('/api/checkout/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productId })
    });

    const data = await res.json();

    if (!res.ok || !data.checkoutUrl) {
      throw new Error(data.error || 'Checkout failed');
    }

    // 🔥 Redirect to Stripe Checkout
    window.location.href = data.checkoutUrl;

  } catch (err) {
    alert('Unable to start checkout. Please try again.');

    document.querySelectorAll('.plan-btn').forEach(btn => {
      btn.disabled = false;
      btn.innerText = 'Buy Now';
    });

    console.error('Checkout error:', err);
  }
}
*/

async function startCheckout(productId) {
  try {

    // 🔥 Get coupon value
    const couponCode =
      document.getElementById('couponInput')?.value?.trim() || '';

    // Optional UX: disable all buttons
    document.querySelectorAll('.plan-btn').forEach(btn => {
      btn.disabled = true;
      btn.innerText = 'Redirecting...';
    });

    const res = await fetch('/api/checkout/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },

      // 🔥 send coupon to backend
      body: JSON.stringify({
        productId,
        couponCode
      })
    });

    const data = await res.json();

    if (!res.ok || !data.checkoutUrl) {
      throw new Error(data.error || 'Checkout failed');
    }

    // 🔥 Redirect to Stripe Checkout
    window.location.href = data.checkoutUrl;

  } catch (err) {

    alert('Unable to start checkout. Please try again.');

    // Re-enable buttons
    document.querySelectorAll('.plan-btn').forEach(btn => {
      btn.disabled = false;
      btn.innerText = 'Buy Now';
    });

    console.error('Checkout error:', err);
  }
}

async function loadCallHistory() {
  try {
    const res = await fetch('/api/calls');
    const calls = await res.json();
   
    const container = document.getElementById('chatHistoryList');
    container.innerHTML = '';

    if (!calls.length) {
      container.innerHTML = `<p style="opacity:.6">No calls yet</p>`;
      return;
    }

    calls.forEach(call => {
      const item = document.createElement('div');
      item.className = 'call-item';

      const start = new Date(call.startTime).toLocaleString();
      const durationText = formatDuration(call.durationSeconds);

      item.innerHTML = `
        <div class="call-dot"></div>
        <div class="call-content">
          <div class="call-header">
            <span class="agent-name">${call.agentName}</span>
            <span class="call-time">${start}</span>
          </div>
          <div class="call-meta">
            <span>⏱ ${durationText}</span>
            <span>💳 ${call.creditsUsed} credits</span>
          </div>
        </div>
      `;

      container.appendChild(item);
    });

  } catch (err) {
    console.error('Failed to load call history:', err);
  }
}

function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds} sec`;
  }

  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;

  if (secs === 0) {
    return `${mins} min`;
  }

  return `${mins} min ${secs} sec`;
}

async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();

    const container = document.getElementById('ordersList');
    container.innerHTML = '';

    if (!orders.length) {
      container.innerHTML = `<p style="opacity:.6">No orders yet</p>`;
      return;
    }

    orders.forEach(order => {
      const date = new Date(order.createdAt).toLocaleString();
      const amount = (order.amount / 100).toFixed(2);

      const item = document.createElement('div');
      item.className = 'order-item';

      item.innerHTML = `
        <div class="order-row">
          <div>
            <strong>${order.productName}</strong>
            <div style="opacity:.6">${date}</div>
          </div>

          <div>
            <span>💳 ${order.creditsAdded} credits</span><br/>
            <span>$${amount} ${order.currency?.toUpperCase()}</span>
          </div>

          <div class="order-status ${order.status}">
            ${order.status.toUpperCase()}
          </div>
        </div>
      `;

      container.appendChild(item);
    });

  } catch (err) {
    console.error('Failed to load orders:', err);
  }
}


