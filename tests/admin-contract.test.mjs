import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('admin integration status never claims CONNECTED from env presence alone', () => {
  const source = fs.readFileSync('api/admin.ts', 'utf8')

  assert.equal(
    source.includes("? 'CONNECTED' : 'NOT_CONFIGURED'"),
    false,
  )

  assert.equal(source.includes("'CONFIGURED'"), true)
})

test('admin dashboard exposes currency-aware revenue contract', () => {
  const source = fs.readFileSync('api/admin.ts', 'utf8')

  assert.equal(source.includes('managedRevenueCurrency'), true)
  assert.equal(source.includes('revenueByCurrency'), true)
  assert.equal(source.includes('currencyStatus'), true)
  assert.equal(source.includes("'MIXED'"), true)
})

test('Product Center does not create new products in COP', () => {
  const source = fs.readFileSync(
    'src/features/catalog/CatalogAdminPage.tsx',
    'utf8',
  )

  assert.equal(source.includes("currency: 'COP'"), false)
  assert.equal(source.includes('currency: storeCurrencies[tenant]'), true)
})

test('formal tenant registry declares USD without rewriting stored records', () => {
  const source = fs.readFileSync(
    'src/application/commerceRuntime.ts',
    'utf8',
  )

  for (const tenant of ['tenant-floes', 'tenant-mg', 'tenant-dgng']) {
    const definition = source
      .split('\n')
      .find(line => line.includes(`'${tenant}'`))

    assert.ok(definition)
    assert.equal(definition.includes("currency:'USD'"), true)
  }
})


test('admin BFF propagates the authenticated Firebase owner into the commerce runtime', () => {
  const source = fs.readFileSync('api/admin.ts', 'utf8')

  assert.equal(source.includes('actorId: auth.identity.uid'), true)
  assert.equal(source.includes("role: 'PLATFORM_OWNER'"), true)
})

test('Commerce Gateway accepts caller actor and preserves Operations fallback', () => {
  const source = fs.readFileSync(
    'src/application/commerceGateway.ts',
    'utf8',
  )

  assert.equal(source.includes('actor?: ActorContext'), true)
  assert.equal(
    source.includes('humanActor(tenantId,request.actor)'),
    true,
  )
  assert.equal(
    source.includes("actorId:'chopify-operations',role:'TENANT_OWNER'"),
    true,
  )
})

test('Business Center has no COP-only currency formatter', () => {
  const source = fs.readFileSync(
    'src/features/platform/AdminCenters.tsx',
    'utf8',
  )

  assert.equal(source.includes("currency: 'COP'"), false)
  assert.equal(
    source.includes('currencyCode: string'),
    true,
  )
})
