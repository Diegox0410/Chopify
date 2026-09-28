import {
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import {
  createSampleRepositories,
} from '../adapters/memory/commercialRepositories'

import {
  createSampleOrderRepositories,
} from '../adapters/memory/orderRepositories'

import {
  CommercialApplication,
} from './commercial'

import {
  OrderApplication,
} from './orders'

import {
  CommerceGateway,
} from './commerceGateway'

import {
  SupervisorApplication,
} from './supervisor'

let gateway: CommerceGateway

beforeEach(() => {
  const c =
    createSampleRepositories()

  const o =
    createSampleOrderRepositories()

  const now = () =>
    '2026-09-28T18:00:00.000Z'

  const commercial =
    new CommercialApplication(
      c,
      now,
    )

  const orders =
    new OrderApplication(
      {
        tenants: c.tenants,
        customers: c.customers,
        opportunities:
          c.opportunities,
        activities:
          c.activities,
        ...o,
      },
      now,
    )

  const supervisor =
    new SupervisorApplication(
      {
        ...c,
        orders: o.orders,
        proofs: o.proofs,
      },
      now,
    )

  gateway =
    new CommerceGateway(
      commercial,
      orders,
      o.commerce,
      supervisor,
    )
})

describe(
  'Commerce Gateway H3',
  () => {
    it(
      'isolates catalog by tenant',
      async () => {
        const floes =
          await gateway.execute({
            operation:
              'searchProducts',

            tenantId:
              'tenant-floes',

            input: {
              query: '',
            },
          }) as Array<{
            productId: string
          }>

        expect(
          floes.length,
        ).toBeGreaterThan(0)

        expect(
          floes.every(
            (item) =>
              item.productId.startsWith(
                'fl-',
              ),
          ),
        ).toBe(true)
      },
    )

    it(
      'creates order and keeps it unpaid',
      async () => {
        const result =
          await gateway.execute({
            operation:
              'createOrderDraft',

            tenantId:
              'tenant-floes',

            input: {
              customerId:
                'cus-fl-1',

              lines: [
                {
                  productId:
                    'fl-mto-1',

                  quantity: 1,
                },
              ],
            },

            idempotencyKey:
              'h3-order-1',
          }) as {
            orderId: string
          }

        const status =
          await gateway.execute({
            operation:
              'getOrderStatus',

            tenantId:
              'tenant-floes',

            input: {
              orderId:
                result.orderId,
            },
          }) as {
            paymentStatus: string
          }

        expect(
          status.paymentStatus,
        ).toBe('unpaid')
      },
    )

    it(
      'payment proof is pending review, never paid',
      async () => {
        const result =
          await gateway.execute({
            operation:
              'createOrderDraft',

            tenantId:
              'tenant-mg',

            input: {
              customerId:
                'cus-mg-1',

              lines: [
                {
                  productId:
                    'mg-stock-1',

                  quantity: 1,
                },
              ],
            },

            idempotencyKey:
              'h3-order-2',
          }) as {
            orderId: string
          }

        const proof =
          await gateway.execute({
            operation:
              'attachPaymentProof',

            tenantId:
              'tenant-mg',

            input: {
              orderId:
                result.orderId,

              proofUrl:
                'sample://proof/h3',
            },

            idempotencyKey:
              'h3-proof-1',
          }) as {
            status: string
          }

        expect(
          proof.status,
        ).toBe(
          'pending_review',
        )

        const status =
          await gateway.execute({
            operation:
              'getOrderStatus',

            tenantId:
              'tenant-mg',

            input: {
              orderId:
                result.orderId,
            },
          }) as {
            paymentStatus: string
          }

        expect(
          status.paymentStatus,
        ).toBe(
          'pending_review',
        )
      },
    )
  },
)