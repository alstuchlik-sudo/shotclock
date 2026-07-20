const MCP_URL = process.env.CTRADER_MCP_URL || 'http://127.0.0.1:9876/mcp/';

async function rpcRequest(body, sessionId) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;

  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  const returnedSessionId = response.headers.get('mcp-session-id');
  const text = await response.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error('cTrader MCP server returned an unexpected response');
  }
  if (json.error) {
    throw new Error(json.error.message || 'cTrader MCP server returned an error');
  }
  return { result: json.result, sessionId: returnedSessionId || sessionId };
}

async function initializeSession() {
  const { sessionId } = await rpcRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'shotclock-connect', version: '1.0.0' },
    },
  });
  if (!sessionId) {
    throw new Error('cTrader MCP server did not return a session id');
  }
  return sessionId;
}

// Reads live account state from the cTrader Desktop app via its local MCP
// server. There is no API key exchange here: the desktop app owns the
// broker session, this just asks it for the current connectionState.
async function getBalance() {
  const sessionId = await initializeSession();
  const { result } = await rpcRequest(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'get_balance', arguments: {} },
    },
    sessionId
  );

  const contentText = result && result.content && result.content[0] && result.content[0].text;
  if (!contentText) {
    throw new Error('cTrader MCP server returned no account data');
  }

  return JSON.parse(contentText);
}

// Used only when DEMO_MODE=true, for a publicly shared link where no real
// cTrader Desktop instance is reachable. Deliberately labeled "Demo Broker"
// so the data never gets mistaken for a real account, and the calling
// route is responsible for rendering the demo-mode banner alongside it.
function getMockBalance() {
  return {
    connectionState: 'Authenticated',
    brokerName: 'Demo Broker',
    accountType: 'Hedged',
    traderId: 999001,
    depositAsset: 'EUR',
    balance: 10000,
    equity: 10000,
    leverage: 100,
  };
}

module.exports = { getBalance, getMockBalance, MCP_URL };
