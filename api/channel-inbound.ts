import { PersistentCommerceRuntime } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
import { createChannelInboundHandler } from './_lib/channelInboundHandler.js'

const runtime = new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
export default createChannelInboundHandler({
  resolveIdentity: input => runtime.execute({
    operation: 'resolveCustomerIdentity', tenantId: input.tenantId,
    input: { channel: input.channel, externalIdentifier: input.externalCustomerId, ...input.customer, acquisitionSource: input.acquisitionSource },
    actor: { actorId: 'ganobot-channel-inbound', role: 'AUTOMATION', tenantId: input.tenantId },
    requestId: input.providerMessageId, idempotencyKey: input.idempotencyKey,
  }),
})
