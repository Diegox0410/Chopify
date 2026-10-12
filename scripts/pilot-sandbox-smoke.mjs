import assert from 'node:assert/strict';

const root = process.env.PILOT_SANDBOX_URL ?? 'http://127.0.0.1:5173/__pilot';
const conversation = [];
let sessionId = '';
async function post(path, body) {
  const response = await fetch(`${root}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(payload)}`);
  assert.notEqual(payload.sandbox, false, 'response must be sandbox-only');
  return payload;
}
async function send(message, extra = {}) {
  const result = await post('/chat', { sessionId, message, customerName: 'Cliente Piloto Ficticia', customerPhone: '593000000099', ...extra });
  sessionId = result.sessionId;
  conversation.push({ customer: message, ganoBot: result.reply, tool: result.tool, image: result.image?.url ?? null });
  return result;
}

const healthResponse = await fetch(`${root}/health`);
const health = await healthResponse.json();
assert.equal(healthResponse.status, 200);
assert.equal(health.storage, 'memory-only');
assert.equal(health.externalRequests, 'blocked');
await post('/reset', {});

await send('Hola, ¿qué modelos tienen?');
const model = await send('Quiero ver Daniela');
assert.match(model.reply, /Daniela/i);
const sizeHelp = await send('¿Qué talla me recomiendas?');
assert.match(sizeHelp.reply, /talla/i);
const color = await send('Vino');
assert.equal(color.selection.color, 'Vino');
assert.ok(color.image?.url.includes('/__pilot/image/'));
const size = await send('Talla M');
assert.equal(size.selection.size, 'M');
const priceStock = await send('¿Cuál es el precio y hay stock?');
assert.match(priceStock.reply, /39\.99 USD|34\.99 USD/);
assert.match(priceStock.reply, /Disponibilidad talla M:\s+\d+ unidades/i);
const draft = await send('Lo quiero');
assert.ok(draft.selection.customerId);
assert.ok(draft.selection.orderId);
assert.match(draft.reply, /borrador/i);
const proof = await send('Adjunto comprobante ficticio de transferencia', { fakeProof: true });
assert.match(proof.reply, /pendiente de revisión/i);

const admin = await (await fetch(`${root}/admin`)).json();
const review = admin.paymentReviews.find(item => item.order?.id === draft.selection.orderId);
assert.ok(review, 'FLOES Owner review panel must see the same test order');
assert.equal(review.payment.status, 'PROOF_RECEIVED');
await post('/admin/action', { operation: 'approvePayment', input: { paymentId: review.payment.id, proofId: review.proof.id } });
const paidMessage = await send('¿Cuál es el estado de mi pedido?');
assert.match(paidMessage.reply, /Pago confirmado/i);
await post('/admin/action', { operation: 'startPreparation', input: { orderId: draft.selection.orderId } });
await post('/admin/action', { operation: 'markReady', input: { orderId: draft.selection.orderId } });
const readyMessage = await send('¿Cuál es el estado de mi pedido?');
assert.match(readyMessage.reply, /listo para despacho/i);
await post('/admin/action', { operation: 'dispatchOrder', input: { orderId: draft.selection.orderId, courier: 'Transporte ficticio', trackingCode: 'TEST-TRACKING-001' } });
const dispatchMessage = await send('¿Cuál es el estado de mi pedido?');
assert.match(dispatchMessage.reply, /TEST-TRACKING-001/);
await post('/admin/action', { operation: 'markDelivered', input: { orderId: draft.selection.orderId } });
const deliveredMessage = await send('¿Cuál es el estado de mi pedido?');
assert.match(deliveredMessage.reply, /figura entregado/i);
const followUp = await send('Ya recibí mi pedido y estoy contenta');
assert.match(followUp.reply, /seguimiento/i);
const finalAdmin = await (await fetch(`${root}/admin`)).json();
const finalOrder = finalAdmin.orders.find(order => order.id === draft.selection.orderId);
assert.ok(finalOrder);
assert.equal(finalOrder.paymentStatus, 'PAID');
assert.equal(finalOrder.fulfillmentStatus, 'DELIVERED');
assert.equal(finalAdmin.orders.length, 1, 'one synthetic order must exist after reset');
const finalDetailResponse = await fetch(`${root}/order?orderId=${encodeURIComponent(draft.selection.orderId)}`);
const finalDetail = (await finalDetailResponse.json()).data;
assert.equal(finalDetailResponse.status, 200);
assert.equal(finalDetail.order.id, draft.selection.orderId);
assert.equal(finalDetail.order.followUp.outcome, 'SATISFIED');
assert.equal(finalDetail.order.paymentStatus, 'PAID');
assert.equal(finalDetail.order.fulfillmentStatus, 'DELIVERED');

console.log(JSON.stringify({
  result: 'PASS',
  stages: ['saludo/modelos', 'Daniela y variante Vino', 'orientación prudente de talla', 'consulta de precio y stock sintéticos', 'registro de cliente', 'pedido en borrador', 'comprobante ficticio pendiente', 'FLOES Owner revisa y verifica', 'preparación', 'despacho', 'entrega', 'postventa'],
  customerId: draft.selection.customerId,
  orderId: draft.selection.orderId,
  paymentStatus: finalOrder.paymentStatus,
  operationalStatus: finalOrder.fulfillmentStatus,
  trackingCode: 'TEST-TRACKING-001',
  proofStatus: proof.reply.includes('pendiente de revisión') ? 'PENDING_REVIEW' : 'UNEXPECTED',
  conversation,
  note: 'Solo memoria del servidor local; cliente, catálogo, importe, inventario, comprobante y transporte son datos ficticios.',
}, null, 2));
