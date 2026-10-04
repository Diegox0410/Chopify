import { describe, expect, it } from 'vitest'
import { cleanImages, moveImage, productSlug } from './productEditor.js'

describe('Product Center editor helpers', () => {
  it('persists URL and alt, while dropping empty media rows', () => {
    expect(cleanImages([
      { url: ' https://cdn.example.com/front.jpg ', alt: ' Frente ' },
      { url: ' ', alt: 'fila vacía' },
    ])).toEqual([{ url: 'https://cdn.example.com/front.jpg', alt: 'Frente' }])
  })

  it('reorders and removes media without changing its content', () => {
    const images = [{ url: 'one', alt: 'Uno' }, { url: 'two', alt: 'Dos' }]
    expect(moveImage(images, 1, -1)).toEqual([images[1], images[0]])
    expect(cleanImages(moveImage(images, 1, -1).filter((_, index) => index !== 1))).toEqual([images[1]])
  })

  it('generates a slug only for creation and preserves explicit edit slugs', () => {
    expect(productSlug('María José', '', false)).toBe('maria-jose')
    expect(productSlug('Nombre nuevo', 'slug-existente', true)).toBe('slug-existente')
    expect(productSlug('Nombre nuevo', '', true)).toBe('')
  })
})
