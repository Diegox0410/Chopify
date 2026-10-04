import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CommerceProduct, CommerceProductVariant } from '../../domain/commerce'
import type { FulfillmentMode } from '../../domain/inventory'
import { adminCall } from '../../services/adminApi'
import { tenantDefinitions, tenantIds } from '../../config/tenantRegistry.js'

const stores = tenantIds.map(id => [id, tenantDefinitions[id].name] as const)

type VariantPriceMode = 'INHERIT' | 'PENDING' | 'VALUE'

interface VariantDraft {
  localId: string
  id?: string
  sku: string
  color: string
  stock: string
  priceMode: VariantPriceMode
  price: string
  fulfillmentMode: FulfillmentMode | ''
  images: string
  status: CommerceProduct['status']
  visibility: CommerceProduct['visibility']
}

interface ProductDraft {
  name: string
  sku: string
  category: string
  description: string
  commercialSummary: string
  currency: string
  price: string
  cost: string
  images: string
  fulfillmentMode: FulfillmentMode
  status: CommerceProduct['status']
  visibility: CommerceProduct['visibility']
  variants: VariantDraft[]
}

const blankVariant = (): VariantDraft => ({
  localId: crypto.randomUUID(),
  sku: '',
  color: '',
  stock: '',
  priceMode: 'INHERIT',
  price: '',
  fulfillmentMode: '',
  images: '',
  status: 'ACTIVE',
  visibility: 'VISIBLE',
})

const emptyDraft = (): ProductDraft => ({
  name: '',
  sku: '',
  category: '',
  description: '',
  commercialSummary: '',
  currency: '',
  price: '',
  cost: '',
  images: '',
  fulfillmentMode: 'STOCK',
  status: 'ACTIVE',
  visibility: 'VISIBLE',
  variants: [],
})

const slugify = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const cents = (value: string): number | null => {
  if (!value.trim()) return null
  const amount = Number(value.replace(',', '.'))
  return Number.isFinite(amount) ? Math.round(amount * 100) : Number.NaN
}

const money = (value: number, currency: string) =>
  new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value / 100)

const imageLines = (value: string) =>
  value
    .split(/\r?\n/)
    .map(url => url.trim())
    .filter(Boolean)
    .map((url, index) => ({ url, alt: 'Imagen ' + (index + 1) }))

const productToDraft = (product: CommerceProduct): ProductDraft => ({
  name: product.name,
  sku: product.sku,
  category: product.category,
  description: product.description,
  commercialSummary: product.commercialSummary,
  currency: product.currency,
  price: product.salePriceCents === null ? '' : String(product.salePriceCents / 100),
  cost: product.costCents === null ? '' : String(product.costCents / 100),
  images: product.images.map(image => image.url).join('\n'),
  fulfillmentMode: product.fulfillmentMode,
  status: product.status,
  visibility: product.visibility,
  variants: product.variants.map(variant => ({
    localId: variant.id,
    id: variant.id,
    sku: variant.sku,
    color: variant.color ?? '',
    stock: variant.stock === null ? '' : String(variant.stock),
    priceMode:
      variant.salePriceCents === undefined
        ? 'INHERIT'
        : variant.salePriceCents === null
          ? 'PENDING'
          : 'VALUE',
    price:
      variant.salePriceCents === undefined || variant.salePriceCents === null
        ? ''
        : String(variant.salePriceCents / 100),
    fulfillmentMode: variant.fulfillmentMode ?? '',
    images: variant.images.map(image => image.url).join('\n'),
    status: variant.status,
    visibility: variant.visibility,
  })),
})

export function CatalogAdminPage() {
  const [tenant, setTenant] = useState<string>('tenant-floes')
  const [products, setProducts] = useState<readonly CommerceProduct[]>([])
  const [draft, setDraft] = useState<ProductDraft>(emptyDraft)
  const [editingProduct, setEditingProduct] = useState<CommerceProduct | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | CommerceProduct['status']>('ALL')
  const [visibilityFilter, setVisibilityFilter] = useState<'ALL' | CommerceProduct['visibility']>('ALL')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setProducts(await adminCall<CommerceProduct[]>('listProducts', tenant))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar el catálogo.')
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => {
    queueMicrotask(load)
  }, [load])

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return products.filter(product => {
      const matchesQuery =
        !normalized ||
        [product.name, product.sku, product.category, product.slug]
          .some(value => value.toLowerCase().includes(normalized))
      const matchesStatus = statusFilter === 'ALL' || product.status === statusFilter
      const matchesVisibility =
        visibilityFilter === 'ALL' || product.visibility === visibilityFilter
      return matchesQuery && matchesStatus && matchesVisibility
    })
  }, [products, query, statusFilter, visibilityFilter])

  const resetEditor = () => {
    setEditingProduct(null)
    setDraft(emptyDraft())
    setError('')
  }

  const updateVariant = (localId: string, patch: Partial<VariantDraft>) => {
    setDraft(current => ({
      ...current,
      variants: current.variants.map(variant =>
        variant.localId === localId ? { ...variant, ...patch } : variant
      ),
    }))
  }

  const removeVariant = (localId: string) => {
    setDraft(current => ({
      ...current,
      variants: current.variants.filter(variant => variant.localId !== localId),
    }))
  }

  const save = async () => {
    const selectedCurrency = draft.currency.trim().toUpperCase()
    const slug = slugify(draft.name)
    const price = cents(draft.price)
    const cost = cents(draft.cost)

    if (!draft.name.trim() || !draft.sku.trim()) {
      setError('Nombre y SKU son obligatorios.')
      return
    }

    if (!slug) {
      setError('El nombre debe permitir generar un identificador válido.')
      return
    }

    if (!/^[A-Z]{3}$/.test(selectedCurrency)) {
      setError('Selecciona explícitamente una moneda ISO de tres letras.')
      return
    }

    if (
      [price, cost].some(
        value => value !== null && (!Number.isFinite(value) || value < 0)
      )
    ) {
      setError('Precio y costo deben ser valores válidos o quedar vacíos.')
      return
    }

    if (price !== null && price <= 0) {
      setError('Cuando existe precio de venta debe ser mayor que cero.')
      return
    }

    const variantSkus = new Set<string>()
    const variants: CommerceProductVariant[] = []

    for (const variant of draft.variants) {
      const sku = variant.sku.trim()
      if (!sku) {
        setError('Toda variante debe tener SKU.')
        return
      }

      if (variantSkus.has(sku.toLowerCase())) {
        setError('El SKU de variante "' + sku + '" está repetido.')
        return
      }
      variantSkus.add(sku.toLowerCase())

      const stock = variant.stock.trim() === '' ? null : Number(variant.stock)
      if (
        stock !== null &&
        (!Number.isInteger(stock) || stock < 0)
      ) {
        setError('El stock de ' + sku + ' debe ser un entero no negativo o quedar vacío.')
        return
      }

      const variantPrice = cents(variant.price)
      if (
        variant.priceMode === 'VALUE' &&
        (variantPrice === null || !Number.isFinite(variantPrice) || variantPrice <= 0)
      ) {
        setError('El precio de ' + sku + ' debe ser mayor que cero.')
        return
      }

      const salePriceCents =
        variant.priceMode === 'INHERIT'
          ? undefined
          : variant.priceMode === 'PENDING'
            ? null
            : variantPrice

      variants.push({
        id: variant.id ?? crypto.randomUUID(),
        sku,
        color: variant.color.trim() || null,
        status: variant.status,
        visibility: variant.visibility,
        images: imageLines(variant.images),
        stock,
        ...(variant.fulfillmentMode
          ? { fulfillmentMode: variant.fulfillmentMode }
          : {}),
        ...(salePriceCents === undefined ? {} : { salePriceCents }),
      })
    }

    const product: CommerceProduct = editingProduct
      ? {
          ...editingProduct,
          tenantId: tenant,
          sku: draft.sku.trim(),
          slug,
          name: draft.name.trim(),
          description: draft.description.trim(),
          commercialSummary: draft.commercialSummary.trim(),
          category: draft.category.trim() || 'Sin categoría',
          status: draft.status,
          visibility: draft.visibility,
          fulfillmentMode: draft.fulfillmentMode,
          pricingStatus: price === null ? 'PENDING' : 'READY',
          costCents: cost,
          salePriceCents: price,
          currency: selectedCurrency,
          images: imageLines(draft.images),
          variants,
        }
      : {
          id: crypto.randomUUID(),
          tenantId: tenant,
          sku: draft.sku.trim(),
          slug,
          name: draft.name.trim(),
          description: draft.description.trim(),
          commercialSummary: draft.commercialSummary.trim(),
          category: draft.category.trim() || 'Sin categoría',
          status: draft.status,
          visibility: draft.visibility,
          fulfillmentMode: draft.fulfillmentMode,
          pricingStatus: price === null ? 'PENDING' : 'READY',
          costCents: cost,
          percentage: null,
          percentageType: null,
          salePriceCents: price,
          currency: selectedCurrency,
          images: imageLines(draft.images),
          variants,
        }

    setSaving(true)
    setError('')

    try {
      await adminCall(
        'updateProduct',
        tenant,
        { product },
        crypto.randomUUID()
      )
      resetEditor()
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar el producto.')
    } finally {
      setSaving(false)
    }
  }

  const edit = (product: CommerceProduct) => {
    setEditingProduct(product)
    setDraft(productToDraft(product))
    setError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <main className="page product-center">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Commerce · Product Center</span>
          <h1>Productos</h1>
          <p>
            Catálogo comercial persistido por negocio. Los valores desconocidos permanecen
            desconocidos y ninguna moneda, precio, costo o stock se infiere automáticamente.
          </p>
        </div>

        <div className="heading-actions">
          <label className="field compact-field">
            <span>Negocio</span>
            <select
              value={tenant}
              onChange={event => {
                setTenant(event.target.value)
                resetEditor()
              }}
            >
              {stores.map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
          </label>

          <button className="primary-button" type="button" onClick={resetEditor}>
            + Nuevo producto
          </button>
        </div>
      </div>

      <section className="panel product-editor">
        <header className="product-editor-header">
          <div>
            <span className="eyebrow">
              {editingProduct ? 'Edición' : 'Nuevo registro'}
            </span>
            <h2>{editingProduct ? editingProduct.name : 'Registrar producto'}</h2>
            <p>
              {editingProduct
                ? 'Los campos no modificados conservan la información persistida.'
                : 'Completa únicamente información comercial confirmada.'}
            </p>
          </div>

          {editingProduct && (
            <button className="secondary-button" type="button" onClick={resetEditor}>
              Cancelar edición
            </button>
          )}
        </header>

        <div className="product-form-section">
          <div className="product-section-title">
            <div>
              <span>01</span>
              <div>
                <strong>Información general</strong>
                <small>Identidad comercial y clasificación.</small>
              </div>
            </div>
          </div>

          <div className="product-form-grid">
            <label className="field">
              <span>Nombre *</span>
              <input
                value={draft.name}
                onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                placeholder="Ej. María José"
              />
            </label>

            <label className="field">
              <span>SKU *</span>
              <input
                value={draft.sku}
                onChange={event => setDraft(current => ({ ...current, sku: event.target.value }))}
                placeholder="Ej. FLO-MJ-001"
              />
            </label>

            <label className="field">
              <span>Categoría</span>
              <input
                value={draft.category}
                onChange={event => setDraft(current => ({ ...current, category: event.target.value }))}
                placeholder="Ej. Scrubs"
              />
            </label>

            <label className="field">
              <span>Fulfillment</span>
              <select
                value={draft.fulfillmentMode}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    fulfillmentMode: event.target.value as FulfillmentMode,
                  }))
                }
              >
                {['STOCK', 'MADE_TO_ORDER', 'HYBRID', 'SERVICE', 'DIGITAL'].map(mode => (
                  <option key={mode} value={mode}>{mode}</option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>Estado</span>
              <select
                value={draft.status}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    status: event.target.value as CommerceProduct['status'],
                  }))
                }
              >
                <option value="ACTIVE">Activo</option>
                <option value="DRAFT">Borrador</option>
                <option value="ARCHIVED">Archivado</option>
              </select>
            </label>

            <label className="field">
              <span>Visibilidad</span>
              <select
                value={draft.visibility}
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    visibility: event.target.value as CommerceProduct['visibility'],
                  }))
                }
              >
                <option value="VISIBLE">Visible</option>
                <option value="HIDDEN">Oculto</option>
              </select>
            </label>

            <label className="field product-wide">
              <span>Descripción</span>
              <textarea
                value={draft.description}
                onChange={event =>
                  setDraft(current => ({ ...current, description: event.target.value }))
                }
                placeholder="Descripción completa del producto"
              />
            </label>

            <label className="field product-wide">
              <span>Resumen comercial</span>
              <textarea
                value={draft.commercialSummary}
                onChange={event =>
                  setDraft(current => ({ ...current, commercialSummary: event.target.value }))
                }
                placeholder="Resumen breve para ventas y atención comercial"
              />
            </label>
          </div>
        </div>

        <div className="product-form-section">
          <div className="product-section-title">
            <div>
              <span>02</span>
              <div>
                <strong>Precio y costo</strong>
                <small>Sin inferencias. Vacío significa desconocido.</small>
              </div>
            </div>
          </div>

          <div className="product-form-grid pricing-grid">
            <label className="field">
              <span>Moneda ISO (obligatoria)</span>
              <input
                value={draft.currency}
                maxLength={3}
                autoCapitalize="characters"
                onChange={event =>
                  setDraft(current => ({
                    ...current,
                    currency: event.target.value.toUpperCase(),
                  }))
                }
                placeholder="USD"
              />
            </label>

            <label className="field">
              <span>Precio de venta</span>
              <input
                inputMode="decimal"
                value={draft.price}
                onChange={event => setDraft(current => ({ ...current, price: event.target.value }))}
                placeholder="Vacío = pendiente"
              />
            </label>

            <label className="field">
              <span>Costo</span>
              <input
                inputMode="decimal"
                value={draft.cost}
                onChange={event => setDraft(current => ({ ...current, cost: event.target.value }))}
                placeholder="Vacío = no disponible"
              />
            </label>

            <div className="product-data-rule">
              <strong>Regla de datos</strong>
              <span>
                Precio vacío = pendiente · Costo vacío = no disponible · Nunca se convierten en $0.
              </span>
            </div>
          </div>
        </div>

        <div className="product-form-section">
          <div className="product-section-title">
            <div>
              <span>03</span>
              <div>
                <strong>Imágenes</strong>
                <small>Temporalmente por URL. La carga de archivos se habilita en C2-B.</small>
              </div>
            </div>
          </div>

          <div className="media-url-editor">
            <label className="field">
              <span>URLs del producto · una por línea</span>
              <textarea
                value={draft.images}
                onChange={event => setDraft(current => ({ ...current, images: event.target.value }))}
                placeholder={'https://...\nhttps://...'}
              />
            </label>

            <div className="media-preview">
              {imageLines(draft.images).length === 0 ? (
                <div className="media-placeholder">
                  <span>Sin imágenes</span>
                  <small>Firebase Storage se conecta en C2-B.</small>
                </div>
              ) : (
                imageLines(draft.images).slice(0, 5).map(image => (
                  <img key={image.url} src={image.url} alt="" />
                ))
              )}
            </div>
          </div>
        </div>

        <div className="product-form-section">
          <div className="product-section-title variants-title">
            <div>
              <span>04</span>
              <div>
                <strong>Variantes</strong>
                <small>Color, SKU, stock, precio e imágenes independientes.</small>
              </div>
            </div>

            <button
              className="secondary-button"
              type="button"
              onClick={() =>
                setDraft(current => ({
                  ...current,
                  variants: [...current.variants, blankVariant()],
                }))
              }
            >
              + Agregar variante
            </button>
          </div>

          {draft.variants.length === 0 ? (
            <div className="variants-empty">
              <strong>Sin variantes</strong>
              <span>El producto puede existir sin variantes o puedes agregar tantas como necesites.</span>
            </div>
          ) : (
            <div className="variant-stack">
              {draft.variants.map((variant, index) => (
                <article className="variant-editor" key={variant.localId}>
                  <header>
                    <div>
                      <span>Variante {String(index + 1).padStart(2, '0')}</span>
                      <strong>{variant.sku || 'Sin SKU'}</strong>
                    </div>

                    <button
                      className="secondary-button danger"
                      type="button"
                      onClick={() => removeVariant(variant.localId)}
                    >
                      Eliminar
                    </button>
                  </header>

                  <div className="variant-grid">
                    <label className="field">
                      <span>SKU *</span>
                      <input
                        value={variant.sku}
                        onChange={event =>
                          updateVariant(variant.localId, { sku: event.target.value })
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Color</span>
                      <input
                        value={variant.color}
                        onChange={event =>
                          updateVariant(variant.localId, { color: event.target.value })
                        }
                      />
                    </label>

                    <label className="field">
                      <span>Stock</span>
                      <input
                        inputMode="numeric"
                        value={variant.stock}
                        onChange={event =>
                          updateVariant(variant.localId, { stock: event.target.value })
                        }
                        placeholder="Vacío = desconocido"
                      />
                    </label>

                    <label className="field">
                      <span>Precio variante</span>
                      <select
                        value={variant.priceMode}
                        onChange={event =>
                          updateVariant(variant.localId, {
                            priceMode: event.target.value as VariantPriceMode,
                          })
                        }
                      >
                        <option value="INHERIT">Heredar producto</option>
                        <option value="PENDING">Pendiente explícito</option>
                        <option value="VALUE">Precio propio</option>
                      </select>
                    </label>

                    {variant.priceMode === 'VALUE' && (
                      <label className="field">
                        <span>Valor</span>
                        <input
                          inputMode="decimal"
                          value={variant.price}
                          onChange={event =>
                            updateVariant(variant.localId, { price: event.target.value })
                          }
                        />
                      </label>
                    )}

                    <label className="field">
                      <span>Fulfillment</span>
                      <select
                        value={variant.fulfillmentMode}
                        onChange={event =>
                          updateVariant(variant.localId, {
                            fulfillmentMode: event.target.value as FulfillmentMode | '',
                          })
                        }
                      >
                        <option value="">Heredar producto</option>
                        {['STOCK', 'MADE_TO_ORDER', 'HYBRID', 'SERVICE', 'DIGITAL'].map(mode => (
                          <option key={mode} value={mode}>{mode}</option>
                        ))}
                      </select>
                    </label>

                    <label className="field">
                      <span>Estado</span>
                      <select
                        value={variant.status}
                        onChange={event =>
                          updateVariant(variant.localId, {
                            status: event.target.value as CommerceProduct['status'],
                          })
                        }
                      >
                        <option value="ACTIVE">Activo</option>
                        <option value="DRAFT">Borrador</option>
                        <option value="ARCHIVED">Archivado</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>Visibilidad</span>
                      <select
                        value={variant.visibility}
                        onChange={event =>
                          updateVariant(variant.localId, {
                            visibility: event.target.value as CommerceProduct['visibility'],
                          })
                        }
                      >
                        <option value="VISIBLE">Visible</option>
                        <option value="HIDDEN">Oculto</option>
                      </select>
                    </label>

                    <label className="field variant-images">
                      <span>URLs de imágenes · una por línea</span>
                      <textarea
                        value={variant.images}
                        onChange={event =>
                          updateVariant(variant.localId, { images: event.target.value })
                        }
                      />
                    </label>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        {error && <div className="error-banner">{error}</div>}

        <footer className="product-editor-footer">
          <div>
            <strong>{editingProduct ? 'Editando producto existente' : 'Nuevo producto'}</strong>
            <span>Los cambios se guardan en la fuente comercial de Chopify.</span>
          </div>

          <button
            className="primary-button"
            type="button"
            disabled={saving || !draft.name.trim() || !draft.sku.trim() || !draft.currency.trim()}
            onClick={() => void save()}
          >
            {saving ? 'Guardando…' : editingProduct ? 'Guardar cambios' : 'Crear producto'}
          </button>
        </footer>
      </section>

      <section className="product-catalog-section">
        <div className="section-heading product-list-heading">
          <div>
            <span className="eyebrow">Catálogo persistido</span>
            <h2>Productos registrados</h2>
          </div>
          <span className="product-count">{filteredProducts.length} / {products.length}</span>
        </div>

        <div className="filter-bar">
          <label className="search-field">
            <span aria-hidden="true">⌕</span>
            <span className="sr-only">Buscar productos</span>
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar por nombre, SKU, categoría o slug"
            />
          </label>

          <label className="field compact-field">
            <span>Estado</span>
            <select
              value={statusFilter}
              onChange={event =>
                setStatusFilter(event.target.value as typeof statusFilter)
              }
            >
              <option value="ALL">Todos</option>
              <option value="ACTIVE">Activos</option>
              <option value="DRAFT">Borradores</option>
              <option value="ARCHIVED">Archivados</option>
            </select>
          </label>

          <label className="field compact-field">
            <span>Visibilidad</span>
            <select
              value={visibilityFilter}
              onChange={event =>
                setVisibilityFilter(event.target.value as typeof visibilityFilter)
              }
            >
              <option value="ALL">Todas</option>
              <option value="VISIBLE">Visible</option>
              <option value="HIDDEN">Oculto</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="panel loading-state">Cargando productos…</div>
        ) : filteredProducts.length === 0 ? (
          <div className="panel commercial-empty">
            <strong>{products.length === 0 ? 'Sin productos reales' : 'Sin coincidencias'}</strong>
            <p>
              {products.length === 0
                ? 'Este negocio aún no tiene productos persistidos.'
                : 'Modifica la búsqueda o los filtros para ver otros productos.'}
            </p>
          </div>
        ) : (
          <div className="catalog-product-grid">
            {filteredProducts.map(product => {
              const cover = product.images[0]?.url ?? product.variants.flatMap(v => v.images)[0]?.url
              const knownStock = product.variants
                .map(variant => variant.stock)
                .filter((stock): stock is number => stock !== null)
              const totalStock =
                product.variants.length > 0 &&
                knownStock.length === product.variants.length
                  ? knownStock.reduce((sum, stock) => sum + stock, 0)
                  : null

              return (
                <article className="catalog-product panel" key={product.id}>
                  <div className="catalog-cover">
                    {cover ? (
                      <img src={cover} alt={product.name} />
                    ) : (
                      <div className="catalog-cover-empty">Sin imagen</div>
                    )}
                    <div className="catalog-card-badges">
                      <span className={'entity-status status-' + product.status.toLowerCase()}>
                        {product.status}
                      </span>
                      <span className="entity-status">{product.visibility}</span>
                    </div>
                  </div>

                  <div className="catalog-product-copy">
                    <small>{product.sku}</small>
                    <h2>{product.name}</h2>
                    <p>{product.category}</p>

                    <div className="catalog-price-row">
                      <div>
                        <span>Precio</span>
                        <strong className={product.salePriceCents === null ? 'pending-price' : ''}>
                          {product.salePriceCents === null
                            ? 'Pendiente'
                            : money(product.salePriceCents, product.currency)}
                        </strong>
                      </div>
                      <div>
                        <span>Costo</span>
                        <strong>
                          {product.costCents === null
                            ? 'No disponible'
                            : money(product.costCents, product.currency)}
                        </strong>
                      </div>
                    </div>

                    <div className="catalog-meta-grid">
                      <span>{product.currency}</span>
                      <span>{product.fulfillmentMode}</span>
                      <span>{product.variants.length} variantes</span>
                      <span>
                        Stock: {product.variants.length === 0
                          ? 'No aplica'
                          : totalStock === null
                            ? 'Desconocido'
                            : totalStock}
                      </span>
                    </div>

                    <button
                      className="secondary-button catalog-edit-button"
                      type="button"
                      onClick={() => edit(product)}
                    >
                      Editar producto
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>
    </main>
  )
}
