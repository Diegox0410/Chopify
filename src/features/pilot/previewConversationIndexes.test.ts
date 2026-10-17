import { describe, expect, it } from 'vitest'
import indexConfiguration from '../../../firestore.conversations.indexes.json'
import { createPreviewConversationIndexesHandler } from '../../../api/preview-conversation-indexes'

const branch = 'codex/preview-final-chopify'
const sandbox = 'floes-commercial-sandbox-2026'
const previewIndexes = indexConfiguration.indexes.filter(index => index.collectionGroup === 'chopifyWhatsAppLivePreview')
const response = () => ({ statusCode: 0, headers: {} as Record<string, string>, body: '', setHeader(name: string, value: string) { this.headers[name] = value }, end(body = '') { this.body = body } })
const request = (confirmation = 'CREATE_PREVIEW_ONLY_CONVERSATION_INDEXES') => ({ method: 'POST', headers: {}, body: { confirmation } })
const dependencies = (overrides: Partial<Parameters<typeof createPreviewConversationIndexesHandler>[0]> = {}) => ({
  env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch, CHOPIFY_FIREBASE_PROJECT_ID: sandbox },
  getServiceAccount: () => ({ project_id: sandbox, client_email: 'preview-owner@floes-commercial-sandbox-2026.iam.gserviceaccount.com' }),
  getAccessToken: async () => 'synthetic-service-token',
  fetcher: async () => Response.json({ indexes: [] }),
  ...overrides,
})

describe('Preview conversation index provisioning', () => {
  it('is POST-only, explicit-confirmation, branch-gated and sandbox-only', async () => {
    let calls = 0
    const handler = createPreviewConversationIndexesHandler(dependencies({ fetcher: async () => { calls++; return Response.json({ indexes: [] }) } }))
    const method = response(); await handler({ method: 'GET', headers: {} }, method)
    expect(method.statusCode).toBe(405)
    const confirmation = response(); await handler(request(''), confirmation)
    expect(confirmation.statusCode).toBe(400)
    const branchHandler = createPreviewConversationIndexesHandler(dependencies({ env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main', CHOPIFY_FIREBASE_PROJECT_ID: sandbox } }))
    const branchResult = response(); await branchHandler(request(), branchResult)
    expect(branchResult.statusCode).toBe(404)
    const productionProject = createPreviewConversationIndexesHandler(dependencies({ env: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: branch, CHOPIFY_FIREBASE_PROJECT_ID: 'production-project' } }))
    const projectResult = response(); await productionProject(request(), projectResult)
    expect(projectResult.statusCode).toBe(503)
    expect(calls).toBe(0)
  })

  it('creates only the 16 checked-in Preview indexes and reports safe readiness counts', async () => {
    const created: unknown[] = []
    const readyIndexes = previewIndexes.map(index => ({ ...index, state: 'READY' }))
    const handler = createPreviewConversationIndexesHandler(dependencies({ fetcher: async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') { created.push(JSON.parse(String(init.body))); return Response.json({ name: 'synthetic-operation' }, { status: 200 }) }
      return Response.json({ indexes: created.length ? readyIndexes : [] })
    } }))
    const result = response(); await handler(request(), result)
    const payload = JSON.parse(result.body)
    expect(result.statusCode).toBe(200)
    expect(payload).toMatchObject({ ok: true, sandbox: true, projectId: sandbox, tenantId: 'tenant-floes', collection: 'chopifyWhatsAppLivePreview', requiredIndexCount: 16, readyIndexCount: 16, pendingIndexCount: 0, createdThisCall: 16 })
    expect(created).toHaveLength(16)
    expect(result.body).not.toContain('synthetic-service-token')
  })

  it('does not duplicate existing indexes and reports pending builds', async () => {
    const handler = createPreviewConversationIndexesHandler(dependencies({ fetcher: async (_url: unknown, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('should not create an existing index')
      return Response.json({ indexes: previewIndexes.map(index => ({ ...index, state: 'CREATING' })) })
    } }))
    const result = response(); await handler(request(), result)
    expect(result.statusCode).toBe(202)
    expect(JSON.parse(result.body)).toMatchObject({ ok: false, pendingIndexCount: 16, readyIndexCount: 0, createdThisCall: 0, code: 'FIRESTORE_INDEX_BUILDING' })
  })

  it('reports the exact minimum IAM role without exposing credential material', async () => {
    const handler = createPreviewConversationIndexesHandler(dependencies({ fetcher: async () => new Response('{}', { status: 403 }) }))
    const result = response(); await handler(request(), result)
    expect(result.statusCode).toBe(403)
    expect(JSON.parse(result.body)).toMatchObject({ ok: false, sandbox: true, code: 'FIRESTORE_INDEX_ADMIN_PERMISSION_DENIED', requiredRole: 'roles/datastore.indexAdmin', serviceAccountEmail: 'preview-owner@floes-commercial-sandbox-2026.iam.gserviceaccount.com' })
    expect(result.body).not.toContain('private_key')
    expect(result.body).not.toContain('synthetic-service-token')
  })
})
