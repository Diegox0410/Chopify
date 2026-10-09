/// <reference types="node" />
import { generateKeyPairSync } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_CATALOG_IMAGE_BYTES, preflightCatalogStorage, uploadCatalogImage, validateCatalogImageInput } from './catalogImageStorage.js'
import type { ServerEnvironment, ServerFetch } from './serviceAccountOAuth.js'
import handler from '../../api/catalog-assets.js'
import { authorizePlatformOwner } from '../../api/_lib/firebaseAuth.js'

vi.mock('../../api/_lib/firebaseAuth.js', () => ({ authorizePlatformOwner: vi.fn() }))

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const env: ServerEnvironment = {
  FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
    project_id: 'test-project', client_email: 'storage@test-project.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  }),
  CHOPIFY_CATALOG_STORAGE_BUCKET: 'test-project.appspot.com',
}
const input = { tenantId: 'tenant-floes', model: 'Modelo María José', color: 'Azul marino', filename: 'AZUL_MARINO.png', dataBase64: 'AAAA' }
const sample = () => sharp({ create: { width: 2000, height: 1000, channels: 3, background: '#0d3459' } }).png().toBuffer()

function storageFetch(options: { conflict?: boolean; publicStatus?: number; corrupt?: boolean; bucketStatus?: number } = {}) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let image = Buffer.alloc(0)
  let metadata: { name: string; metadata: Record<string, string> } | undefined
  const request: ServerFetch = async (resource, init) => {
    const url = String(resource)
    calls.push({ url, init })
    if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-oauth', expires_in: 3600 })
    if (url.includes('/storage/v1/b/') && !url.includes('/o/')) {
      if (url.includes('/upload/')) {
        const bytes = Buffer.from(init?.body as Uint8Array)
        const jsonStart = bytes.indexOf('\r\n\r\n') + 4
        const jsonEnd = bytes.indexOf('\r\n--', jsonStart)
        metadata = JSON.parse(bytes.subarray(jsonStart, jsonEnd).toString()) as typeof metadata
        const marker = 'Content-Type: image/webp\r\n\r\n'
        const imageStart = bytes.indexOf(marker) + marker.length
        const imageEnd = bytes.lastIndexOf('\r\n--')
        image = bytes.subarray(imageStart, imageEnd)
        return Response.json({}, { status: options.conflict ? 412 : 200 })
      }
      return Response.json({ name: 'test-project.appspot.com', projectNumber: '1234' }, { status: options.bucketStatus ?? 200 })
    }
    if (url.includes('/storage/v1/b/') && url.includes('/o/')) return Response.json({ ...metadata, contentType: 'image/webp', size: String(image.length) })
    if (url.startsWith('https://firebasestorage.googleapis.com/')) return new Response(new Uint8Array(options.corrupt ? Buffer.from('corrupt') : image), {
      status: options.publicStatus ?? 200, headers: { 'Content-Type': 'image/webp' },
    })
    throw new Error('Unexpected storage request')
  }
  return { request, calls, image: () => image, metadata: () => metadata }
}

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks() })

describe('FLOES catalog storage', () => {
  it('rejects unsupported tenants, paths, malformed base64 and oversized bytes before network access', () => {
    for (const patch of [
      { tenantId: 'tenant-mg' }, { model: '../Daniela' }, { color: '\\red' },
      { filename: '../photo.png' }, { filename: 'photo.svg' }, { dataBase64: 'data:image/png;base64,AAAA' },
      { dataBase64: 'AA=A' }, { dataBase64: 'AB==' },
      { dataBase64: Buffer.alloc(MAX_CATALOG_IMAGE_BYTES + 1).toString('base64') },
    ]) expect(() => validateCatalogImageInput({ ...input, ...patch })).toThrow()
  })

  it('resizes to WebP, uses immutable content hashes, and verifies anonymous download bytes', async () => {
    const server = storageFetch()
    const asset = await uploadCatalogImage({ ...input, dataBase64: (await sample()).toString('base64') }, { env, fetch: server.request })
    expect(asset).toMatchObject({ alt: 'Modelo María José — Azul marino', width: 1600, height: 800, mimeType: 'image/webp', sourceFilename: 'AZUL_MARINO.png' })
    expect(asset.bytes).toBeLessThan(1024 * 1024)
    expect(asset.objectPath).toMatch(/^floes\/catalog\/modelo-maria-jose\/azul-marino-[a-f0-9]{64}\.webp$/)
    expect(asset.url).toMatch(/^https:\/\/firebasestorage\.googleapis\.com\//)
    expect(server.metadata()).toMatchObject({ name: asset.objectPath, metadata: { tenantId: 'tenant-floes', sha256: asset.sha256 } })
    expect(server.calls.find(call => call.url.includes('/upload/'))?.url).toContain('ifGenerationMatch=0')
    expect(server.calls.at(-1)?.init?.headers).toBeUndefined()
    expect((await sharp(server.image()).metadata()).format).toBe('webp')
  })

  it('uses existing immutable assets after an insert conflict without overwriting metadata', async () => {
    const server = storageFetch({ conflict: true })
    const asset = await uploadCatalogImage({ ...input, dataBase64: (await sample()).toString('base64') }, { env, fetch: server.request })
    expect(asset.url).toContain(server.metadata()?.metadata.firebaseStorageDownloadTokens)
    expect(server.calls.filter(call => call.init?.method === 'POST')).toHaveLength(2)
    expect(server.calls.some(call => call.init?.method === 'PATCH' || call.init?.method === 'DELETE')).toBe(false)
  })

  it('refuses inaccessible downloads and mismatched bytes instead of publishing unusable URLs', async () => {
    const image = (await sample()).toString('base64')
    for (const options of [{ publicStatus: 403 }, { corrupt: true }]) {
      await expect(uploadCatalogImage({ ...input, dataBase64: image }, { env, fetch: storageFetch(options).request })).rejects.toThrow(/accessible|verification/)
    }
  })

  it('rejects invalid image contents and extensions that disagree with decoded MIME', async () => {
    const server = storageFetch()
    await expect(uploadCatalogImage(input, { env, fetch: server.request })).rejects.toThrow('Invalid image')
    await expect(uploadCatalogImage({ ...input, filename: 'photo.jpeg', dataBase64: (await sample()).toString('base64') }, { env, fetch: server.request })).rejects.toThrow('Invalid image')
    expect(server.calls).toHaveLength(0)
  })

  it('requires an explicit bucket, checks account project match, and performs a read preflight', async () => {
    const server = storageFetch()
    await expect(preflightCatalogStorage({ env: { ...env, CHOPIFY_CATALOG_STORAGE_BUCKET: undefined }, fetch: server.request })).rejects.toThrow('not configured')
    await expect(preflightCatalogStorage({ env: { ...env, CHOPIFY_CATALOG_STORAGE_BUCKET: 'another-project.appspot.com' }, fetch: server.request })).rejects.toThrow('do not match')
    expect(server.calls).toHaveLength(0)
    await expect(preflightCatalogStorage({ env: { ...env, CHOPIFY_CATALOG_STORAGE_BUCKET: undefined, VITE_FIREBASE_STORAGE_BUCKET: 'test-project.appspot.com' }, fetch: server.request })).resolves.toMatchObject({ bucket: 'test-project.appspot.com', projectId: 'test-project' })
    expect(server.calls.at(-1)?.init?.method).toBeUndefined()
    await expect(preflightCatalogStorage({ env, fetch: storageFetch({ bucketStatus: 403 }).request })).rejects.toThrow('unavailable (403)')
  })
})

function response() {
  return {
    statusCode: 0, body: '', headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value },
    end(body = '') { this.body = body },
  }
}

describe('catalog assets API owner authorization', () => {
  it('rejects wrong method and unauthorized callers before parsing or storage calls', async () => {
    const spy = vi.fn()
    vi.stubGlobal('fetch', spy)
    const wrongMethod = response()
    await handler({ method: 'GET', headers: {} }, wrongMethod)
    expect(wrongMethod.statusCode).toBe(405)
    expect(authorizePlatformOwner).not.toHaveBeenCalled()
    for (const status of [401, 403] as const) {
      vi.mocked(authorizePlatformOwner).mockResolvedValue({ ok: false, status, error: 'Unauthorized' })
      const res = response()
      await handler({ method: 'POST', headers: {}, body: '{' }, res)
      expect(res.statusCode).toBe(status)
    }
    expect(spy).not.toHaveBeenCalled()
  })

  it('rejects other tenants and malformed requests from authenticated owners', async () => {
    vi.mocked(authorizePlatformOwner).mockResolvedValue({ ok: true, status: 200, identity: { uid: 'owner' } })
    vi.stubEnv('CATALOG_IMAGE_STORAGE_PROVIDER', 'firebase')
    for (const [body, expected] of [['{', 400], [{ ...input, tenantId: 'tenant-dgng' }, 403], [[], 400], [{ ...input, dataBase64: 'invalid' }, 400]] as const) {
      const res = response()
      await handler({ method: 'POST', headers: {}, body }, res)
      expect(res.statusCode).toBe(expected)
      expect(res.headers['Cache-Control']).toBe('private, no-store')
    }
  })

  it('returns only a verified image asset to an authenticated owner', async () => {
    vi.mocked(authorizePlatformOwner).mockResolvedValue({ ok: true, status: 200, identity: { uid: 'owner' } })
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
    vi.stubEnv('CATALOG_IMAGE_STORAGE_PROVIDER', 'firebase')
    const server = storageFetch()
    vi.stubGlobal('fetch', server.request)
    const res = response()
    await handler({ method: 'POST', headers: {}, body: { ...input, dataBase64: (await sample()).toString('base64') } }, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, data: { width: 1600, height: 800, mimeType: 'image/webp' } })
    expect(res.body).not.toContain('test-oauth')
    expect(res.body).not.toContain('private_key')
  })

  it('resolves public static images without Firebase Storage credentials or bucket configuration', async () => {
    vi.mocked(authorizePlatformOwner).mockResolvedValue({ ok: true, status: 200, identity: { uid: 'owner' } })
    vi.stubEnv('CATALOG_IMAGE_STORAGE_PROVIDER', 'public')
    vi.stubEnv('FLOES_PUBLIC_BASE_URL', 'https://floes-preview.example.test')
    vi.stubEnv('FIREBASE_SERVICE_ACCOUNT_JSON', '')
    vi.stubEnv('CHOPIFY_CATALOG_STORAGE_BUCKET', '')
    const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://floes-preview.example.test/catalogo/floes/daniela/vino.jpeg')
      expect(init?.method).toBe('HEAD')
      return new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    })
    vi.stubGlobal('fetch', request)
    const res = response()
    await handler({ method: 'POST', headers: {}, body: { tenantId: 'tenant-floes', model: 'Daniela', color: 'Vino' } }, res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, data: { url: 'https://floes-preview.example.test/catalogo/floes/daniela/vino.jpeg', objectPath: 'catalogo/floes/daniela/vino.jpeg' } })
  })
})
