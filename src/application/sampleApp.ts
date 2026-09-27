import { createSampleRepositories } from '../adapters/memory/commercialRepositories'
import { CommercialApplication } from './commercial'

export const sampleRepositories = createSampleRepositories()
export const sampleCommercialApp = new CommercialApplication(sampleRepositories)
