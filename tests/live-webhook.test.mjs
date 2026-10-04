import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyMetaSignature, verifyChallenge, extractMessages, metaErrorDetails, prepareReply, escalationReason, receive, sendOutbound, LiveDependencyError } from '../api/_lib/live.js'
import { operationsAllowedTenants, validOperationsToken } from '../api/conversations.js'
import { resolveWhatsAppChannel } from '../api/_lib/channelRegistry.js'
test('Meta HMAC validates exact raw bytes and rejects tampering', () => {
  const raw = Buffer.from('{"entry":[]}')
  const sig = 'sha256=' + createHmac('sha256', 'private').update(raw).digest('hex')
  assert.equal(verifyMetaSignature(raw, sig, 'private'), true)
  assert.equal(verifyMetaSignature(Buffer.from('{"entry":[1]}'), sig, 'private'), false)
  assert.equal(verifyMetaSignature(raw, 'sha256=garbage', 'private'), false)
})
test('challenge requires exact verification token', () => {
  assert.equal(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'abc', 'hub.challenge': '123' }, 'abc'), '123')
  assert.equal(verifyChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'bad', 'hub.challenge': '123' }, 'abc'), null)
})
test('only tenant phone number text messages pass extraction', () => {
  const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'FLOES' }, messages: [{ id: 'wamid.1', from: '+593 96 270 1442', type: 'text', text: { body: 'Hola' } }, { id: 'wamid.2', from: '593962701442', type: 'image' }] } }] }] }
  assert.deepEqual(extractMessages(payload, 'OTHER'), [])
  const found = extractMessages(payload, 'FLOES')
  assert.equal(found.length, 1)
  assert.equal(found[0].from, '593962701442')
})
test('live reply forwards the synchronized bearer and resolved tenant identity', async () => {
  const previousUrl = process.env.GANOBOT_LIVE_URL
  const previousToken = process.env.GANOBOT_LIVE_BEARER_TOKEN
  const previousFetch = globalThis.fetch
  process.env.GANOBOT_LIVE_URL = 'https://gano.example/api/live'
  process.env.GANOBOT_LIVE_BEARER_TOKEN = 'private-live-token'
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://gano.example/api/live')
      assert.equal(init.method, 'POST')
      assert.equal(init.headers.Authorization, 'Bearer private-live-token')
      assert.deepEqual(JSON.parse(init.body), {
        tenantId: 'tenant-mg',
        channel: 'WHATSAPP',
        providerMessageId: 'wamid.123',
        customer: { phone: '593962701442', name: 'Cliente' },
        text: '¿Qué productos tienen disponibles?',
        correlationId: 'corr-123',
      })
      return new Response(JSON.stringify({ reply: 'Catálogo FLOES' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    assert.deepEqual(await prepareReply({
      id: 'wamid.123',
      from: '593962701442',
      name: 'Cliente',
      text: '¿Qué productos tienen disponibles?',
      tenantId: 'tenant-mg',
      correlationId: 'corr-123',
    }), { text: 'Catálogo FLOES', requiresHuman: false, mode: 'GANOBOT_LIVE' })
  } finally {
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.GANOBOT_LIVE_URL
    else process.env.GANOBOT_LIVE_URL = previousUrl
    if (previousToken === undefined) delete process.env.GANOBOT_LIVE_BEARER_TOKEN
    else process.env.GANOBOT_LIVE_BEARER_TOKEN = previousToken
  }
})

test('phone_number_id resolves a configured tenant and unknown channels are rejected',()=>{
  const previous=process.env.CHOPIFY_WHATSAPP_CHANNELS_JSON
  process.env.CHOPIFY_WHATSAPP_CHANNELS_JSON=JSON.stringify([
    {tenantId:'tenant-floes',phoneNumberId:'phone-a',accessTokenEnv:'TOKEN_A'},
    {tenantId:'tenant-mg',phoneNumberId:'phone-b',accessTokenEnv:'TOKEN_B'},
  ])
  try{
    assert.equal(resolveWhatsAppChannel('phone-b')?.tenantId,'tenant-mg')
    assert.equal(resolveWhatsAppChannel('phone-b')?.accessTokenEnv,'TOKEN_B')
    assert.equal(resolveWhatsAppChannel('unknown'),null)
  }finally{
    if(previous===undefined)delete process.env.CHOPIFY_WHATSAPP_CHANNELS_JSON
    else process.env.CHOPIFY_WHATSAPP_CHANNELS_JSON=previous
  }
})

test('outbound uses the persisted tenant channel and its token reference',async()=>{
  const previousToken=process.env.TOKEN_MG_TEST
  process.env.TOKEN_MG_TEST='token-mg'
  const updates=[]
  try{
    const result=await sendOutbound('out-mg',{
      getDoc:async()=>({tenantId:'tenant-mg',phoneNumberId:'phone-mg',status:'PENDING',attempts:'0',to:'593999999999',text:'Hola',inboundId:'in-mg'}),
      createDoc:async()=>true,
      updateDoc:async(id,data)=>updates.push({id,data}),
      resolveChannel:id=>id==='phone-mg'?{tenantId:'tenant-mg',externalChannelId:'phone-mg',accessTokenEnv:'TOKEN_MG_TEST'}:null,
      fetch:async(url,init)=>{
        assert.match(url,/\/phone-mg\/messages$/)
        assert.equal(init.headers.Authorization,'Bearer token-mg')
        return new Response(JSON.stringify({messages:[{id:'wamid.out.mg'}]}),{status:200})
      },
    })
    assert.deepEqual(result,{status:'SENT',providerMessageId:'wamid.out.mg'})
    assert.equal(updates.at(-1).data.status,'SENT')
  }finally{
    if(previousToken===undefined)delete process.env.TOKEN_MG_TEST
    else process.env.TOKEN_MG_TEST=previousToken
  }
})

test('explicit GanoBot HUMAN decision wins even when a reply is present', async () => {
  const previousUrl = process.env.GANOBOT_LIVE_URL
  const previousToken = process.env.GANOBOT_LIVE_BEARER_TOKEN
  const previousFetch = globalThis.fetch

  process.env.GANOBOT_LIVE_URL = 'https://gano.example/api/live'
  process.env.GANOBOT_LIVE_BEARER_TOKEN = 'private-live-token'

  globalThis.fetch = async () => new Response(JSON.stringify({
    reply: 'Este texto no debe enviarse automáticamente',
    requiresHuman: true,
    escalationReason: 'CUSTOMER_REQUEST',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })

  try {
    assert.deepEqual(
      await prepareReply({
        id: 'wamid.human',
        from: '593962701442',
        name: 'Cliente',
        text: 'Quiero hablar con una persona',
      }),
      {
        requiresHuman: true,
        escalationReason: 'CUSTOMER_REQUEST',
        mode: 'GANOBOT_LIVE',
      },
    )
  } finally {
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.GANOBOT_LIVE_URL
    else process.env.GANOBOT_LIVE_URL = previousUrl
    if (previousToken === undefined) delete process.env.GANOBOT_LIVE_BEARER_TOKEN
    else process.env.GANOBOT_LIVE_BEARER_TOKEN = previousToken
  }
})

test('unknown GanoBot HUMAN reason is sanitized to OTHER', async () => {
  const previousUrl = process.env.GANOBOT_LIVE_URL
  const previousToken = process.env.GANOBOT_LIVE_BEARER_TOKEN
  const previousFetch = globalThis.fetch

  process.env.GANOBOT_LIVE_URL = 'https://gano.example/api/live'
  process.env.GANOBOT_LIVE_BEARER_TOKEN = 'private-live-token'

  globalThis.fetch = async () => new Response(JSON.stringify({
    requiresHuman: true,
    escalationReason: 'UNTRUSTED_REASON',
  }), { status: 200 })

  try {
    assert.deepEqual(
      await prepareReply({
        id: 'wamid.human.unknown',
        from: '593962701442',
        name: 'Cliente',
        text: 'Necesito ayuda',
      }),
      {
        requiresHuman: true,
        escalationReason: 'OTHER',
        mode: 'GANOBOT_LIVE',
      },
    )
  } finally {
    globalThis.fetch = previousFetch
    if (previousUrl === undefined) delete process.env.GANOBOT_LIVE_URL
    else process.env.GANOBOT_LIVE_URL = previousUrl
    if (previousToken === undefined) delete process.env.GANOBOT_LIVE_BEARER_TOKEN
    else process.env.GANOBOT_LIVE_BEARER_TOKEN = previousToken
  }
})

test('Meta errors retain actionable diagnostics without credentials', () => {
  assert.deepEqual(metaErrorDetails(401, { error: { code: 190, type: 'OAuthException', message: 'Invalid OAuth access token.', fbtrace_id: 'trace-123' } }), {
    httpStatus: 401,
    metaErrorCode: 190,
    metaErrorType: 'OAuthException',
    message: 'Invalid OAuth access token.',
    fbtraceId: 'trace-123',
  })
})
test('missing GanoBot config escalates to HUMAN without fabricating a reply', async () => {
  const previousUrl = process.env.GANOBOT_LIVE_URL
  const previousToken = process.env.GANOBOT_LIVE_BEARER_TOKEN
  delete process.env.GANOBOT_LIVE_URL
  delete process.env.GANOBOT_LIVE_BEARER_TOKEN
  try {
    await assert.rejects(() => prepareReply({ id: 'wamid.missing' }), error => escalationReason(error) === 'GANOBOT_NOT_CONFIGURED')
  } finally {
    if (previousUrl !== undefined) process.env.GANOBOT_LIVE_URL = previousUrl
    if (previousToken !== undefined) process.env.GANOBOT_LIVE_BEARER_TOKEN = previousToken
  }
})
test('invalid GanoBot response has a stable auditable escalation reason', async () => {
  const previousUrl = process.env.GANOBOT_LIVE_URL
  const previousToken = process.env.GANOBOT_LIVE_BEARER_TOKEN
  const previousFetch = globalThis.fetch
  process.env.GANOBOT_LIVE_URL = 'https://gano.example/api/live'
  process.env.GANOBOT_LIVE_BEARER_TOKEN = 'private-live-token'
  globalThis.fetch = async () => new Response(JSON.stringify({ reply: '' }), { status: 200 })
  try { await assert.rejects(() => prepareReply({ id: 'wamid.invalid' }), error => escalationReason(error) === 'GANOBOT_INVALID_RESPONSE') }
  finally { globalThis.fetch = previousFetch; if (previousUrl === undefined) delete process.env.GANOBOT_LIVE_URL; else process.env.GANOBOT_LIVE_URL = previousUrl; if (previousToken === undefined) delete process.env.GANOBOT_LIVE_BEARER_TOKEN; else process.env.GANOBOT_LIVE_BEARER_TOKEN = previousToken }
})
test('conversation reads require the exact operations bearer', () => {
  assert.equal(validOperationsToken('Bearer operations-secret', 'operations-secret'), true)
  assert.equal(validOperationsToken('Bearer wrong', 'operations-secret'), false)
  assert.equal(validOperationsToken('', 'operations-secret'), false)
  assert.equal(validOperationsToken('Bearer operations-secret', ''), false)
})
test('conversation Operations access is explicitly tenant scoped',()=>{
  const previous=process.env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS
  delete process.env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS
  try{assert.deepEqual([...operationsAllowedTenants()],['tenant-floes'])}
  finally{if(previous!==undefined)process.env.CHOPIFY_OPERATIONS_ALLOWED_TENANTS=previous}
})


test('receive queues exactly one outbound for an automatic reply', async () => {
  const created = []
  const updated = []

  const result = await receive({
    id: 'wamid.receive.auto',
    from: '593999999999',
    text: 'Hola',
    name: 'Cliente',
    phoneNumberId: 'phone-floes',
    tenantId: 'tenant-floes',
    receivedAt: new Date().toISOString(),
  }, {
    createDoc: async (id, data) => {
      created.push({ id, data })
      return true
    },
    updateDoc: async (id, data) => {
      updated.push({ id, data })
    },
    prepareReply: async () => ({
      text: 'Respuesta automática',
      requiresHuman: false,
      mode: 'GANOBOT_LIVE',
    }),
  })

  const inbound = created.find(entry => entry.id.startsWith('in_'))
  const outbound = created.find(entry => entry.id.startsWith('out_'))

  assert.ok(inbound)
  assert.ok(outbound)

  // El outbound nace bloqueado: todavía no puede ser despachado.
  assert.equal(outbound.data.status, 'PREPARED')

  // Primero debe quedar persistido el inbound como QUEUED.
  const inboundQueuedIndex = updated.findIndex(entry =>
    entry.id === inbound.id &&
    entry.data.status === 'QUEUED'
  )

  // Solo después se habilita el outbound para despacho.
  const outboundPendingIndex = updated.findIndex(entry =>
    entry.id === outbound.id &&
    entry.data.status === 'PENDING'
  )

  assert.notEqual(inboundQueuedIndex, -1)
  assert.notEqual(outboundPendingIndex, -1)
  assert.ok(inboundQueuedIndex < outboundPendingIndex)

  assert.equal(result.duplicate, false)
  assert.equal(result.outboundId, outbound.id)

  // Exactamente un outbound fue persistido.
  assert.equal(
    created.filter(entry => entry.id.startsWith('out_')).length,
    1,
  )
})

test('receive explicit HUMAN decision creates no outbound', async () => {
  const created = []
  const updated = []

  const result = await receive({
    id: 'wamid.receive.human',
    from: '593962701442',
    name: 'Cliente',
    text: 'Quiero una persona',
    phoneNumberId: 'FLOES',
    tenantId: 'tenant-floes',
    receivedAt: '2026-10-04T03:00:00.000Z',
  }, {
    createDoc: async (id, data) => {
      created.push({ id, data })
      return true
    },
    updateDoc: async (id, data) => {
      updated.push({ id, data })
    },
    prepareReply: async () => ({
      requiresHuman: true,
      escalationReason: 'CUSTOMER_REQUEST',
      mode: 'GANOBOT_LIVE',
    }),
  })

  assert.equal(result.needsHuman, true)
  assert.equal(result.escalationReason, 'CUSTOMER_REQUEST')
  assert.equal(created.length, 1)
  assert.equal(updated.length, 1)
  assert.equal(updated[0].data.status, 'NEEDS_HUMAN')
  assert.equal(updated[0].data.escalationReason, 'CUSTOMER_REQUEST')
})

test('duplicate inbound stops before GanoBot and creates no outbound', async () => {
  let ganobotCalls = 0
  let createCalls = 0
  let updateCalls = 0

  const result = await receive({
    id: 'wamid.receive.duplicate',
    from: '593962701442',
    name: 'Cliente',
    text: 'Hola otra vez',
    phoneNumberId: 'FLOES',
    tenantId: 'tenant-floes',
    receivedAt: '2026-10-04T03:00:00.000Z',
  }, {
    createDoc: async () => {
      createCalls += 1
      return false
    },
    updateDoc: async () => {
      updateCalls += 1
    },
    prepareReply: async () => {
      ganobotCalls += 1
      return {
        text: 'No debe ejecutarse',
        requiresHuman: false,
        mode: 'GANOBOT_LIVE',
      }
    },
  })

  assert.equal(result.duplicate, true)
  assert.equal(createCalls, 1)
  assert.equal(ganobotCalls, 0)
  assert.equal(updateCalls, 0)
})

test('GanoBot failure becomes SYSTEM_ERROR with its technical reason and no outbound', async () => {
  const created = []
  const updated = []

  const result = await receive({
    id: 'wamid.receive.timeout',
    from: '593962701442',
    name: 'Cliente',
    text: 'Hola',
    phoneNumberId: 'FLOES',
    tenantId: 'tenant-floes',
    receivedAt: '2026-10-04T03:00:00.000Z',
  }, {
    createDoc: async (id, data) => {
      created.push({ id, data })
      return true
    },
    updateDoc: async (id, data) => {
      updated.push({ id, data })
    },
    prepareReply: async () => {
      throw new LiveDependencyError(
        'GANOBOT_TIMEOUT',
        'GanoBot live request timed out',
      )
    },
  })

  assert.equal(result.needsHuman, true)
  assert.equal(result.escalationReason, 'SYSTEM_ERROR')
  assert.equal(result.technicalReason, 'GANOBOT_TIMEOUT')
  assert.equal(created.length, 1)
  assert.equal(updated.length, 1)
  assert.equal(updated[0].data.status, 'NEEDS_HUMAN')
  assert.equal(updated[0].data.technicalReason, 'GANOBOT_TIMEOUT')
})

test('outbound persistence failure is never mislabeled as GanoBot unavailable', async () => {
  const updated = []
  let createCalls = 0
  let ganobotCalls = 0

  const result = await receive({
    id: 'wamid.receive.persistence',
    from: '593962701442',
    name: 'Cliente',
    text: 'Hola',
    phoneNumberId: 'FLOES',
    tenantId: 'tenant-floes',
    receivedAt: '2026-10-04T03:00:00.000Z',
  }, {
    createDoc: async () => {
      createCalls += 1

      if (createCalls === 1) return true

      throw new Error('Firestore create failed (503)')
    },
    updateDoc: async (id, data) => {
      updated.push({ id, data })
    },
    prepareReply: async () => {
      ganobotCalls += 1
      return {
        text: 'Respuesta válida de GanoBot',
        requiresHuman: false,
        mode: 'GANOBOT_LIVE',
      }
    },
  })

  assert.equal(ganobotCalls, 1)
  assert.equal(result.needsHuman, true)
  assert.equal(result.escalationReason, 'SYSTEM_ERROR')
  assert.equal(result.technicalReason, 'OUTBOUND_PERSISTENCE_ERROR')
  assert.notEqual(result.technicalReason, 'GANOBOT_UNAVAILABLE')
  assert.equal(updated.at(-1).data.status, 'NEEDS_HUMAN')
  assert.equal(
    updated.at(-1).data.technicalReason,
    'OUTBOUND_PERSISTENCE_ERROR',
  )
})


test('inbound queue persistence failure never leaves a sendable outbound', async () => {
  const created = []
  const updated = []

  const result = await receive({
    id: 'wamid.receive.queue-failure',
    from: '593999999999',
    text: 'Hola',
    name: 'Cliente',
    phoneNumberId: 'phone-floes',
    tenantId: 'tenant-floes',
    receivedAt: new Date().toISOString(),
  }, {
    createDoc: async (id, data) => {
      created.push({ id, data })
      return true
    },
    updateDoc: async (id, data) => {
      updated.push({ id, data })

      if (
        id.startsWith('in_') &&
        data.status === 'QUEUED'
      ) {
        throw new Error('simulated inbound queue persistence failure')
      }
    },
    prepareReply: async () => ({
      text: 'Respuesta segura',
      requiresHuman: false,
      mode: 'GANOBOT_LIVE',
    }),
  })

  const outbound = created.find(entry => entry.id.startsWith('out_'))

  assert.ok(outbound)
  assert.equal(outbound.data.status, 'PREPARED')

  assert.equal(
    updated.some(entry =>
      entry.id.startsWith('out_') &&
      entry.data.status === 'PENDING'
    ),
    false,
  )

  assert.equal(result.needsHuman, true)
  assert.equal(result.escalationReason, 'SYSTEM_ERROR')
  assert.equal(result.technicalReason, 'OUTBOUND_PERSISTENCE_ERROR')
})
