import { PersistentCommerceRuntime } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
import { whatsappChannels } from './_lib/channelRegistry.js'
import { createPaymentProofHandler } from './_lib/paymentProofProxy.js'

const runtime = new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
export default createPaymentProofHandler({ runtimeClient: runtime, env: process.env, channels: whatsappChannels })
