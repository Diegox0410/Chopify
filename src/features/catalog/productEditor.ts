import type { ProductImage } from '../../domain/commerce'

export interface EditableImage {
  url: string
  alt: string
}

export const cleanImages = (images: readonly EditableImage[]): ProductImage[] =>
  images
    .map(image => ({ url: image.url.trim(), alt: image.alt.trim() }))
    .filter(image => image.url.length > 0)

export const moveImage = <T>(items: readonly T[], index: number, direction: -1 | 1): T[] => {
  const target = index + direction
  if (target < 0 || target >= items.length) return [...items]
  const next = [...items]
  ;[next[index], next[target]] = [next[target], next[index]]
  return next
}

export const productSlug = (name: string, explicitSlug: string, editing: boolean) => {
  const normalized = (value: string) => value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return explicitSlug.trim() ? normalized(explicitSlug) : editing ? '' : normalized(name)
}
