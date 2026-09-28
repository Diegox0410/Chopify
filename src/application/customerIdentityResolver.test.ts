import {
  describe,
  expect,
  it,
} from 'vitest'

import {
  createSampleRepositories,
} from '../adapters/memory/commercialRepositories'

import {
  CustomerIdentityResolver,
} from './customerIdentityResolver'

const now = () =>
  '2026-09-28T20:00:00.000Z'

describe(
  'H6 Customer Identity Resolver',
  () => {
    it(
      'resolves an existing WhatsApp identity without duplicating customer',
      async () => {
        const repos =
          createSampleRepositories()

        const resolver =
          new CustomerIdentityResolver(
            repos,
            now,
          )

        const result =
          await resolver.resolve({
            tenantId:
              'tenant-mg',

            channel:
              'WHATSAPP',

            externalIdentifier:
              '300 555 0101',
          })

        expect(
          result.customer.id,
        ).toBe('cus-mg-1')

        expect(
          result.createdCustomer,
        ).toBe(false)

        expect(
          result.createdIdentity,
        ).toBe(false)
      },
    )

    it(
      'creates a new customer and identity when no match exists',
      async () => {
        const repos =
          createSampleRepositories()

        const resolver =
          new CustomerIdentityResolver(
            repos,
            now,
          )

        const result =
          await resolver.resolve({
            tenantId:
              'tenant-floes',

            channel:
              'INSTAGRAM',

            externalIdentifier:
              '@NuevaCliente',

            name:
              'Nueva Cliente',
          })

        expect(
          result.createdCustomer,
        ).toBe(true)

        expect(
          result.createdIdentity,
        ).toBe(true)

        expect(
          result.identity.externalIdentifier,
        ).toBe('@nuevacliente')
      },
    )

    it(
      'links a new channel identity to an existing customer by normalized phone',
      async () => {
        const repos =
          createSampleRepositories()

        await repos.customers.save(
          'tenant-mg',
          {
            id:
              'cus-h6-phone',

            tenantId:
              'tenant-mg',

            name:
              'Cliente H6',

            phone:
              '+593 99 123 4567',

            status:
              'LEAD',

            acquisitionSource:
              'WHATSAPP',

            createdAt:
              now(),

            updatedAt:
              now(),

            lastInteractionAt:
              now(),
          },
        )

        const resolver =
          new CustomerIdentityResolver(
            repos,
            now,
          )

        const result =
          await resolver.resolve({
            tenantId:
              'tenant-mg',

            channel:
              'WEB',

            externalIdentifier:
              'session-h6-123',

            phone:
              '+593-99-123-4567',
          })

        expect(
          result.customer.id,
        ).toBe(
          'cus-h6-phone',
        )

        expect(
          result.createdCustomer,
        ).toBe(false)

        expect(
          result.createdIdentity,
        ).toBe(true)

        expect(
          result.identity.customerId,
        ).toBe(
          'cus-h6-phone',
        )

        expect(
          result.identity.channel,
        ).toBe('WEB')
      },
    )

    it(
      'keeps the same external identity isolated by tenant',
      async () => {
        const repos =
          createSampleRepositories()

        const resolver =
          new CustomerIdentityResolver(
            repos,
            now,
          )

        const mg =
          await resolver.resolve({
            tenantId:
              'tenant-mg',

            channel:
              'WHATSAPP',

            externalIdentifier:
              '3005550101',
          })

        const dgng =
          await resolver.resolve({
            tenantId:
              'tenant-dgng',

            channel:
              'WHATSAPP',

            externalIdentifier:
              '3005550101',
          })

        expect(
          mg.customer.id,
        ).not.toBe(
          dgng.customer.id,
        )

        expect(
          mg.customer.tenantId,
        ).toBe(
          'tenant-mg',
        )

        expect(
          dgng.customer.tenantId,
        ).toBe(
          'tenant-dgng',
        )
      },
    )
  },
)