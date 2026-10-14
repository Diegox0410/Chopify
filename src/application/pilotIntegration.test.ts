/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createTenantCommerceState, MemoryCommerceStateStore, PersistentCommerceRuntime } from "./commerceRuntime";
import chopifyCommerceHandler from "../../api/commerce";
import chopifyCatalogHandler from "../../api/catalog";
import catalogHandler from "../../../../floes-commerce/api/catalog";
import storeConfigHandler from "../../../../floes-commerce/api/store-config";
import floesOwnerHandler from "../../../../floes-commerce/api/owner";
import { mapChopifyCatalog } from "../../../../floes-commerce/src/services/chopify/catalog";
import { ownerOperation } from "../../../../floes-commerce/src/services/chopify/owner";

const ownerToken = "isolated-floes-owner-token";
vi.mock("../../../../floes-commerce/src/services/firebase/firebase", () => ({
  auth: { currentUser: { getIdToken: async () => ownerToken } },
}));
vi.mock("../infrastructure/firestoreCommerceStateStore.js", () => ({
  FirestoreCommerceStateStore: class IsolatedStoreAdapter {
    load(tenant: string) { return (globalThis as any).__floesPilotStore.load(tenant); }
    save(tenant: string, state: unknown, expectedVersion: string | null) { return (globalThis as any).__floesPilotStore.save(tenant, state, expectedVersion); }
  },
}));
vi.mock("../../../../floes-commerce/api/_lib/firebaseAuth", () => ({ requireFloesOwner: async () => undefined }));

const tenantId = "tenant-floes";
const assistantId = "commerce-assistant";
const testBearer = "isolated-gano-test-bearer";
const productId = "pilot-daniela-test-only";
const variantId = "pilot-daniela-vino-test-only";

const testProduct = () => ({
  tenantId,
  id: productId,
  sku: "TEST-DANIELA-001",
  slug: "daniela-piloto-test-only",
  name: "Daniela (fixture aislado)",
  description: "Fixture sintético solo para probar contratos; no es una publicación comercial.",
  commercialSummary: "Datos de prueba en memoria.",
  category: "Fixture de integración",
  status: "ACTIVE" as const,
  visibility: "VISIBLE" as const,
  fulfillmentMode: "STOCK" as const,
  pricingStatus: "READY" as const,
  costCents: null,
  percentage: null,
  percentageType: null,
  salePriceCents: 3_999,
  promotionalPriceCents: 3_499,
  currency: "USD",
  images: [{ url: "https://assets.example.test/pilot-daniela.jpg", alt: "Fixture aislado" }],
  variants: [{
    id: variantId,
    sku: "TEST-DANIELA-VINO-001",
    color: "Vino",
    status: "ACTIVE" as const,
    visibility: "VISIBLE" as const,
    images: [{ url: "https://assets.example.test/pilot-daniela-vino.jpg", alt: "Fixture Vino aislado" }],
    stock: 2,
    initialStockBySize: { XS: 1, S: 1, M: 2, L: 1, XL: 1 },
    fulfillmentMode: "STOCK" as const,
    sizes: ["XS", "S", "M", "L", "XL"],
  }],
});

function responseCapture() {
  return {
    statusCode: 200,
    headers: new Map<string, string>(),
    body: "",
    setHeader(name: string, value: string) { this.headers.set(name.toLowerCase(), value); },
    end(body = "") { this.body = body; },
  };
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

describe("FLOES commercial pilot integration (isolated memory adapter)", () => {
  const originalFetch = globalThis.fetch;
  const envKeys = ["CHOPIFY_BASE_URL", "CHOPIFY_VERCEL_PROTECTION_BYPASS_SECRET", "FLOES_WHATSAPP_NUMBER", "VERCEL_ENV", "CHOPIFY_COMMERCE_ALLOWED_TENANTS", "CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS", "CHOPIFY_OPERATIONS_ALLOWED_TENANTS", "CHOPIFY_COMMERCE_API_TOKEN", "CHOPIFY_OWNER_API_TOKEN_FLOES", "CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN", "CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES", "CHOPIFY_COMMERCE_STATE_COLLECTION"];
  const previousEnv = new Map<string, string | undefined>();

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete (globalThis as any).__floesPilotStore;
    for (const key of envKeys) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
  });

  it("runs 17 stages through real GanoBot, Chopify runtime and FLOES client contracts", async () => {
    const calls: Array<{ source: string; operation: string; orderId?: string }> = [];
    const stageResults: Array<{ stage: number; name: string; status: "PASS" | "FAIL"; orderId?: string }> = [];
    const mark = (stage: number, name: string, condition: boolean, orderId?: string) => {
      stageResults.push({ stage, name, status: condition ? "PASS" : "FAIL", ...(orderId ? { orderId } : {}) });
      expect(condition, `stage ${stage}: ${name}`).toBe(true);
    };

    const memoryStore = new MemoryCommerceStateStore();
    const seed = createTenantCommerceState(tenantId);
    const fixtureTime = "2026-10-13T00:00:00.000Z";
    seed.commercial.customers.push({ id: "customer-test-only", tenantId, name: "Cliente aislado", phone: "593000000099", status: "LEAD", createdAt: fixtureTime, updatedAt: fixtureTime });
    seed.commercial.conversations.push({ id: "conversation-test-only", tenantId, customerId: "customer-test-only", channel: "WEB", status: "OPEN", assignedMode: "AUTOMATION", startedAt: fixtureTime, lastActivityAt: fixtureTime, createdAt: fixtureTime, updatedAt: fixtureTime });
    seed.orders.products = [testProduct()];
    seed.orders.inventory = [{ tenantId, productId, variantId, size: "M", onHand: 2, reserved: 0 }];
    await memoryStore.save(tenantId, seed, null);
    (globalThis as any).__floesPilotStore = memoryStore;
    const runtime = new PersistentCommerceRuntime(memoryStore);

    const mockFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://chopify-isolated.test/api/catalog?tenant=tenant-floes")) {
        expect(init?.method ?? "GET").toBe("GET");
        expect(new Headers(init?.headers).get("x-vercel-protection-bypass")).toBe("isolated-preview-bypass-fixture");
        const response = responseCapture();
        await chopifyCatalogHandler({ method: "GET", query: { tenant: tenantId } }, response);
        return new Response(response.body, { status: response.statusCode, headers: Object.fromEntries(response.headers) });
      }
      if (url === "/api/owner") {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${ownerToken}`);
        const response = responseCapture();
        await floesOwnerHandler({ method: "POST", headers: Object.fromEntries(new Headers(init?.headers)), body: String(init?.body ?? "{}") }, response);
        return new Response(response.body, { status: response.statusCode, headers: Object.fromEntries(response.headers) });
      }
      if (url === "https://chopify-isolated.test/api/commerce") {
        expect(init?.method).toBe("POST");
        const headers = Object.fromEntries(new Headers(init?.headers));
        const request = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        const requestInput = isObject(request.input) ? request.input : {};
        const operation = String(request.operation ?? "");
        calls.push({ source: headers["x-chopify-access-scope"] === "owner" ? "FLOES Owner/Admin" : "GanoBot/FLOES API", operation, ...(typeof requestInput.orderId === "string" ? { orderId: requestInput.orderId } : {}) });
        const response = responseCapture();
        await chopifyCommerceHandler({ method: "POST", headers, body: String(init?.body ?? "{}") }, response);
        return new Response(response.body, { status: response.statusCode, headers: Object.fromEntries(response.headers) });
      }
      throw new Error(`Unexpected network request blocked by integration harness: ${url}`);
    };

    for (const key of envKeys) previousEnv.set(key, process.env[key]);
    process.env.CHOPIFY_BASE_URL = "https://chopify-isolated.test";
    process.env.CHOPIFY_VERCEL_PROTECTION_BYPASS_SECRET = "isolated-preview-bypass-fixture";
    process.env.FLOES_WHATSAPP_NUMBER = "593000000001";
    process.env.VERCEL_ENV = "preview";
    process.env.CHOPIFY_COMMERCE_ALLOWED_TENANTS = tenantId;
    process.env.CHOPIFY_PUBLIC_CATALOG_ALLOWED_TENANTS = tenantId;
    process.env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS = tenantId;
    process.env.CHOPIFY_COMMERCE_API_TOKEN = testBearer;
    process.env.CHOPIFY_OWNER_API_TOKEN_FLOES = ownerToken;
    process.env.CHOPIFY_PREVIEW_E2E_COMMERCE_TOKEN = testBearer;
    process.env.CHOPIFY_PREVIEW_E2E_OWNER_TOKEN_FLOES = ownerToken;
    process.env.CHOPIFY_COMMERCE_STATE_COLLECTION = "chopifyCommerceRuntimePilotTest";
    globalThis.fetch = mockFetch as typeof fetch;

    // FLOES public handler + Chopify catalog contract + storefront mapper.
    const catalogResponse = responseCapture();
    await catalogHandler({ method: "GET", headers: {} }, catalogResponse);
    expect(catalogResponse.statusCode).toBe(200);
    const floesProducts = mapChopifyCatalog(JSON.parse(catalogResponse.body));
    expect(floesProducts).toHaveLength(1);
    expect(floesProducts[0].name).toBe("Daniela (fixture aislado)");
    expect(floesProducts[0].variants[0].color).toBe("Vino");
    expect(floesProducts[0].variants[0].sizeAvailability?.find(entry => entry.size === "M")?.availableQuantity).toBe(2);
    mark(1, "FLOES catalog API → Chopify read contract", true);

    const storeResponse = responseCapture();
    await storeConfigHandler({ method: "GET", headers: {} }, storeResponse);
    const storeConfig = JSON.parse(storeResponse.body) as { tenantId: string; contact: { whatsapp: string }; commerce: { whatsappPurchaseEnabled: boolean } };
    expect(storeResponse.statusCode).toBe(200);
    expect(storeConfig.tenantId).toBe(tenantId);
    expect(storeConfig.contact.whatsapp).toBe("593000000001");
    expect(storeConfig.commerce.whatsappPurchaseEnabled).toBe(true);
    mark(2, "FLOES store-config tenant + CTA enabled", true);

    // Real GanoBot adapter/tools; only its network transport is replaced by memory runtime.
    const ganoRoot = resolve("..", "GANO_BOT");
    const importGano = (path: string) => import(pathToFileURL(join(ganoRoot, path)).href);
    const [{ ChopifyHttpAdapter }, { createCatalogTools, CATALOG_TOOL_IDS }, { createCommerceTools, COMMERCE_TOOL_IDS }, conversation] = await Promise.all([
      importGano("apps/functions/dist/commerce/chopifyHttpAdapter.js"),
      importGano("apps/functions/dist/commerce/catalogTools.js"),
      importGano("apps/functions/dist/commerce/tools.js"),
      import(pathToFileURL(join(ganoRoot, "scripts/floes-catalog-conversation.mjs")).href),
    ]) as any;
    const port = new ChopifyHttpAdapter({
      baseUrl: "https://chopify-isolated.test",
      bearerToken: testBearer,
      protectionBypassSecret: "isolated-preview-bypass-fixture",
      fetchImpl: mockFetch,
    });
    const catalogTools = createCatalogTools(port, tenantId, assistantId);
    const commerceTools = createCommerceTools(port, tenantId, assistantId);
    const runTool = async (toolSet: readonly any[], name: string, args: Record<string, unknown>) => {
      const tool = toolSet.find(item => item.descriptor.id === name);
      expect(tool, `GanoBot tool not registered: ${name}`).toBeTruthy();
      return tool.handler.execute(args, { tenantId, assistantId, actorId: "customer-test-only", conversationId: "conversation-test-only", requestId: `gano-${calls.length}`, correlationId: `gano-corr-${calls.length}`, metadata: { customerId: "customer-test-only" } });
    };
    const history = (selection: Record<string, string>) => [{ role: "assistant", content: "Selección comercial", metadata: { commerceSelection: JSON.stringify(selection) } }];

    let selection: Record<string, string> = {};
    let turn = conversation.catalogConversationCall("Quiero ver Daniela");
    let result = await runTool(catalogTools, CATALOG_TOOL_IDS.consultCatalog, turn.arguments);
    let reply = conversation.catalogConversationResponse(result, "Quiero ver Daniela", selection);
    selection = reply.selection;
    expect(selection.productId).toBe(productId);
    mark(3, "GanoBot recommends model from Chopify", true);

    turn = conversation.catalogConversationCall("¿Qué talla me recomiendas?", history(selection));
    result = await runTool(catalogTools, CATALOG_TOOL_IDS.consultCatalog, turn.arguments);
    reply = conversation.catalogConversationResponse(result, "¿Qué talla me recomiendas?", selection);
    expect(reply.reply).toMatch(/guía de tallas/i);
    mark(4, "GanoBot size guidance response", true);

    turn = conversation.catalogConversationCall("Vino", history(selection));
    result = await runTool(catalogTools, CATALOG_TOOL_IDS.consultCatalog, turn.arguments);
    reply = conversation.catalogConversationResponse(result, "Vino", selection);
    selection = reply.selection;
    expect(selection.variantId).toBe(variantId);
    mark(5, "GanoBot selects the Vino variant contract", true);

    turn = conversation.catalogConversationCall("Soy talla M", history(selection));
    result = await runTool(catalogTools, CATALOG_TOOL_IDS.consultCatalog, turn.arguments);
    reply = conversation.catalogConversationResponse(result, "Soy talla M", selection);
    selection = reply.selection;
    expect(result.selectedSize).toBe("M");
    expect(result.availability.available).toBe(true);
    expect(result.availability.availableQuantity).toBe(2);
    mark(6, "GanoBot inventory check for M", true);

    turn = conversation.catalogConversationCall("Lo quiero", history(selection), { customerName: "Cliente aislado", customerPhone: "593000000099" });
    expect(turn.name).toBe(CATALOG_TOOL_IDS.prepareCustomerOrder);
    result = await runTool(catalogTools, CATALOG_TOOL_IDS.prepareCustomerOrder, turn.arguments);
    reply = conversation.catalogConversationResponse(result, "Lo quiero", selection);
    selection = reply.selection;
    expect(selection.customerId).toBeTruthy();
    expect(selection.orderId).toBeTruthy();
    expect(result.order.total.amount).toBe(34.99);
    expect(result.order.status).toBe("draft");
    const adminCustomers = await ownerOperation("listCustomers") as any[];
    expect(adminCustomers.some(customer => customer.id === selection.customerId)).toBe(true);
    const adminCatalog = await ownerOperation("searchProducts", { query: "", limit: 200 }) as any[];
    expect(adminCatalog.some(product => product.productId === productId && product.variants?.some((variant: any) => variant.variantId === variantId && variant.sizeAvailability?.some((size: any) => size.size === "M" && size.availableQuantity === 1)))).toBe(true);
    mark(7, "Customer registration through GanoBot/Chopify", true, selection.orderId);
    mark(8, "Draft order created with shared orderId", true, selection.orderId);

    // Payment method is represented on the submitted proof in the current contract (TRANSFER by default).
    const selectedPaymentMethod = "TRANSFER" as const;

    turn = conversation.catalogConversationCall("Envío mi comprobante de transferencia", history(selection), { paymentProofReference: "meta-whatsapp://123456789012345/media/test-proof" });
    expect(turn.name).toBe(COMMERCE_TOOL_IDS.attachPaymentProof);
    const proof = await runTool(commerceTools, COMMERCE_TOOL_IDS.attachPaymentProof, turn.arguments);
    expect(proof.status).toBe("pending_review");
    expect(proof.orderId).toBe(selection.orderId);
    const proofDetails = await ownerOperation("getOrderDetail", { orderId: selection.orderId }) as any;
    expect(proofDetails.proofs.some((entry: any) => entry.id === proof.proofId && entry.type === selectedPaymentMethod)).toBe(true);
    mark(9, "Transfer choice is reflected in the proof contract", true, selection.orderId);
    mark(10, "Fictitious proof attached, pending review", true, selection.orderId);

    const paymentReviews = await ownerOperation("listPaymentReviews") as any[];
    const review = paymentReviews.find(item => item.order?.id === selection.orderId);
    expect(review.proof.id).toBe(proof.proofId);
    expect(review.payment.id).toBe(proof.paymentId);
    mark(11, "FLOES Admin sees same proof/payment/order IDs", true, selection.orderId);

    const verification = await ownerOperation("approvePayment", { paymentId: proof.paymentId, proofId: proof.proofId }, true) as any;
    expect(verification.orderId).toBe(selection.orderId);
    expect(verification.status).toBe("approved");
    const queue = await ownerOperation("listOrders") as any[];
    const queuedOrder = queue.find(order => order.id === selection.orderId);
    expect(queuedOrder.paymentStatus).toBe("PAID");
    expect(queuedOrder.fulfillmentStatus).toBe("UNFULFILLED");
    mark(12, "FLOES Admin verifies payment; order enters operations queue", true, selection.orderId);

    await ownerOperation("startPreparation", { orderId: selection.orderId }, true);
    await ownerOperation("markReady", { orderId: selection.orderId }, true);
    const statusTool = await runTool(commerceTools, COMMERCE_TOOL_IDS.getOrderStatus, { orderId: selection.orderId });
    reply = conversation.catalogConversationResponse(statusTool, "Estado del pedido", selection);
    expect(statusTool.status).toBe("ready-for-dispatch");
    expect(reply.reply).toMatch(/listo para despacho/i);
    mark(13, "Admin preparation/ready transitions + GanoBot message", true, selection.orderId);

    await ownerOperation("dispatchOrder", { orderId: selection.orderId, courier: "Courier de prueba", trackingCode: "TEST-TRACKING-001" }, true);
    const dispatched = await runTool(commerceTools, COMMERCE_TOOL_IDS.getOrderStatus, { orderId: selection.orderId });
    expect(dispatched.status).toBe("dispatched");
    expect(dispatched.trackingCode).toBe("TEST-TRACKING-001");
    mark(14, "Admin dispatch and GanoBot status read", true, selection.orderId);

    await ownerOperation("markDelivered", { orderId: selection.orderId }, true);
    const delivered = await runTool(commerceTools, COMMERCE_TOOL_IDS.getOrderStatus, { orderId: selection.orderId });
    expect(delivered.status).toBe("delivered");
    expect(delivered.orderId).toBe(selection.orderId);
    reply = conversation.catalogConversationResponse(delivered, "Estado", selection);
    expect(reply.reply).toMatch(/figura entregado/i);
    mark(15, "Admin marks delivery; GanoBot reads same order", true, selection.orderId);

    turn = conversation.catalogConversationCall("Ya recibí mi pedido y estoy contenta", history({ ...selection, orderStatus: "delivered" }));
    expect(turn.name).toBe("commerce.recordOrderFollowUp");
    const followUp = await runTool(catalogTools, turn.name, turn.arguments);
    reply = conversation.catalogConversationResponse(followUp, "Ya recibí mi pedido y estoy contenta", selection);
    expect(followUp.order.orderId).toBe(selection.orderId);
    expect(reply.reply).toMatch(/registramos tu seguimiento/i);
    mark(16, "GanoBot post-sale follow-up records same order", true, selection.orderId);

    const finalOrder = await runtime.execute({ operation: "getOrderDetail", tenantId, input: { orderId: selection.orderId }, actor: { actorId: "test-audit", role: "TENANT_OWNER", tenantId } }) as any;
    expect(finalOrder.order.id).toBe(selection.orderId);
    expect(finalOrder.order.paymentStatus).toBe("PAID");
    expect(finalOrder.order.fulfillmentStatus).toBe("DELIVERED");
    expect(finalOrder.payment.id).toBe(proof.paymentId);
    expect(finalOrder.proofs[0].id).toBe(proof.proofId);
    expect(finalOrder.order.followUp.outcome).toBe("SATISFIED");
    expect((await memoryStore.load(tenantId))?.state.orders.orders).toHaveLength(1);
    mark(17, "Final records and state agree in isolated memory", true, selection.orderId);

    expect(stageResults).toHaveLength(17);
    expect(stageResults.every(item => item.status === "PASS")).toBe(true);
    expect(calls.every(item => item.orderId === undefined || item.orderId === selection.orderId)).toBe(true);
  });
});
