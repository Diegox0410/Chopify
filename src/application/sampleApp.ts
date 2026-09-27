import { createSampleRepositories } from '../adapters/memory/commercialRepositories'
import { createSampleAutomationRepositories } from '../adapters/memory/automationRepositories'
import { createMemoryGanoBotRepositories } from '../adapters/memory/ganobotRepositories'
import { CommercialApplication } from './commercial'
import { createSampleOrderRepositories } from '../adapters/memory/orderRepositories'
import { OrderApplication } from './orders'
import { AutomationApplication } from './automation'
import { GanoBotApplication } from './ganobot'
export const sampleRepositories=createSampleRepositories()
export const sampleCommercialApp=new CommercialApplication(sampleRepositories)
export const sampleOrderRepositories=createSampleOrderRepositories()
export const sampleOrderApp=new OrderApplication({tenants:sampleRepositories.tenants,customers:sampleRepositories.customers,opportunities:sampleRepositories.opportunities,activities:sampleRepositories.activities,...sampleOrderRepositories})
export const sampleAutomationRepositories=createSampleAutomationRepositories()
export const sampleAutomationApp=new AutomationApplication(sampleAutomationRepositories)
export const sampleGanoBotRepositories=createMemoryGanoBotRepositories()
export const sampleGanoBotApp=new GanoBotApplication(sampleCommercialApp,sampleOrderApp,sampleOrderRepositories.commerce,sampleGanoBotRepositories.sessions,sampleGanoBotRepositories.traces)
