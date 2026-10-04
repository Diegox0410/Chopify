import { useCallback, useEffect, useState } from 'react'
import type { CommerceProduct } from '../../domain/commerce'
import type { FulfillmentMode } from '../../domain/inventory'
import { adminCall } from '../../services/adminApi'
import { tenantDefinitions, tenantIds } from '../../config/tenantRegistry.js'

const stores = tenantIds.map(id=>[id,tenantDefinitions[id].name] as const)
const slugify = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const money = (cents: number, currency: string) => new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(cents / 100)

export function CatalogAdminPage() {
  const [tenant, setTenant] = useState('tenant-floes')
  const [products, setProducts] = useState<readonly CommerceProduct[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const emptyDraft = { name: '', sku: '', category: '', description: '', currency: '', price: '', cost: '', images: '', fulfillmentMode: 'STOCK' as FulfillmentMode, variantSku: '', variantColor: '', variantPriceMode: 'INHERIT' as 'INHERIT'|'PENDING'|'VALUE', variantPrice: '', variantStock: '', variantImages: '', variantFulfillmentMode: '' as FulfillmentMode | '' }
  const [draft, setDraft] = useState(emptyDraft)
  const [editingProduct, setEditingProduct] = useState<CommerceProduct | null>(null)
  const [preservedVariants, setPreservedVariants] = useState<CommerceProduct['variants']>([])
  const load = useCallback(() => { setLoading(true); setError(''); void adminCall<CommerceProduct[]>('listProducts', tenant).then(setProducts).catch(cause => setError(cause instanceof Error ? cause.message : 'No fue posible cargar el catálogo')).finally(() => setLoading(false)) }, [tenant])
  useEffect(() => {
    queueMicrotask(load)
  }, [load])
  const cents = (value: string) => value.trim() ? Math.round(Number(value) * 100) : null
  async function save() {
    const slug = slugify(draft.name)
    const price = cents(draft.price)
    const cost = cents(draft.cost)

    const selectedCurrency = draft.currency.trim().toUpperCase()
    if (!slug || !draft.sku.trim()) return setError('Nombre y SKU son obligatorios.')
    if (!/^[A-Z]{3}$/.test(selectedCurrency)) return setError('Selecciona explícitamente una moneda ISO de tres letras.')
    if ([price, cost].some(value => value !== null && (!Number.isFinite(value) || value < 0))) {
      return setError('Precio y costo deben ser positivos o quedar vacíos.')
    }

    const preserveImages = (
      value: string,
      existing: CommerceProduct['images'],
      fallbackAlt: string,
    ) => value
      .split('\n')
      .map(url => url.trim())
      .filter(Boolean)
      .map(url => {
        const previous = existing.find(image => image.url === url)
        return previous ?? { url, alt: fallbackAlt }
      })

    const images = preserveImages(
      draft.images,
      editingProduct?.images ?? [],
      draft.name.trim(),
    )

    const variantPrice = cents(draft.variantPrice)
    const variantStock = draft.variantStock.trim()
      ? Number(draft.variantStock)
      : null

    if (
      draft.variantPriceMode === 'VALUE' &&
      (variantPrice === null || !Number.isFinite(variantPrice) || variantPrice <= 0)
    ) {
      return setError('El precio de variante debe ser positivo o quedar vacío para heredar.')
    }

    if (
      draft.variantSku &&
      variantStock !== null &&
      (!Number.isInteger(variantStock) || variantStock < 0)
    ) {
      return setError('El stock de variante debe ser entero positivo o quedar vacío.')
    }

    const productId = editingProduct?.id ?? `${tenant}:${slug}`
    const originalVariant = editingProduct?.variants[0]

    const editedFirstVariant = draft.variantSku.trim()
      ? {
          ...(originalVariant ?? {}),
          id: originalVariant?.id ?? `${productId}:${slugify(draft.variantSku)}`,
          sku: draft.variantSku.trim(),
          color: draft.variantColor.trim() || null,
          status: originalVariant?.status ?? 'ACTIVE' as const,
          visibility: originalVariant?.visibility ?? 'VISIBLE' as const,
          images: preserveImages(
            draft.variantImages,
            originalVariant?.images ?? [],
            draft.name.trim(),
          ),
          stock: variantStock,
          fulfillmentMode: draft.variantFulfillmentMode || undefined,
          salePriceCents: draft.variantPriceMode === 'INHERIT' ? undefined : draft.variantPriceMode === 'PENDING' ? null : variantPrice,
        }
      : originalVariant

    const variants = [
      ...(editedFirstVariant ? [editedFirstVariant] : []),
      ...preservedVariants,
    ]

    const product: CommerceProduct = editingProduct
      ? {
          ...editingProduct,
          tenantId: tenant,
          sku: draft.sku.trim(),
          slug,
          name: draft.name.trim(),
          description: draft.description.trim(),
          category: draft.category.trim() || 'Sin categoría',
          pricingStatus: price === null ? 'PENDING' : 'READY',
          costCents: cost,
          salePriceCents: price,
          currency: selectedCurrency,
          fulfillmentMode: draft.fulfillmentMode,
          images,
          variants,
        }
      : {
          id: productId,
          tenantId: tenant,
          sku: draft.sku.trim(),
          slug,
          name: draft.name.trim(),
          description: draft.description.trim(),
          commercialSummary: '',
          category: draft.category.trim() || 'Sin categoría',
          status: 'ACTIVE',
          visibility: 'VISIBLE',
          pricingStatus: price === null ? 'PENDING' : 'READY',
          costCents: cost,
          percentage: null,
          percentageType: null,
          salePriceCents: price,
          currency: selectedCurrency,
          fulfillmentMode: draft.fulfillmentMode,
          images,
          variants,
        }

    setError('')

    try {
      await adminCall('updateProduct', tenant, { product }, crypto.randomUUID())
      setDraft(emptyDraft)
      setEditingProduct(null)
      setPreservedVariants([])
      load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar el producto')
    }
  }

  function edit(product: CommerceProduct) {
    const variant = product.variants[0]
    setEditingProduct(product)
    setPreservedVariants(product.variants.slice(1))
    setDraft({
      name: product.name, sku: product.sku, category: product.category, description: product.description, currency: product.currency,
      price: product.salePriceCents === null ? '' : String(product.salePriceCents / 100),
      cost: product.costCents === null ? '' : String(product.costCents / 100), images: product.images.map(image => image.url).join('\n'),
      fulfillmentMode: product.fulfillmentMode, variantSku: variant?.sku ?? '', variantColor: variant?.color ?? '',
      variantPriceMode: variant?.salePriceCents === undefined ? 'INHERIT' : variant.salePriceCents === null ? 'PENDING' : 'VALUE',
      variantPrice: variant?.salePriceCents == null ? '' : String(variant.salePriceCents / 100),
      variantStock: variant?.stock === null || variant?.stock === undefined ? '' : String(variant.stock),
      variantImages: variant?.images.map(image => image.url).join('\n') ?? '', variantFulfillmentMode: variant?.fulfillmentMode ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  return <main className="page"><div className="page-heading"><div><span className="eyebrow">Product Center · datos persistidos</span><h1>Productos</h1><p>Precio, costo y stock desconocidos permanecen desconocidos. Las imágenes se administran como URLs; el upload binario requiere un proveedor de storage.</p></div><label className="field compact-field"><span>Negocio</span><select value={tenant} onChange={event => {
    setDraft(emptyDraft)
    setEditingProduct(null)
    setPreservedVariants([])
    setTenant(event.target.value as typeof tenant)
  }}>{stores.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label></div>
    <section className="panel catalog-editor"><h2>Registrar producto</h2><div className="catalog-form">{(['name', 'sku', 'category', 'description', 'currency', 'price', 'cost'] as const).map(field => <label key={field}>{({ name: 'Nombre', sku: 'SKU', category: 'Categoría', description: 'Descripción', currency: 'Moneda ISO (obligatoria)', price: 'Precio (opcional)', cost: 'Costo (opcional)' })[field]}<input value={draft[field]} maxLength={field==='currency'?3:undefined} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} /></label>)}<label>Fulfillment<select value={draft.fulfillmentMode} onChange={event => setDraft(current => ({ ...current, fulfillmentMode: event.target.value as FulfillmentMode }))}>{['STOCK', 'MADE_TO_ORDER', 'HYBRID', 'SERVICE', 'DIGITAL'].map(mode => <option key={mode}>{mode}</option>)}</select></label><label>URLs de imágenes (una por línea)<textarea value={draft.images} onChange={event => setDraft(current => ({ ...current, images: event.target.value }))} /></label><h3>Variante opcional</h3>{(['variantSku', 'variantColor', 'variantStock'] as const).map(field => <label key={field}>{({ variantSku: 'SKU variante', variantColor: 'Color', variantStock: 'Stock (vacío = desconocido)' })[field]}<input value={draft[field]} onChange={event => setDraft(current => ({ ...current, [field]: event.target.value }))} /></label>)}<label>Semántica de precio de variante<select value={draft.variantPriceMode} onChange={event=>setDraft(current=>({...current,variantPriceMode:event.target.value as typeof current.variantPriceMode}))}><option value="INHERIT">Heredar precio del producto</option><option value="PENDING">Precio pendiente explícito</option><option value="VALUE">Precio definido</option></select></label>{draft.variantPriceMode==='VALUE'&&<label>Precio de variante<input value={draft.variantPrice} onChange={event=>setDraft(current=>({...current,variantPrice:event.target.value}))}/></label>}<label>Fulfillment de variante<select value={draft.variantFulfillmentMode} onChange={event => setDraft(current => ({ ...current, variantFulfillmentMode: event.target.value as FulfillmentMode | '' }))}><option value="">Heredar producto</option>{['STOCK', 'MADE_TO_ORDER', 'HYBRID', 'SERVICE', 'DIGITAL'].map(mode => <option key={mode}>{mode}</option>)}</select></label><label>URLs de variante (una por línea)<textarea value={draft.variantImages} onChange={event => setDraft(current => ({ ...current, variantImages: event.target.value }))} /></label><button className="primary-button" onClick={() => void save()} disabled={!draft.name || !draft.sku || !draft.currency}>Guardar producto</button></div></section>
    {error && <div className="error-banner">{error}</div>}{!loading && products.length === 0 ? <div className="commercial-empty"><strong>Sin productos reales</strong><p>Este negocio aún no tiene productos persistidos.</p></div> : <section className="catalog-product-grid">{products.map(product => <article className="catalog-product panel" key={product.id}><div><small>{product.sku}</small><h2>{product.name}</h2><p>{product.category}</p><strong className="pending-price">{product.salePriceCents === null ? 'Precio pendiente' : money(product.salePriceCents, product.currency)}</strong><span>Costo: {product.costCents === null ? 'No disponible' : money(product.costCents, product.currency)}</span><span>{product.fulfillmentMode} · {product.variants.length} variantes · {product.images.length} imágenes</span><button className="secondary-button" onClick={() => edit(product)}>Editar</button></div></article>)}</section>}
  </main>
}
