import type {
  ActorContext,
  AutomationAction,
  AutomationDefinition,
  AutomationEvent,
  AutomationExecution,
  OutboxEvent,
  OutboxPayload,
} from '../domain'

import {
  completeOutbox,
  evaluateAutomationAction,
  failOutbox,
  matchesAutomation,
  startOutbox,
} from '../domain'

import type {
  AutomationDefinitionRepository,
  AutomationEvaluationRepository,
  AutomationExecutionRepository,
  AutomationPolicyRepository,
  OutboxRepository,
} from '../repositories/automationContracts'

export interface AutomationExecutor {
  execute(event: OutboxEvent): Promise<void>
}

export class NoopAutomationExecutor implements AutomationExecutor {
  async execute() {
    // H4 validates dispatch without external channel side effects.
  }
}

export interface AutomationRepositories {
  definitions: AutomationDefinitionRepository
  policies: AutomationPolicyRepository
  evaluations: AutomationEvaluationRepository
  outbox: OutboxRepository
  executions: AutomationExecutionRepository
}

const now = () => new Date().toISOString()

const id = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const tenantAllowed = (actor: ActorContext, tenantId: string) => {
  if (actor.role !== 'PLATFORM_OWNER' && actor.tenantId !== tenantId) {
    throw new Error('Actor tenant mismatch')
  }
}

const payload = (
  event: AutomationEvent,
  action: AutomationAction,
): OutboxPayload => {
  const cfg = action.config ?? {}

  if (action.type === 'SEND_MESSAGE_REQUEST') {
    return {
      kind: 'MESSAGE_REQUEST',
      channel: String(
        event.data.channel ?? 'WHATSAPP',
      ) as 'WHATSAPP',
      customerId:
        event.customerId ?? String(event.data.customerId ?? ''),
      conversationId: event.conversationId,
      templateKey: String(cfg.templateKey ?? 'generic'),
    }
  }

  if (action.type === 'CREATE_FOLLOW_UP') {
    return {
      kind: 'FOLLOW_UP',
      customerId:
        event.customerId ?? String(event.data.customerId ?? ''),
      title: String(cfg.title ?? 'Seguimiento automático'),
    }
  }

  if (action.type === 'CREATE_REPURCHASE_OPPORTUNITY') {
    return {
      kind: 'REPURCHASE',
      customerId:
        event.customerId ?? String(event.data.customerId ?? ''),
      title: String(cfg.title ?? 'Recompra'),
    }
  }

  return {
    kind: 'ESCALATION',
    customerId: event.customerId,
    conversationId: event.conversationId,
    orderId: event.orderId,
    reason: 'OTHER',
    summary: String(
      cfg.summary ?? 'Revisión humana solicitada por automatización',
    ),
  }
}

export class AutomationApplication {
  constructor(
    private readonly repos: AutomationRepositories,
    private readonly executor: AutomationExecutor =
      new NoopAutomationExecutor(),
  ) {}

  async listDefinitions(scope: string) {
    if (scope === 'ALL') {
      return this.allTenants()
    }

    return this.repos.definitions.listByTenant(scope)
  }

  private async allTenants() {
    const tenants = [
      'tenant-mg',
      'tenant-dgng',
      'tenant-floes',
    ]

    return (
      await Promise.all(
        tenants.map((tenantId) =>
          this.repos.definitions.listByTenant(tenantId),
        ),
      )
    ).flat()
  }

  async listOutbox(scope: string) {
    if (scope === 'ALL') {
      return (
        await Promise.all(
          ['tenant-mg', 'tenant-dgng', 'tenant-floes'].map(
            (tenantId) =>
              this.repos.outbox.listByTenant(tenantId),
          ),
        )
      ).flat()
    }

    return this.repos.outbox.listByTenant(scope)
  }

  async listExecutions(scope: string) {
    if (scope === 'ALL') {
      return (
        await Promise.all(
          ['tenant-mg', 'tenant-dgng', 'tenant-floes'].map(
            (tenantId) =>
              this.repos.executions.listByTenant(tenantId),
          ),
        )
      ).flat()
    }

    return this.repos.executions.listByTenant(scope)
  }

  async getPolicy(tenantId: string) {
    return this.repos.policies.get(tenantId)
  }

  async processEvent(
    event: AutomationEvent,
    actor: ActorContext,
  ) {
    tenantAllowed(actor, event.tenantId)

    const definitions =
      await this.repos.definitions.listByTenant(event.tenantId)

    const policy =
      await this.repos.policies.get(event.tenantId)

    if (!policy) {
      throw new Error('Automation policy not configured')
    }

    const created: OutboxEvent[] = []

    for (const definition of definitions) {
      const matched = matchesAutomation(definition, event)

      await this.repos.evaluations.append(
        event.tenantId,
        {
          id: id('eval'),
          tenantId: event.tenantId,
          eventId: event.id,
          automationId: definition.id,
          matched,
          reason: matched ? 'MATCHED' : 'NOT_MATCHED',
          createdAt: now(),
        },
      )

      if (!matched) {
        continue
      }

      for (const action of definition.actions) {
        const decision = evaluateAutomationAction(
          policy,
          action.type,
        )

        if (decision !== 'ALLOWED') {
          continue
        }

        const previous =
          await this.repos.outbox.findBySourceAction(
            event.tenantId,
            event.id,
            definition.id,
            action.type,
          )

        if (previous) {
          continue
        }

        const at = now()

        const item: OutboxEvent = {
          id: id('out'),
          tenantId: event.tenantId,
          automationId: definition.id,
          sourceEventId: event.id,
          actionType: action.type,
          status: 'PENDING',
          payload: payload(event, action),
          attempts: 0,
          maxAttempts: 3,
          availableAt: at,
          createdAt: at,
          updatedAt: at,
        }

        await this.repos.outbox.save(
          event.tenantId,
          item,
        )

        created.push(item)
      }
    }

    return created
  }

  async dispatch(
    tenantId: string,
    outboxId: string,
    actor: ActorContext,
  ) {
    tenantAllowed(actor, tenantId)

    const found =
      await this.repos.outbox.getById(
        tenantId,
        outboxId,
      )

    if (!found) {
      throw new Error('Outbox event not found')
    }

    const started = startOutbox(found, now())

    await this.repos.outbox.save(
      tenantId,
      started,
    )

    const began = now()

    try {
      await this.executor.execute(started)

      const done = completeOutbox(
        started,
        now(),
      )

      await this.repos.outbox.save(
        tenantId,
        done,
      )

      const execution: AutomationExecution = {
        id: id('exec'),
        tenantId,
        outboxEventId: done.id,
        automationId: done.automationId,
        actionType: done.actionType,
        status: 'SUCCEEDED',
        attempt: done.attempts,
        startedAt: began,
        finishedAt: now(),
      }

      await this.repos.executions.append(
        tenantId,
        execution,
      )

      return done
    } catch (cause) {
      const message =
        cause instanceof Error
          ? cause.message
          : 'Executor failure'

      const failed = failOutbox(
        started,
        now(),
        message,
      )

      await this.repos.outbox.save(
        tenantId,
        failed,
      )

      await this.repos.executions.append(
        tenantId,
        {
          id: id('exec'),
          tenantId,
          outboxEventId: failed.id,
          automationId: failed.automationId,
          actionType: failed.actionType,
          status: 'FAILED',
          attempt: failed.attempts,
          startedAt: began,
          finishedAt: now(),
          error: message,
        },
      )

      return failed
    }
  }

  async runPending(
    scope: string,
    actor: ActorContext,
  ) {
    const items = await this.listOutbox(scope)

    const ready = items.filter(
      (item) =>
        item.status === 'PENDING' ||
        item.status === 'FAILED',
    )

    const result: OutboxEvent[] = []

    for (const item of ready) {
      result.push(
        await this.dispatch(
          item.tenantId,
          item.id,
          actor,
        ),
      )
    }

    return result
  }

  async toggle(
    tenantId: string,
    automationId: string,
    actor: ActorContext,
  ) {
    tenantAllowed(actor, tenantId)

    const item =
      await this.repos.definitions.getById(
        tenantId,
        automationId,
      )

    if (!item) {
      throw new Error('Automation not found')
    }

    const next: AutomationDefinition = {
      ...item,
      status:
        item.status === 'ACTIVE'
          ? 'PAUSED'
          : 'ACTIVE',
    }

    await this.repos.definitions.save(
      tenantId,
      next,
    )

    return next
  }
}