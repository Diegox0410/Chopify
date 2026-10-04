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

test('Product Center requires an explicit product currency', () => {
  const source = fs.readFileSync(
    'src/features/catalog/CatalogAdminPage.tsx',
    'utf8',
  )

  assert.equal(source.includes("currency: 'COP'"), false)
  assert.equal(source.includes('storeCurrencies'), false)
  assert.equal(source.includes('currency: selectedCurrency'), true)
  assert.equal(source.includes('Moneda ISO (obligatoria)'), true)
})

test('formal tenant registry does not infer currency', () => {
  const source = fs.readFileSync('src/config/tenantRegistry.js', 'utf8')
  for (const tenant of ['tenant-floes', 'tenant-mg', 'tenant-dgng']) assert.equal(source.includes(`'${tenant}'`), true)
  assert.equal(source.includes('currency:'), false)
})

test('dashboard uses the contractual managed revenue snapshot',()=>{
  const source=fs.readFileSync('api/admin.ts','utf8')
  assert.equal(source.includes('managedSnapshot?.managedRevenueBaseCents'),true)
  assert.equal(source.includes('total + row.grandTotalCents'),false)
})

test('dashboard exposes conversion only when closed opportunities provide a basis',()=>{
  const source=fs.readFileSync('api/admin.ts','utf8')
  assert.equal(source.includes('closedOpportunities.length > 0'),true)
  assert.equal(source.includes('conversionBasis: closedOpportunities.length'),true)
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
