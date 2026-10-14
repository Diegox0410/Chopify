import assert from "node:assert/strict";
import { test } from "node:test";

import { createChannelInboundHandler } from "../api/_lib/channelInboundHandler.js";
import { createChannelOutboundHandler } from "../api/_lib/channelOutboundHandler.js";
import { liveMemoryStore } from "./helpers/liveMemoryStore.mjs";
import {
  createChopifyInboundHttpAdapter,
  createChopifyOutboundHttpAdapter,
  createOmnichannelInboundRelay,
  createWebInboundAdapter,
} from "../../ganobot-commerce/scripts/omnichannel-relay.mjs";

const tenantId = "tenant-floes";
const serviceToken = "local-acceptance-token";
const baseUrl = "https://chopify.acceptance.invalid";

async function invokeHandler(handler, request) {
  let body = "";
  const response = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(value) { body = value ?? ""; },
  };
  await handler(request, response);
  return new Response(body, { status: response.statusCode, headers: response.headers });
}

test("GanoBot WEB inbound persists once in the Chopify CRM and outbound outbox", async () => {
  const store = liveMemoryStore();
  let identityResolutions = 0;
  let processCalls = 0;
  const authorize = async request => request.headers?.authorization === `Bearer ${serviceToken}`
    ? { tenantId, uid: "local-acceptance" }
    : null;
  const inboundHandler = createChannelInboundHandler({
    store,
    authorize,
    async resolveIdentity({ externalCustomerId }) {
      identityResolutions += 1;
      return { customerId: `customer_${externalCustomerId}` };
    },
  });
  const outboundHandler = createChannelOutboundHandler({ store, authorize });
  const requests = [];
  const fetchImplementation = async (input, init = {}) => {
    const url = new URL(input);
    requests.push(url.pathname);
    const handler = url.pathname === "/api/channel-inbound"
      ? inboundHandler
      : url.pathname === "/api/channel-outbound" ? outboundHandler : null;
    if (!handler) return new Response(JSON.stringify({ error: "NOT_FOUND" }), { status: 404 });
    return invokeHandler(handler, { method: init.method, headers: init.headers, body: init.body });
  };
  const tenantConfigurations = { [tenantId]: { baseUrl, bearerToken: serviceToken } };
  const inbound = createChopifyInboundHttpAdapter({
    allowedTenantIds: [tenantId], tenantConfigurations, fetchImplementation,
  });
  const outbound = createChopifyOutboundHttpAdapter({
    allowedTenantIds: [tenantId], tenantConfigurations, fetchImplementation,
  });
  const relay = createOmnichannelInboundRelay({
    adapters: [createWebInboundAdapter({ tenantId })],
    allowedTenantIds: [tenantId],
    persistInbound: envelope => inbound.persist(envelope),
    async processMessage(envelope) {
      processCalls += 1;
      assert.equal(envelope.customerId, "customer_web-customer-1");
      return {
        reply: "La disponibilidad por talla debe confirmarse.",
        commerce: { correlationId: "acceptance-correlation-1" },
      };
    },
    persistOutbound: envelope => outbound.persist(envelope),
  });

  const receivedAt = new Date(Date.now() - 30_000).toISOString();
  const event = {
    messageId: "acceptance-message-1",
    sessionId: "web-session-1",
    visitorId: "web-customer-1",
    customer: { name: "Cliente de prueba" },
    receivedAt,
    text: "¿Tienen talla XS?",
  };
  const [first] = await relay.receive("WEB", tenantId, event);
  assert.equal(first.status, "processed");
  assert.equal(first.result.reply, "La disponibilidad por talla debe confirmarse.");
  assert.equal((await relay.receive("WEB", tenantId, event))[0].status, "duplicate");

  const rows = [...store.records.values()].map(row => row.data);
  const threads = rows.filter(row => row.kind === "THREAD");
  const inboundRows = rows.filter(row => row.kind === "INBOUND");
  const outboundRows = rows.filter(row => row.kind === "OUTBOUND");
  const outboxRows = rows.filter(row => row.kind === "CHANNEL_OUTBOX");
  assert.equal(threads.length, 1);
  assert.equal(inboundRows.length, 1);
  assert.equal(outboundRows.length, 1);
  assert.equal(outboxRows.length, 1);
  assert.equal(outboxRows[0].status, "NOT_SENT");
  assert.equal(outboxRows[0].tenantId, tenantId);
  assert.equal(outboundRows[0].conversationId, threads[0].conversationId);
  assert.equal(outboxRows[0].conversationId, threads[0].conversationId);
  assert.equal(identityResolutions, 1);
  assert.equal(processCalls, 1);
  assert.deepEqual(requests, ["/api/channel-inbound", "/api/channel-outbound"]);
});
