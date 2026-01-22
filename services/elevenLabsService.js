const WebSocket = require('ws');

/**
 * Creates secure ElevenLabs WebSocket bridge
 */
function createElevenLabsBridge(clientSocket, agentId) {
  if (!agentId) {
    clientSocket.close(1008, 'Agent ID missing');
    return;
  }

  const elevenWs = new WebSocket(
    `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`,
    {
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      }
    }
  );

  // Browser → ElevenLabs
  clientSocket.on('message', msg => {
    if (elevenWs.readyState === WebSocket.OPEN) {
      elevenWs.send(msg);
    }
  });

  // ElevenLabs → Browser
  elevenWs.on('message', msg => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(msg);
    }
  });

  elevenWs.on('close', () => clientSocket.close());
  clientSocket.on('close', () => elevenWs.close());

  elevenWs.on('error', err => {
    console.error('❌ ElevenLabs WS error:', err);
    clientSocket.close();
  });
}

module.exports = { createElevenLabsBridge };
