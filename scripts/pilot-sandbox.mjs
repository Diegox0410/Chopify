import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createCommerceHandler } from '../api/commerce.ts';
import { createTenantCommerceState, MemoryCommerceStateStore, PersistentCommerceRuntime } from '../src/application/commerceRuntime.ts';
import { testPilotProduct } from './pilot-fixture.mjs';

const bindHost = '127.0.0.1';
const portNumber = Number(process.env.FLOES_PILOT_SANDBOX_PORT ?? 4179);
const tenantId = 'tenant-floes';
const assistantId = 'commerce-assistant';
const localCommerceToken = 'pilot-sandbox-commerce-only';
const localOwnerToken = 'pilot-sandbox-owner-only';
const localBypass = 'pilot-sandbox-bypass-only';
process.env.CHOPIFY_BASE_URL = 'https://chopify-sandbox.local';
process.env.CHOPIFY_VERCEL_PROTECTION_BYPASS_SECRET = localBypass;
process.env.CHOPIFY_COMMERCE_API_TOKEN = localCommerceToken;
process.env.CHOPIFY_OWNER_API_TOKEN_FLOES = localOwnerToken;
const chopifyRoot = process.cwd();
const ganoRoot = resolve(process.env.GANO_BOT_ROOT ?? join(chopifyRoot, '..', 'GANO_BOT'));
const floesRoot = resolve(process.env.FLOES_COMMERCE_ROOT ?? join(chopifyRoot, '..', '..', 'floes-commerce'));
const requiredFiles = [
  join(ganoRoot, 'apps/functions/dist/commerce/chopifyHttpAdapter.js'),
  join(ganoRoot, 'apps/functions/dist/commerce/catalogTools.js'),
  join(ganoRoot, 'scripts/floes-catalog-conversation.mjs'),
  join(floesRoot, 'public/catalogo/floes/daniela/vino.jpeg'),
];
const missingFiles = requiredFiles.filter(path => !existsSync(path));
if (missingFiles.length) {
  throw new Error(`Sandbox files missing. Build GanoBot functions and verify FLOES asset path: ${missingFiles.map(path => path.replace(ganoRoot, '<GANO_BOT>').replace(floesRoot, '<floes-commerce>')).join(', ')}`);
}

const importGano = path => import(pathToFileURL(join(ganoRoot, path)).href);
const [adapterModule, catalogToolsModule, commerceToolsModule, conversation] = await Promise.all([
  importGano('apps/functions/dist/commerce/chopifyHttpAdapter.js'),
  importGano('apps/functions/dist/commerce/catalogTools.js'),
  importGano('apps/functions/dist/commerce/tools.js'),
  importGano('scripts/floes-catalog-conversation.mjs'),
]);
const { ChopifyHttpAdapter } = adapterModule;
const { createCatalogTools, CATALOG_TOOL_IDS } = catalogToolsModule;
const { createCommerceTools, COMMERCE_TOOL_IDS } = commerceToolsModule;

const sandboxEnv = {
  VERCEL_ENV: 'preview',
  CHOPIFY_COMMERCE_ALLOWED_TENANTS: tenantId,
  CHOPIFY_OPERATIONS_ALLOWED_TENANTS: tenantId,
  CHOPIFY_COMMERCE_API_TOKEN: localCommerceToken,
  CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN: localCommerceToken,
  CHOPIFY_OWNER_API_TOKEN_FLOES: localOwnerToken,
  CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES: localOwnerToken,
  CHOPIFY_COMMERCE_STATE_COLLECTION: 'memory-only-local-sandbox',
};

let runtime;
let commerceHandler;
let memoryStore;
const sessions = new Map();
const orderSessions = new Map();
const originalFetch = globalThis.fetch;

function captureResponse() {
  return {
    statusCode: 200,
    headers: new Map(),
    body: '',
    setHeader(name, value) { this.headers.set(name.toLowerCase(), value); },
    end(body = '') { this.body = body; },
  };
}

async function invokeCommerce(url, init = {}) {
  const headers = Object.fromEntries(new Headers(init.headers));
  const response = captureResponse();
  await commerceHandler({ method: init.method ?? 'GET', headers, body: init.body }, response);
  return new Response(response.body, { status: response.statusCode, headers: Object.fromEntries(response.headers) });
}

const sandboxFetch = async (input, init = {}) => {
  const url = String(input);
  if (!url.startsWith('https://chopify-sandbox.local/api/commerce')) {
    throw new Error('Sandbox outbound network blocked. Only the in-memory Chopify handler is available.');
  }
  return invokeCommerce(url, init);
};
globalThis.fetch = sandboxFetch;

const adapter = new ChopifyHttpAdapter({
  baseUrl: 'https://chopify-sandbox.local',
  bearerToken: localCommerceToken,
  protectionBypassSecret: localBypass,
  fetchImpl: sandboxFetch,
  logger: { error() {} },
});
const catalogTools = createCatalogTools(adapter, tenantId, assistantId);
const commerceTools = createCommerceTools(adapter, tenantId, assistantId);
const tools = [...catalogTools, ...commerceTools];
const floesOwnerModule = await import(pathToFileURL(join(floesRoot, 'api/owner.ts')).href);
const floesOwnerHandler = floesOwnerModule.createOwnerHandler({ authorize: async () => 'local-sandbox-owner' });

function seedSandbox() {
  memoryStore = new MemoryCommerceStateStore();
  const state = createTenantCommerceState(tenantId);
  state.orders.products = [testPilotProduct()];
  state.orders.inventory = [{ tenantId, productId: 'pilot-daniela-test-only', variantId: 'pilot-daniela-vino-test-only', size: 'M', onHand: 2, reserved: 0 }];
  runtime = new PersistentCommerceRuntime(memoryStore);
  commerceHandler = createCommerceHandler({ runtime, env: sandboxEnv });
  return memoryStore.save(tenantId, state, null);
}
await seedSandbox();

const ownerHeaders = {
  authorization: `Bearer ${localOwnerToken}`,
  'x-chopify-tenant-id': tenantId,
  'x-chopify-access-scope': 'owner',
  'content-type': 'application/json',
};
async function invokeFloesOwner(operation, input = {}, mutate = false) {
  const response = captureResponse();
  const requestBody = { operation, input, ...(mutate ? { idempotencyKey: `pilot-sandbox:${operation}:${randomUUID()}` } : {}) };
  await floesOwnerHandler({ method: 'POST', headers: {}, body: JSON.stringify(requestBody) }, response);
  const payload = JSON.parse(response.body || '{}');
  if (response.statusCode < 200 || response.statusCode >= 300 || payload.ok !== true) throw new Error(payload.error ?? `FLOES Owner ${operation} failed.`);
  return payload.data;
}

const json = (response, status, body) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
};
async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 64_000) throw new Error('Request too large.');
  }
  return body ? JSON.parse(body) : {};
}

const sessionIdFrom = request => {
  const url = new URL(request.url, `http://${bindHost}:${portNumber}`);
  return url.searchParams.get('session') ?? '';
};
function selectionHistory(session) {
  return [...session.turns.map(turn => ({
    role: 'assistant',
    content: turn.reply,
    metadata: { commerceSelection: JSON.stringify(turn.selection ?? {}) },
  })), { role: 'assistant', content: 'Estado comercial actual del sandbox.', metadata: { commerceSelection: JSON.stringify(session.selection ?? {}) } }];
}
async function executeTool(name, args, session) {
  const tool = tools.find(item => item.descriptor.id === name);
  if (!tool) throw new Error(`GanoBot tool unavailable: ${name}`);
  return tool.handler.execute(args, {
    tenantId,
    assistantId,
    actorId: 'pilot-customer-test-only',
    conversationId: session.id,
    requestId: `pilot-${randomUUID()}`,
    correlationId: `pilot-correlation-${session.id}`,
    metadata: {},
  });
}
async function handleChat(body) {
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 1000) : '';
  if (!message) throw new Error('Escribe un mensaje para GanoBot.');
  const sessionId = typeof body.sessionId === 'string' && sessions.has(body.sessionId) ? body.sessionId : randomUUID();
  const session = sessions.get(sessionId) ?? { id: sessionId, turns: [], inbound: [], selection: {} };
  const customerName = typeof body.customerName === 'string' ? body.customerName.trim().slice(0, 120) : '';
  const customerPhone = typeof body.customerPhone === 'string' ? body.customerPhone.replace(/[^+\d]/g, '').slice(0, 24) : '';
  const fakeProof = body.fakeProof === true;
  const messageMetadata = {
    ...(customerName ? { customerName } : {}),
    ...(customerPhone ? { customerPhone } : {}),
    ...(fakeProof ? { paymentProofReference: `meta-whatsapp://123456789012345/media/sandbox-proof-${randomUUID().replaceAll('-', '')}` } : {}),
  };
  const turn = conversation.catalogConversationCall(message, selectionHistory(session), messageMetadata);
  let result;
  if (turn.name === CATALOG_TOOL_IDS.consultCatalog || turn.name === CATALOG_TOOL_IDS.prepareCustomerOrder) {
    result = await executeTool(turn.name, turn.arguments, session);
  } else if (turn.name === COMMERCE_TOOL_IDS.attachPaymentProof || turn.name === COMMERCE_TOOL_IDS.getOrderStatus || turn.name === 'commerce.recordOrderFollowUp' || turn.name === 'commerce.requestHumanEscalation') {
    result = await executeTool(turn.name, turn.arguments, session);
  } else {
    throw new Error(`GanoBot requested unsupported sandbox tool: ${turn.name}`);
  }
  const response = conversation.catalogConversationResponse(result, message, session.selection);
  session.selection = response.selection ?? session.selection;
  if (session.selection.orderId) orderSessions.set(session.selection.orderId, sessionId);
  session.inbound.push(message);
  session.turns.push({ message, reply: response.reply, selection: session.selection, image: response.image ?? null, tool: turn.name });
  sessions.set(sessionId, session);
  return {
    sessionId,
    message,
    reply: response.reply,
    image: response.image ? { ...response.image, url: '/__pilot/image/daniela-vino.jpeg' } : null,
    selection: session.selection,
    tool: turn.name,
    sandbox: true,
  };
}

const adminOperations = new Set(['listPaymentReviews', 'listOrders', 'listCustomers', 'searchProducts']);
async function handleAdminAction(body) {
  const operation = String(body.operation ?? '');
  if (!adminOperations.has(operation)) throw new Error('Operación Owner de solo lectura no permitida en este endpoint.');
  return invokeFloesOwner(operation, operation === 'searchProducts' ? { query: '', limit: 200 } : {});
}
async function handleAdminMutation(body) {
  const operation = String(body.operation ?? '');
  const input = body.input && typeof body.input === 'object' ? body.input : {};
  const allowed = new Set(['approvePayment', 'rejectPaymentProof', 'startPreparation', 'markReady', 'dispatchOrder', 'markDelivered']);
  if (!allowed.has(operation)) throw new Error('Acción administrativa no permitida en el sandbox.');
  return invokeFloesOwner(operation, input, true);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${bindHost}:${portNumber}`);
    if (request.method === 'GET' && url.pathname === '/api/pilot-sandbox' && url.searchParams.get('action') === 'health') {
      return json(response, 200, { ok: true, sandbox: true, firebaseProjectId: 'memory-only-local', tenantId, externalChannels: 'disabled', paymentProcessor: 'disabled' });
    }
    if (request.method === 'POST' && url.pathname === '/api/pilot-sandbox' && url.searchParams.get('action') === 'seed') {
      return json(response, 200, { ok: true, sandbox: true, seeded: true, fixtureId: 'pilot-daniela-test-only', inventory: { size: 'M', onHand: 2 } });
    }
    if (request.method === 'POST' && url.pathname === '/api/pilot-sandbox' && url.searchParams.get('action') === 'new-session') {
      return json(response, 200, { ok: true, sandbox: true, sessionId: randomUUID(), firestoreRecordsPreserved: true });
    }
    if (url.pathname === '/api/pilot-sandbox' && url.searchParams.get('action') === 'chat' && request.method === 'POST') {
      const result = await handleChat(await readJson(request));
      return json(response, 200, { ...result, messages: [{ type: 'text', text: result.reply }, ...(result.image ? [{ type: 'image', ...result.image }] : [])] });
    }
    if (url.pathname === '/api/pilot-sandbox' && url.searchParams.get('action') === 'admin' && request.method === 'GET') {
      const [paymentReviews, orders, customers, products] = await Promise.all([
        invokeFloesOwner('listPaymentReviews'), invokeFloesOwner('listOrders'), invokeFloesOwner('listCustomers'), invokeFloesOwner('searchProducts', { query: '', limit: 200 }),
      ]);
      return json(response, 200, { ok: true, sandbox: true, tenantId, paymentReviews, orders, customers, products });
    }
    if (url.pathname === '/api/pilot-sandbox' && url.searchParams.get('action') === 'admin-action' && request.method === 'POST') {
      const body = await readJson(request);
      return json(response, 200, { ok: true, sandbox: true, data: await handleAdminMutation(body) });
    }
    if (url.pathname === '/api/pilot-sandbox' && url.searchParams.get('action') === 'order' && request.method === 'GET') {
      const orderId = url.searchParams.get('orderId') ?? '';
      return json(response, 200, { ok: true, sandbox: true, data: await invokeFloesOwner('getOrderDetail', { orderId }) });
    }
    if (request.method === 'GET' && url.pathname === '/__pilot/health') {
      return json(response, 200, { ok: true, sandbox: true, tenantId, storage: 'memory-only', externalRequests: 'blocked', productFixture: 'Daniela / Vino; commercial values are simulated' });
    }
    if (request.method === 'GET' && url.pathname === '/__pilot/image/daniela-vino.jpeg') {
      const imagePath = join(floesRoot, 'public/catalogo/floes/daniela/vino.jpeg');
      response.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-pilot-sandbox': 'local-image-only' });
      response.end(await readFile(imagePath));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/__pilot/reset') {
      sessions.clear();
      orderSessions.clear();
      await seedSandbox();
      return json(response, 200, { ok: true, sandbox: true, message: 'Sesión y registros de memoria reiniciados.' });
    }
    if (request.method === 'POST' && url.pathname === '/__pilot/chat') {
      const body = await readJson(request);
      return json(response, 200, await handleChat(body));
    }
    if (request.method === 'GET' && url.pathname === '/__pilot/admin') {
      const [paymentReviews, orders, customers, products] = await Promise.all([
        invokeFloesOwner('listPaymentReviews'), invokeFloesOwner('listOrders'), invokeFloesOwner('listCustomers'), invokeFloesOwner('searchProducts', { query: '', limit: 200 }),
      ]);
      return json(response, 200, { sandbox: true, tenantId, paymentReviews, orders, customers, products });
    }
    if (request.method === 'GET' && url.pathname === '/__pilot/order') {
      const orderId = url.searchParams.get('orderId') ?? '';
      if (!orderId) return json(response, 400, { ok: false, error: 'orderId is required.' });
      return json(response, 200, { sandbox: true, data: await invokeFloesOwner('getOrderDetail', { orderId }) });
    }
    if (request.method === 'POST' && url.pathname === '/__pilot/admin/action') {
      const body = await readJson(request);
      const data = await handleAdminMutation(body);
      const orderId = typeof body.input?.orderId === 'string' ? body.input.orderId : '';
      const sessionId = orderSessions.get(orderId);
      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId);
        const status = await adapter.getOrderStatus({ tenantId, assistantId, actorId: 'pilot-admin-test-only', conversationId: session.id,
          requestId: `pilot-admin-${randomUUID()}`, correlationId: `pilot-admin-${session.id}`, idempotencyKey: `pilot-status:${randomUUID()}` }, { orderId });
        if (status?.status) session.selection = { ...session.selection, customerId: status.customerId ?? session.selection.customerId, orderStatus: status.status };
      }
      return json(response, 200, { sandbox: true, data });
    }
    return json(response, 404, { ok: false, error: 'Sandbox route not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sandbox request failed.';
    return json(response, 400, { ok: false, error: message });
  }
});

server.listen(portNumber, bindHost, () => {
  console.log(`FLOES local commercial sandbox listening at http://${bindHost}:${portNumber}`);
  console.log('Storage: process memory only. Firebase, WhatsApp, Meta and external network requests are blocked.');
});
server.on('close', () => { globalThis.fetch = originalFetch; });
