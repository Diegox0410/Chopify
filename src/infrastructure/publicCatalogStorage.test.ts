/// <reference types="node" />
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { createCatalogImageStorage } from './catalogImageStorageProvider.js'
import { PublicCatalogStorage, publicCatalogImagePath, publicCatalogImagePathFromAssetPath } from './publicCatalogStorage.js'
import type { ServerEnvironment, ServerFetch } from './serviceAccountOAuth.js'

const colors = ['Azul Marino', 'Negro', 'Palo Rosa', 'Blanco', 'Celeste', 'Azul Eléctrico', 'Gris', 'Verde Petróleo', 'Verde Militar', 'Lila', 'Vino', 'Verde Quirúrgico', 'Caqui']
const models = ['María José', 'Daniela', 'Élite']
const env: ServerEnvironment = { FLOES_PUBLIC_BASE_URL: 'https://floes-commerce.vercel.app' }
const sample = () => sharp({ create: { width: 1600, height: 900, channels: 3, background: '#173e63' } }).png().toBuffer()

describe('PublicCatalogStorage', () => {
  it('maps local model/color asset names to the static path and URL', async () => {
    expect(publicCatalogImagePathFromAssetPath('DANIELA/VINO.jpeg')).toBe('/catalogo/floes/daniela/vino.jpeg')
    expect(publicCatalogImagePathFromAssetPath('C:\\assets\\MARIA_JOSE\\VERDE_PETROLEO.jpeg')).toBe('/catalogo/floes/maria-jose/verde-petroleo.jpeg')
    expect(publicCatalogImagePath('Modelo Élite', 'Azul Eléctrico')).toBe('catalogo/floes/elite/azul-electrico.jpeg')
    await expect(new PublicCatalogStorage({ env }).getPublicUrl({ tenantId: 'tenant-floes', model: 'Daniela', color: 'Vino' }))
      .resolves.toBe('https://floes-commerce.vercel.app/catalogo/floes/daniela/vino.jpeg')
  })

  it('uses the public provider by default without Firebase Storage credentials', () => {
    expect(createCatalogImageStorage({ env: { FLOES_PUBLIC_BASE_URL: 'https://preview.example.test' } }).provider).toBe('public')
  })

  it('normalizes to JPEG, resolves existing local assets and is idempotent', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'floes-public-catalog-'))
    try {
      const storage = new PublicCatalogStorage({ env, publicDirectory: directory })
      const reference = { tenantId: 'tenant-floes', model: 'Daniela', color: 'Vino' }
      const bytes = await sample()
      const input = { ...reference, filename: 'VINO.png', dataBase64: bytes.toString('base64') }
      const first = await storage.upload(input)
      const target = path.join(directory, 'daniela', 'vino.jpeg')
      const before = await readFile(target)
      const second = await storage.upload(input)
      const after = await readFile(target)
      expect(first).toMatchObject({ url: 'https://floes-commerce.vercel.app/catalogo/floes/daniela/vino.jpeg', mimeType: 'image/jpeg', objectPath: 'catalogo/floes/daniela/vino.jpeg' })
      expect((await sharp(before).metadata()).format).toBe('jpeg')
      expect(second.sha256).toBe(first.sha256)
      expect(after.equals(before)).toBe(true)
      expect(await storage.exists(reference)).toBe(true)
      expect(await storage.getPublicUrl(reference)).toBe(first.url)
      expect((await readdir(path.dirname(target))).sort()).toEqual(['vino.jpeg'])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('resolves 39 unique HTTPS image URLs for the three pilot models', async () => {
    const visited: string[] = []
    const request: ServerFetch = async (input, init) => {
      expect(init?.method).toBe('HEAD')
      const url = String(input)
      visited.push(url)
      return new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    }
    const storage = new PublicCatalogStorage({ env, fetch: request })
    const entries = models.flatMap(model => colors.map(color => ({ tenantId: 'tenant-floes', model, color })))
    const resolved = await Promise.all(entries.map(async reference => ({ exists: await storage.exists(reference), url: await storage.getPublicUrl(reference) })))
    const urls = resolved.map(entry => entry.url)
    expect(resolved.every(entry => entry.exists)).toBe(true)
    expect(urls).toHaveLength(39)
    expect(new Set(urls).size).toBe(39)
    expect(urls.every(url => url?.startsWith('https://'))).toBe(true)
    expect(visited).toHaveLength(39)
    expect(visited).toContain('https://floes-commerce.vercel.app/catalogo/floes/daniela/vino.jpeg')
  })

  it('rejects remote HTTP origins except localhost', async () => {
    await expect(new PublicCatalogStorage({ env: { FLOES_PUBLIC_BASE_URL: 'http://example.test' } }).getPublicUrl({ tenantId: 'tenant-floes', model: 'Daniela', color: 'Vino' })).rejects.toThrow(/HTTPS origin/)
    await expect(new PublicCatalogStorage({ env: { FLOES_PUBLIC_BASE_URL: 'http://localhost:5173' } }).getPublicUrl({ tenantId: 'tenant-floes', model: 'Daniela', color: 'Vino' })).resolves.toBe('http://localhost:5173/catalogo/floes/daniela/vino.jpeg')
  })
})
