import type { CommerceProduct } from '../../domain/index.js'

/** Production catalog data belongs to the persisted tenant catalog, never application seeds. */
export const FLOES_CATEGORIES: readonly string[] = Object.freeze([])
export const floesCatalog: readonly CommerceProduct[] = Object.freeze([])
