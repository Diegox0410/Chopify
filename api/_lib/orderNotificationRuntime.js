import { createOrderNotificationService } from './orderNotifications.js'
import { createDoc, getDoc, sendOutbound, updateDoc } from './live.js'
import { getConversationDeliveryContext } from './conversationStore.js'

export const orderNotifier = runtime => createOrderNotificationService({
  runtime, get: getDoc, create: createDoc, update: updateDoc, send: sendOutbound, context: getConversationDeliveryContext,
})
