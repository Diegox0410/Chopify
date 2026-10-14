import type { AuditEvent, CommerceProduct, CommercialAgreement, IdempotencyRecord, IdempotentOperation, InventoryPosition, InventoryReservation, InventoryReservationItem, Order, Payment, PaymentProof } from '../../domain/index.js'
import { commitPosition, isCommerciallyVisible, normalizeInventorySize, releasePosition, reservePosition, validateCommerceProduct } from '../../domain/index.js'
import type { AgreementRepository, AuditRepository, IdempotencyRepository, InventoryRepository, InventoryReservationRepository, OrderRepository, PaymentProofRepository, PaymentRepository } from '../../repositories/contracts.js'
import type { BusinessCommerceAdapter } from '../../application/commercePort.js'
import { sampleAgreements, sampleAuditEvents, sampleIdempotency, sampleInventory, sampleOrders, samplePayments, sampleProducts, sampleProofs, sampleReservations } from '../../data/sample/orders.js'
import { floesCatalog } from '../../data/catalog/floes.js'
import { normalizeCatalogKey } from '../../application/catalogImport.js'
import { effectiveSalePrice } from '../../domain/commerce.js'

export interface SampleOrderDatabase { products: CommerceProduct[]; orders: Order[]; payments: Payment[]; proofs: PaymentProof[]; reservations: InventoryReservation[]; idempotency: IdempotencyRecord[]; inventory: InventoryPosition[]; agreements: CommercialAgreement[]; audit: AuditEvent[]; publishedOrderIds: string[] }
export const createSampleOrderDatabase = (): SampleOrderDatabase => ({
  products: [...sampleProducts, ...floesCatalog].map((item) => structuredClone(item)),
  orders: sampleOrders.map((item) => ({ ...item, items: item.items.map((line) => ({ ...line })), attributionSnapshot: { ...item.attributionSnapshot }, commercialAgreementSnapshot: item.commercialAgreementSnapshot ? { ...item.commercialAgreementSnapshot } : undefined, managedSnapshot: { ...item.managedSnapshot }, fulfillmentDetails: item.fulfillmentDetails ? { ...item.fulfillmentDetails } : undefined })),
  payments: samplePayments.map((item) => ({ ...item })),
  proofs: sampleProofs.map((item) => ({ ...item })),
  reservations: sampleReservations.map((item) => ({ ...item, items: item.items.map((line) => ({ ...line })) })),
  idempotency: sampleIdempotency.map((item) => ({ ...item })),
  inventory: sampleInventory.map((item) => ({ ...item })),
  agreements: sampleAgreements.map((item) => ({ ...item })),
  audit: sampleAuditEvents.map((item) => ({ ...item, metadata: item.metadata ? { ...item.metadata } : undefined })),
  publishedOrderIds: [],
})
const assertTenant = (tenantId: string, entity: { tenantId: string }) => { if (entity.tenantId !== tenantId) throw new Error('Cross-tenant mutation rejected') }
const upsert = <T extends { id: string }>(items: T[], entity: T) => { const index = items.findIndex((item) => item.id === entity.id); if (index < 0) items.push(entity); else items[index] = entity }
export class MemoryOrderRepository implements OrderRepository { constructor(private db: SampleOrderDatabase) {} async listByTenant(tenantId: string, filters: Parameters<OrderRepository['listByTenant']>[1] = {}) { const search = filters?.search?.toLowerCase(); return this.db.orders.filter((item) => item.tenantId === tenantId && (!filters?.orderStatus || item.orderStatus === filters.orderStatus) && (!filters?.paymentStatus || item.paymentStatus === filters.paymentStatus) && (!filters?.fulfillmentStatus || item.fulfillmentStatus === filters.fulfillmentStatus) && (filters?.managed === undefined || item.managedSnapshot.managed === filters.managed) && (!search || item.id.toLowerCase().includes(search) || item.customerId.toLowerCase().includes(search))) } async getById(tenantId: string, id: string) { return this.db.orders.find((item) => item.tenantId === tenantId && item.id === id) ?? null } async getByOpportunity(tenantId: string, opportunityId: string) { return this.db.orders.find((item) => item.tenantId === tenantId && item.opportunityId === opportunityId) ?? null } async save(tenantId: string, item: Order) { assertTenant(tenantId, item); upsert(this.db.orders, item) } }
export class MemoryPaymentRepository implements PaymentRepository { constructor(private db: SampleOrderDatabase) {} async listByTenant(tenantId: string, filters: Parameters<PaymentRepository['listByTenant']>[1] = {}) { return this.db.payments.filter((item) => item.tenantId === tenantId && (!filters?.status || item.status === filters.status)) } async getById(tenantId: string, id: string) { return this.db.payments.find((item) => item.tenantId === tenantId && item.id === id) ?? null } async getByOrder(tenantId: string, orderId: string) { return this.db.payments.find((item) => item.tenantId === tenantId && item.orderId === orderId) ?? null } async save(tenantId: string, item: Payment) { assertTenant(tenantId, item); upsert(this.db.payments, item) } }
export class MemoryProofRepository implements PaymentProofRepository { constructor(private db: SampleOrderDatabase) {} async listByTenant(tenantId: string, filters: Parameters<PaymentProofRepository['listByTenant']>[1] = {}) { return this.db.proofs.filter((item) => item.tenantId === tenantId && (!filters?.status || item.status === filters.status) && (!filters?.orderId || item.orderId === filters.orderId)) } async getById(tenantId: string, id: string) { return this.db.proofs.find((item) => item.tenantId === tenantId && item.id === id) ?? null } async save(tenantId: string, item: PaymentProof) { assertTenant(tenantId, item); upsert(this.db.proofs, item) } }
export class MemoryReservationRepository implements InventoryReservationRepository { constructor(private db: SampleOrderDatabase) {} async listByTenant(tenantId: string, filters: Parameters<InventoryReservationRepository['listByTenant']>[1] = {}) { return this.db.reservations.filter((item) => item.tenantId === tenantId && (!filters?.status || item.status === filters.status)) } async getById(tenantId: string, id: string) { return this.db.reservations.find((item) => item.tenantId === tenantId && item.id === id) ?? null } async getByOrder(tenantId: string, orderId: string) { return this.db.reservations.find((item) => item.tenantId === tenantId && item.orderId === orderId) ?? null } async save(tenantId: string, item: InventoryReservation) { assertTenant(tenantId, item); upsert(this.db.reservations, item) } }
export class MemoryIdempotencyRepository implements IdempotencyRepository { constructor(private db: SampleOrderDatabase) {} async get(tenantId: string, operation: IdempotentOperation, key: string) { return this.db.idempotency.find((item) => item.tenantId === tenantId && item.operation === operation && item.key === key) ?? null } async save(tenantId: string, item: IdempotencyRecord) { assertTenant(tenantId, item); const duplicate = await this.get(tenantId, item.operation, item.key); if (duplicate) Object.assign(duplicate, item); else this.db.idempotency.push(item) } }
export class MemoryAgreementRepository implements AgreementRepository { constructor(private db: SampleOrderDatabase) {} async getEffective(tenantId: string, at: string) { return this.db.agreements.filter((item) => item.tenantId === tenantId && item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at)).sort((a,b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0] ?? null } }
export class MemoryAuditRepository implements AuditRepository { constructor(private db: SampleOrderDatabase) {} async listByTenant(tenantId: string, filters: Parameters<AuditRepository['listByTenant']>[1] = {}) { return this.db.audit.filter((item) => item.tenantId === tenantId && (!filters?.entityType || item.entityType === filters.entityType) && (!filters?.entityId || item.entityId === filters.entityId)) } async append(tenantId: string, item: AuditEvent) { assertTenant(tenantId, item); this.db.audit.push(item) } }
export class SampleBusinessCommerceAdapter implements BusinessCommerceAdapter, InventoryRepository {
  constructor(private db: SampleOrderDatabase) {}
  async searchProducts(tenantId: string, query: string) { const normalized = normalizeCatalogKey(query).split('-').filter(Boolean); return this.db.products.filter((item) => { const haystack=normalizeCatalogKey([item.name,item.description,item.commercialSummary,item.category,item.sku,item.material,...(item.characteristics??[]),item.ganoBotNotes,...item.variants.map((v) => `${v.color ?? ''} ${v.sku}`)].join(' '));return item.tenantId === tenantId && isCommerciallyVisible(item) && normalized.every(word=>haystack.includes(word)) }).map((item) => structuredClone(item)) }
  async getProduct(tenantId: string, productId: string) { const item = this.db.products.find((entry) => entry.tenantId === tenantId && entry.id === productId && isCommerciallyVisible(entry)); return item ? structuredClone(item) : null }
   async getPrice(tenantId: string, productId: string, variantId?: string) { const item = await this.getProduct(tenantId, productId); if (!item) return null; const variant = variantId ? item.variants.find((entry) => entry.id === variantId && entry.status==='ACTIVE' && entry.visibility==='VISIBLE') : undefined; if(variantId&&!variant)return null; const priceCents = effectiveSalePrice(item,variant); return priceCents === null || !item.currency ? null : { priceCents, currency: item.currency } }
  async listProducts(tenantId: string) {
    return this.db.products.filter(item => item.tenantId === tenantId).map(item => ({
      ...structuredClone(item),
      variants: item.variants.map(variant => {
        const positions = this.db.inventory.filter(position => position.tenantId === tenantId && position.productId === item.id && position.variantId === variant.id)
        const sizePositions = positions.filter(position => position.size)
        const hasSizedConfiguration = variant.initialStockBySize !== undefined
        const stock = hasSizedConfiguration
          ? Object.values(variant.initialStockBySize ?? {}).some(value => value !== null)
            ? sizePositions.reduce((total, position) => total + position.onHand, 0)
            : null
          : positions.find(position => !position.size)?.onHand ?? variant.stock
        return { ...structuredClone(variant), stock }
      }),
    }))
  }
  async updateProductInformation(tenantId: string, products: readonly CommerceProduct[]) {
    const next=structuredClone(this.db.products)
    for (const product of products) {
      if (product.tenantId !== tenantId) throw new Error('Cross-tenant catalog mutation rejected')
      validateCommerceProduct(product)
      const index=next.findIndex(item=>item.tenantId===tenantId&&item.id===product.id)
      if(index<0)throw new Error('Informational updates require an existing product')
      const existing=next[index]
      next[index]={...existing,name:product.name,description:product.description,commercialSummary:product.commercialSummary,images:structuredClone(product.images)}
    }
    this.db.products.splice(0,this.db.products.length,...next)
    return this.listProducts(tenantId)
  }
  async upsertProducts(tenantId: string, products: readonly CommerceProduct[]) {
    const next=structuredClone(this.db.products), inventory=structuredClone(this.db.inventory)
    for (const product of products) {
      if (product.tenantId !== tenantId) throw new Error('Cross-tenant catalog mutation rejected')
      validateCommerceProduct(product)
      const index=next.findIndex(item=>item.tenantId===tenantId&&item.id===product.id), previous=index<0?undefined:next[index]
      for (const variant of product.variants) {
        const old=previous?.variants.find(item=>item.id===variant.id)
        const variantPositions=()=>inventory.filter(item=>item.tenantId===tenantId&&item.productId===product.id&&item.variantId===variant.id)
        const configuredBySize=variant.initialStockBySize ?? old?.initialStockBySize
        if(configuredBySize) {
          const normalizeMap=(map:Readonly<Record<string,number|null>>)=>{
            const normalized=new Map<string,number|null>()
            for(const [rawSize,stock] of Object.entries(map)){
              const size=normalizeInventorySize(rawSize)
              if(!size||normalized.has(size))throw new Error('Inventory sizes must be unique after normalization')
              normalized.set(size,stock)
            }
            return normalized
          }
          const incoming=normalizeMap(configuredBySize), oldMap=normalizeMap(old?.initialStockBySize??{})
          const positions=variantPositions()
          const legacy=positions.find(position=>!position.size)
          if(legacy){
            const previousBaseline=old?.importedStock??old?.stock
            const hasOperationalActivity=legacy.reserved>0||(previousBaseline!==null&&previousBaseline!==undefined&&legacy.onHand!==previousBaseline)
            if(hasOperationalActivity)throw new Error(`Legacy variant inventory requires a size migration before importing size stock: ${variant.sku}`)
            inventory.splice(inventory.indexOf(legacy),1)
          }
          for(const [size,stock] of incoming){
            const position=variantPositions().find(item=>item.size===size)
            const hadPreviousConfiguration=oldMap.has(size),previousStock=oldMap.get(size)
            if(position){
              if(hadPreviousConfiguration&&previousStock===stock)continue
              if(hadPreviousConfiguration&&(position.onHand!==previousStock||position.reserved>0))throw new Error(`Configured stock changed after inventory activity for ${variant.sku}/${size}`)
              if(!hadPreviousConfiguration&&position.onHand!==(stock??0))throw new Error(`Existing inventory needs reconciliation before configuring ${variant.sku}/${size}`)
              if(stock===null){
                if(position.onHand!==0||position.reserved!==0)throw new Error(`Cannot clear non-empty inventory for ${variant.sku}/${size}`)
                inventory.splice(inventory.indexOf(position),1)
              } else position.onHand=stock
            } else if(stock!==null) inventory.push({tenantId,productId:product.id,variantId:variant.id,size,onHand:stock,reserved:0})
          }
          for(const position of variantPositions().filter(item=>item.size&&!incoming.has(item.size))){
            const size=position.size!
            const hadPreviousConfiguration=oldMap.has(size),previousStock=oldMap.get(size)
            const hasOperationalActivity=position.reserved>0||(hadPreviousConfiguration?position.onHand!==previousStock:position.onHand!==0)
            if(hasOperationalActivity)throw new Error(`Cannot remove a size with inventory activity for ${variant.sku}/${size}`)
            inventory.splice(inventory.indexOf(position),1)
          }
        } else {
          const position=variantPositions().find(item=>!item.size)
          const sameImport=variant.importedStock!==undefined&&variant.importedStock===old?.importedStock&&variant.stock===variant.importedStock
          if(variant.stock!==null && (!position || !sameImport && variant.stock!==(position?.onHand??old?.stock))) {
            if(position && variant.stock<position.reserved)throw new Error('Stock cannot be lower than active reservations')
            if(position)position.onHand=variant.stock
            else inventory.push({tenantId,productId:product.id,variantId:variant.id,onHand:variant.stock,reserved:0})
          }
          if(variant.stock===null && old?.stock!==null && position && !sameImport) {
            if(position.reserved>0)throw new Error('Cannot clear inventory with active reservations')
            inventory.splice(inventory.indexOf(position),1)
          }
          if(old?.initialStockBySize){
            for(const sized of variantPositions().filter(item=>item.size)){
              const baseline=old.initialStockBySize[normalizeInventorySize(sized.size!)]
              if(sized.reserved>0||(baseline!==undefined&&sized.onHand!==baseline))throw new Error(`Cannot remove size inventory after activity for ${variant.sku}/${sized.size}`)
              inventory.splice(inventory.indexOf(sized),1)
            }
          }
        }
      }
      const persistedProduct=structuredClone(product)
      persistedProduct.variants=persistedProduct.variants.map(variant=>{
        const oldVariant=previous?.variants.find(item=>item.id===variant.id)
        return variant.initialStockBySize===undefined&&oldVariant?.initialStockBySize
          ? {...variant,initialStockBySize:oldVariant.initialStockBySize}
          : variant
      })
      const removed=previous?.variants.filter(old=>!product.variants.some(item=>item.id===old.id))??[]
      if(removed.some(old=>inventory.some(position=>position.tenantId===tenantId&&position.productId===product.id&&position.variantId===old.id&&(position.reserved>0||(position.size&&old.initialStockBySize?.[normalizeInventorySize(position.size)]!==position.onHand)))))throw new Error('Cannot remove a variant with inventory activity')
      if(index<0)next.push(persistedProduct);else next[index]=persistedProduct
    }
    const tenantProducts=next.filter(item=>item.tenantId===tenantId),keys=tenantProducts.flatMap(item=>[item.sku,...item.variants.map(variant=>variant.sku)]).map(sku=>sku.toUpperCase())
    if(new Set(keys).size!==keys.length)throw new Error('Product and variant SKUs must be unique within a tenant')
    if(new Set(tenantProducts.map(item=>item.slug)).size!==tenantProducts.length)throw new Error('Product slugs must be unique within a tenant')
    this.db.products.splice(0,this.db.products.length,...next);this.db.inventory.splice(0,this.db.inventory.length,...inventory)
    return this.listProducts(tenantId)
  }
  async getAvailability(tenantId: string, productId: string, variantId?: string, rawSize?: string) {
    return this.availability(tenantId, productId, variantId, rawSize)
  }
  async getPosition(tenantId: string, productId: string, variantId?: string, rawSize?: string) {
    const positions=this.db.inventory.filter(item=>item.tenantId===tenantId&&item.productId===productId&&item.variantId===variantId)
    if(rawSize)return positions.find(item=>item.size===normalizeInventorySize(rawSize))??null
    return positions.find(item=>!item.size)??positions[0]??null
  }
  private availability(tenantId: string, productId: string, variantId?: string, rawSize?: string) {
    const positions=this.db.inventory.filter(item=>item.tenantId===tenantId&&item.productId===productId&&item.variantId===variantId)
    const variant=this.db.products.find(item=>item.tenantId===tenantId&&item.id===productId)?.variants.find(item=>item.id===variantId)
    const configured=variant?.initialStockBySize
    if(rawSize){
      const size=normalizeInventorySize(rawSize),sized=positions.find(item=>item.size===size)
      if(sized)return Math.max(0,sized.onHand-sized.reserved)
      if(configured&&Object.prototype.hasOwnProperty.call(configured,size))return null
      if(positions.some(item=>item.size))return null
      // A FLOES color aggregate is never evidence of physical availability for a size.
      // Preserve legacy behavior for other tenants until their own inventory is reconciled.
      if(tenantId==='tenant-floes')return null
      const legacy=positions.find(item=>!item.size)
      return legacy?Math.max(0,legacy.onHand-legacy.reserved):null
    }
    if(configured){
      const configuredSizes=Object.entries(configured).filter(([,stock])=>stock!==null).map(([size])=>normalizeInventorySize(size))
      if(!configuredSizes.length)return null
      return configuredSizes.reduce((total,size)=>{
        const position=positions.find(item=>item.size===size)
        return total+(position?Math.max(0,position.onHand-position.reserved):0)
      },0)
    }
    const sized=positions.filter(item=>item.size)
    if(sized.length)return sized.reduce((total,item)=>total+Math.max(0,item.onHand-item.reserved),0)
    const legacy=positions.find(item=>!item.size)
    return legacy?Math.max(0,legacy.onHand-legacy.reserved):null
  }
  private async mutate(tenantId: string, items: readonly InventoryReservationItem[], change: (position: InventoryPosition, amount: number) => InventoryPosition) {
    const grouped=new Map<string,InventoryReservationItem>()
    for(const item of items){
      const size=item.size?normalizeInventorySize(item.size):undefined
      const key=JSON.stringify([item.productId,item.variantId,size])
      const previous=grouped.get(key)
      grouped.set(key,{...item,...(size?{size}:{}),quantity:item.quantity+(previous?.quantity??0)})
    }
    const positions=[...grouped.values()].map(item=>{
      const variantPositions=this.db.inventory.filter(entry=>entry.tenantId===tenantId&&entry.productId===item.productId&&entry.variantId===item.variantId)
      const position=item.size
        ? variantPositions.find(entry=>entry.size===item.size)??(!variantPositions.some(entry=>entry.size)?variantPositions.find(entry=>!entry.size):undefined)
        : variantPositions.find(entry=>!entry.size)
      if(!position)throw new Error('Inventory position not found in tenant')
      return{item,position,next:change(position,item.quantity)}
    })
    for(const {position,next} of positions)Object.assign(position,next)
    return positions.map(({next})=>next)
  }
  reserveInventory(tenantId: string, items: readonly InventoryReservationItem[]) { return this.mutate(tenantId, items, reservePosition) }
  releaseInventory(tenantId: string, items: readonly InventoryReservationItem[]) { return this.mutate(tenantId, items, releasePosition) }
  commitInventory(tenantId: string, items: readonly InventoryReservationItem[]) { return this.mutate(tenantId, items, commitPosition) }
  async publishOrderReference(tenantId: string, orderId: string) { const order = this.db.orders.find((item) => item.tenantId === tenantId && item.id === orderId); if (!order) throw new Error('Order not found in tenant'); if (!this.db.publishedOrderIds.includes(orderId)) this.db.publishedOrderIds.push(orderId) }
}
export function createSampleOrderRepositories(db = createSampleOrderDatabase()) { const commerce = new SampleBusinessCommerceAdapter(db); return { db, orders: new MemoryOrderRepository(db), payments: new MemoryPaymentRepository(db), proofs: new MemoryProofRepository(db), reservations: new MemoryReservationRepository(db), idempotency: new MemoryIdempotencyRepository(db), agreements: new MemoryAgreementRepository(db), audit: new MemoryAuditRepository(db), inventory: commerce as InventoryRepository, commerce } }
