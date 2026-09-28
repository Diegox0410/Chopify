import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { verifyMetaSignature, verifyChallenge, extractMessages } from '../api/_lib/live.js'
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
