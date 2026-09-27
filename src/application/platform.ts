import { sampleTenants } from '../data/sample'
import {
  sampleCampaigns,
  sampleContent,
  sampleProfiles,
  sampleSettlements,
  sampleUsers,
} from '../data/sample/platform'
import { sampleOrders } from '../data/sample/orders'
import {
  calculateManagementFee,
  calculateManagedRevenue,
  calculateSettlementTotal,
  type ContentItem,
  type Order,
  type Settlement,
} from '../domain'

const tenantIds = [
  'tenant-mg',
  'tenant-dgng',
  'tenant-floes',
] as const

const scopeFilter = <T extends { tenantId: string }>(
  items: readonly T[],
  scope: string,
) => {
  if (scope === 'ALL') {
    return items
  }

  return items.filter(
    (item) => item.tenantId === scope,
  )
}

type ManagedOrder = Order & {
  commercialAgreementSnapshot: NonNullable<
    Order['commercialAgreementSnapshot']
  >
}

const isManagedBillableOrder = (
  order: Order,
): order is ManagedOrder => {
  return (
    order.paymentStatus === 'PAID' &&
    order.attributionSnapshot.managed === true &&
    order.commercialAgreementSnapshot !== undefined
  )
}

export class PlatformApplication {
  async businesses() {
    return sampleTenants.map((tenant) => ({
      ...tenant,
      profile: sampleProfiles.find(
        (profile) =>
          profile.tenantId === tenant.id,
      ),
      users: sampleUsers.filter(
        (user) =>
          user.tenantId === tenant.id,
      ).length,
      orders: sampleOrders.filter(
        (order) =>
          order.tenantId === tenant.id,
      ).length,
    }))
  }

  async users(scope: string) {
    return scopeFilter(
      sampleUsers,
      scope,
    )
  }

  async content(scope: string) {
    return scopeFilter(
      sampleContent,
      scope,
    )
  }

  async campaigns(scope: string) {
    return scopeFilter(
      sampleCampaigns,
      scope,
    )
  }

  async settlements(scope: string) {
    return scopeFilter(
      sampleSettlements,
      scope,
    )
  }

  async managedSales(scope: string) {
    return scopeFilter(
      sampleOrders,
      scope,
    )
      .filter(isManagedBillableOrder)
      .map((order) => {
        const revenue =
          calculateManagedRevenue(order)

        const rate =
          order.commercialAgreementSnapshot
            .managedOrderRateBps

        const fee =
          calculateManagementFee(
            revenue,
            rate,
          )

        return {
          tenantId: order.tenantId,
          orderId: order.id,
          revenue,
          fee,
          rate,
        }
      })
  }

  async financeSummary(scope: string) {
    const sales =
      await this.managedSales(scope)

    const settlements =
      await this.settlements(scope)

    return {
      managedRevenue: sales.reduce(
        (sum, sale) =>
          sum + sale.revenue,
        0,
      ),

      fees: sales.reduce(
        (sum, sale) =>
          sum + sale.fee,
        0,
      ),

      settlementTotal:
        settlements.reduce(
          (sum, settlement) =>
            sum +
            calculateSettlementTotal(
              settlement.lines,
            ),
          0,
        ),

      salesCount: sales.length,
    }
  }

  async contentSummary(scope: string) {
    const items =
      await this.content(scope)

    return {
      draft: items.filter(
        (item) =>
          item.status === 'DRAFT',
      ).length,

      scheduled: items.filter(
        (item) =>
          item.status === 'SCHEDULED',
      ).length,

      published: items.filter(
        (item) =>
          item.status === 'PUBLISHED',
      ).length,

      total: items.length,
    }
  }
}

export const samplePlatformApp =
  new PlatformApplication()

export type PlatformContent =
  ContentItem

export type PlatformSettlement =
  Settlement

export { tenantIds }