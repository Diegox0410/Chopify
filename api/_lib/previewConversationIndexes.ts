import indexConfiguration from "../../firestore.conversations.indexes.json";
import { getFirestoreAccessToken, getFirestoreServiceAccount } from "./live.js";
import type { ApiRequest, ApiResponse } from "./http.js";

const SANDBOX_PROJECT = "floes-commercial-sandbox-2026";
const PREVIEW_BRANCH = "codex/preview-final-chopify";
const PREVIEW_COLLECTION = "chopifyWhatsAppLivePreview";
const CONFIRMATION = "CREATE_PREVIEW_ONLY_CONVERSATION_INDEXES";
const PREVIEW_INDEXES = indexConfiguration.indexes.filter(index => index.collectionGroup === PREVIEW_COLLECTION);

type FirestoreIndex = {
  collectionGroup?: string;
  queryScope?: string;
  fields?: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
  state?: string;
};
type Dependencies = {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  getServiceAccount?: typeof getFirestoreServiceAccount;
  getAccessToken?: typeof getFirestoreAccessToken;
};

const json = (response: ApiResponse, status: number, body: Record<string, unknown>) => {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "private, no-store");
  response.end(JSON.stringify(body));
};
const requestBody = (body: unknown) => {
  if (typeof body === "string") {
    try { return JSON.parse(body) as Record<string, unknown>; } catch { return {}; }
  }
  return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
};
const normalizedFields = (index: FirestoreIndex) => (index.fields ?? [])
  .filter(field => field.fieldPath !== "__name__")
  .map(field => ({ fieldPath: field.fieldPath, ...(field.order ? { order: field.order } : {}), ...(field.arrayConfig ? { arrayConfig: field.arrayConfig } : {}) }));
const indexKey = (index: FirestoreIndex) => JSON.stringify({ queryScope: index.queryScope ?? "COLLECTION", fields: normalizedFields(index) });
const replyRoleBlock = (response: ApiResponse, email: unknown) => json(response, 403, {
  ok: false,
  sandbox: true,
  code: "FIRESTORE_INDEX_ADMIN_PERMISSION_DENIED",
  requiredRole: "roles/datastore.indexAdmin",
  ...(typeof email === "string" && email.includes("@") ? { serviceAccountEmail: email } : {}),
});

export function createPreviewConversationIndexesHandler(dependencies: Dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const fetcher = dependencies.fetcher ?? fetch;
  const getServiceAccount = dependencies.getServiceAccount ?? getFirestoreServiceAccount;
  const getAccessToken = dependencies.getAccessToken ?? getFirestoreAccessToken;

  return async (request: ApiRequest, response: ApiResponse) => {
    if (request.method !== "POST") return json(response, 405, { ok: false, error: "Method not allowed." });
    if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== PREVIEW_BRANCH) return json(response, 404, { ok: false, error: "Preview sandbox route unavailable." });
    if (env.CHOPIFY_FIREBASE_PROJECT_ID?.trim() !== SANDBOX_PROJECT) return json(response, 503, { ok: false, sandbox: false, code: "FIRESTORE_PROJECT_MISMATCH" });
    if (requestBody(request.body).confirmation !== CONFIRMATION) return json(response, 400, { ok: false, sandbox: true, error: "Sandbox index confirmation is required." });

    let account: ReturnType<typeof getFirestoreServiceAccount>;
    let token: string;
    try {
      account = getServiceAccount();
      if (account.project_id !== SANDBOX_PROJECT || !account.client_email) return json(response, 503, { ok: false, sandbox: false, code: "FIRESTORE_PROJECT_MISMATCH" });
      token = await getAccessToken();
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : "FIRESTORE_SERVICE_ACCOUNT_INVALID";
      return json(response, 503, { ok: false, sandbox: true, code: ["FIREBASE_OAUTH_UNAVAILABLE", "FIRESTORE_SERVICE_ACCOUNT_REJECTED", "FIRESTORE_SERVICE_ACCOUNT_INVALID"].includes(code) ? code : "FIRESTORE_SERVICE_ACCOUNT_INVALID" });
    }

    const endpoint = `https://firestore.googleapis.com/v1/projects/${SANDBOX_PROJECT}/databases/(default)/collectionGroups/${PREVIEW_COLLECTION}/indexes`;
    const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    const listIndexes = async () => {
      const result = await fetcher(`${endpoint}?pageSize=100`, { method: "GET", headers, signal: AbortSignal.timeout(12_000) });
      if (result.status === 403) return { denied: true as const };
      if (!result.ok) return { failed: true as const, status: result.status };
      const payload = await result.json().catch(() => ({})) as { indexes?: FirestoreIndex[] };
      return { indexes: Array.isArray(payload.indexes) ? payload.indexes : [] };
    };

    try {
      const current = await listIndexes();
      if ("denied" in current) return replyRoleBlock(response, account.client_email);
      if ("failed" in current) return json(response, 502, { ok: false, sandbox: true, code: "FIRESTORE_INDEX_LIST_FAILED", upstreamStatus: current.status });

      const known = new Set(current.indexes.map(indexKey));
      let createdThisCall = 0;
      for (const candidate of PREVIEW_INDEXES as FirestoreIndex[]) {
        if (known.has(indexKey(candidate))) continue;
        const created = await fetcher(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ queryScope: candidate.queryScope ?? "COLLECTION", fields: candidate.fields ?? [] }),
          signal: AbortSignal.timeout(12_000),
        });
        if (created.status === 403) return replyRoleBlock(response, account.client_email);
        if (![200, 201, 202, 409].includes(created.status)) return json(response, 502, { ok: false, sandbox: true, code: "FIRESTORE_INDEX_CREATE_FAILED", upstreamStatus: created.status });
        if (created.status !== 409) createdThisCall += 1;
        known.add(indexKey(candidate));
      }

      const refreshed = await listIndexes();
      if ("denied" in refreshed) return replyRoleBlock(response, account.client_email);
      if ("failed" in refreshed) return json(response, 502, { ok: false, sandbox: true, code: "FIRESTORE_INDEX_LIST_FAILED", upstreamStatus: refreshed.status });
      const readyKeys = new Set(refreshed.indexes.filter(index => index.state === "READY").map(indexKey));
      const readyCount = PREVIEW_INDEXES.filter(index => readyKeys.has(indexKey(index as FirestoreIndex))).length;
      const pendingCount = PREVIEW_INDEXES.length - readyCount;
      return json(response, pendingCount === 0 ? 200 : 202, {
        ok: pendingCount === 0,
        sandbox: true,
        projectId: SANDBOX_PROJECT,
        tenantId: "tenant-floes",
        collection: PREVIEW_COLLECTION,
        requiredIndexCount: PREVIEW_INDEXES.length,
        readyIndexCount: readyCount,
        pendingIndexCount: pendingCount,
        createdThisCall,
        ...(pendingCount ? { code: "FIRESTORE_INDEX_BUILDING" } : {}),
      });
    } catch {
      return json(response, 502, { ok: false, sandbox: true, code: "FIRESTORE_INDEX_ADMIN_UNAVAILABLE" });
    }
  };
}

export default createPreviewConversationIndexesHandler();
