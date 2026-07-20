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

async function callTool(name, sessionId) {
  const { result } = await rpcRequest(
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name, arguments: {} },
    },
    sessionId
  );

  const contentText = result && result.content && result.content[0] && result.content[0].text;
  if (!contentText) {
    throw new Error(`cTrader MCP server returned no data for ${name}`);
  }
  return JSON.parse(contentText);
}

// Reads live account state from the cTrader Desktop app via its local MCP
// server. There is no API key exchange here: the desktop app owns the
// broker session, this just asks it for the current connectionState.
async function getBalance() {
  const sessionId = await initializeSession();
  return callTool('get_balance', sessionId);
}

// SHOT-24: the "Pre-Match job", pulls balance and open positions in one MCP
// session. Both calls must succeed or the whole job is considered failed,
// the caller is responsible for not sending a partial Pre-Match on error.
//
// NOTE: get_positions' exact response shape is assumed, not live-verified,
// the real cTrader MCP server was unreachable while this was written. Based
// on the wrapped-array pattern already confirmed live for get_deals
// ({deals:[...],count:N}) and get_order_history ({trades:[...]}), this
// expects {positions:[...]} with a bare-array fallback. Spot-check this
// once cTrader Desktop is reachable again.
async function getPreMatchData() {
  const sessionId = await initializeSession();
  const balance = await callTool('get_balance', sessionId);
  const positionsResult = await callTool('get_positions', sessionId);
  const positions = Array.isArray(positionsResult)
    ? positionsResult
    : positionsResult.positions || [];
  return { balance, positions };
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
    equity: 9985,
    margin: 120,
    freeMargin: 9865,
    marginLevel: 8320,
    netProfit: -15,
    leverage: 100,
  };
}

// Non-empty by default so the demo link can show AC1's "one or more open
// positions" case. AC2 (zero positions) is covered against the real
// account instead, since it's genuinely flat right now, see pre-match.spec.js.
function getMockPositions() {
  return [
    {
      symbol: 'EURUSD',
      side: 'buy',
      volumeInLots: 0.1,
      entryPrice: 1.085,
      currentPrice: 1.0835,
      pips: -15,
      profit: -15,
    },
  ];
}

function getMockPreMatchData() {
  return { balance: getMockBalance(), positions: getMockPositions() };
}

module.exports = {
  getBalance,
  getPreMatchData,
  getMockBalance,
  getMockPositions,
  getMockPreMatchData,
  MCP_URL,
};
