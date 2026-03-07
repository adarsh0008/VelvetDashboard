/* ===============================
   1. Load User Data
================================ */
let activeAgentId = null;
let waitingAudio = null;
document.addEventListener('DOMContentLoaded', async () => {
  checkMicrophoneStatus();
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
        console.error('User load error:', err);
    }
    // ======================
// Load Dashboard Stats
// ======================
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
                        ${model.ratePerMinute} credits / minute
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
   3. Section Switcher
================================ */
function showSection(id, el) {
    document.querySelectorAll('.section').forEach(sec => sec.style.display = 'none');
    document.getElementById(id).style.display = 'block';

    document.querySelectorAll('.menu li').forEach(li => li.classList.remove('active'));
    el.classList.add('active');

    if (id === 'models') {
        loadModels();
    }
    if (id === 'chat-history') {
      loadCallHistory(); // 🔥 here
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
    alert("⚠️ You have no credits left. Please top up.");
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

  creditTimeout = setTimeout(() => {

    console.log("⚠️ Credits finished. Auto disconnect.");

    if (socket) {
      socket.close();
      socket = null;
    }

    stopStreaming?.();
    resetCallState();
    closeCallPopup();

    alert("Credits finished. Call disconnected.");

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

    alert("⚠️ Credits finished. Call disconnected.");

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

function closeTopUp() {
    document.getElementById('topUpModal').style.display = 'none';
}

/* ===============================
   LOAD CREDIT PLANS
================================ */

async function loadPlans() {
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
   BUY PLAN (Placeholder)
================================ */

async function startCheckout(productId) {
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


