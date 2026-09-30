import { createSampleRepositories } from '../adapters/memory/commercialRepositories.js'
import { createSampleAutomationRepositories } from '../adapters/memory/automationRepositories.js'
import { createMemoryGanoBotRepositories } from '../adapters/memory/ganobotRepositories.js'
import { createMemoryWhatsAppRepositories, SampleWhatsAppAdapter } from '../adapters/memory/whatsappRepositories.js'
import { sampleWhatsAppConnections } from '../data/sample/whatsapp.js'
import { CommercialApplication } from './commercial.js'
import { createSampleOrderRepositories } from '../adapters/memory/orderRepositories.js'
import { OrderApplication } from './orders.js'
import { AutomationApplication } from './automation.js'
import { GanoBotApplication } from './ganobot.js'
import { WhatsAppApplication } from './whatsapp.js'
export const sampleRepositories=createSampleRepositories()
export const sampleCommercialApp=new CommercialApplication(sampleRepositories)
export const sampleOrderRepositories=createSampleOrderRepositories()
export const sampleOrderApp=new OrderApplication({tenants:sampleRepositories.tenants,customers:sampleRepositories.customers,opportunities:sampleRepositories.opportunities,activities:sampleRepositories.activities,...sampleOrderRepositories})
export const sampleAutomationRepositories=createSampleAutomationRepositories()
export const sampleAutomationApp=new AutomationApplication(sampleAutomationRepositories)
export const sampleGanoBotRepositories=createMemoryGanoBotRepositories()
export const sampleGanoBotApp=new GanoBotApplication(sampleCommercialApp,sampleOrderApp,sampleOrderRepositories.commerce,sampleGanoBotRepositories.sessions,sampleGanoBotRepositories.traces)
export const sampleWhatsAppRepositories=createMemoryWhatsAppRepositories(sampleWhatsAppConnections)
export const sampleWhatsAppChannel=new SampleWhatsAppAdapter()
export const sampleWhatsAppApp=new WhatsAppApplication(sampleCommercialApp,sampleRepositories,sampleGanoBotApp,sampleWhatsAppRepositories,sampleWhatsAppChannel)
