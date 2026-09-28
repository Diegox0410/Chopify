import type { Customer, CustomerIdentity, CustomerIdentityChannel } from '../domain'
import type { CustomerIdentityRepository, CustomerRepository, TenantRepository } from '../repositories/contracts'

export interface CustomerIdentityResolverRepositories {
  tenants: TenantRepository
  customers: CustomerRepository
  identities: CustomerIdentityRepository
}

export interface ResolveCustomerIdentityInput {
  tenantId: string
  channel: CustomerIdentityChannel
  externalIdentifier: string
  name?: string
  phone?: string
  email?: string
  acquisitionSource?: string
}

export interface ResolveCustomerIdentityResult {
  customer: Customer
  identity: CustomerIdentity
  createdCustomer: boolean
  createdIdentity: boolean
}

const clean=(value?:string)=>value?.trim()||undefined
const normalizeExternal=(channel:CustomerIdentityChannel,value:string)=>{
  const trimmed=value.trim()
  if(!trimmed)throw new Error('externalIdentifier is required')
  if(channel==='WHATSAPP'){
    const digits=trimmed.replace(/\D/g,'')
    if(!digits)throw new Error('WhatsApp externalIdentifier must contain digits')
    return digits
  }
  return trimmed.toLocaleLowerCase()
}

export class CustomerIdentityResolver {
  private sequence=0
  constructor(
    private readonly repositories:CustomerIdentityResolverRepositories,
    private readonly clock:()=>string=()=>new Date().toISOString(),
  ){}
  private id(prefix:string){this.sequence+=1;const uuid=globalThis.crypto?.randomUUID?.();return uuid?`${prefix}-${uuid}`:`${prefix}-${Date.now()}-${this.sequence}`}
  private async requireTenant(tenantId:string){if(!await this.repositories.tenants.getById(tenantId))throw new Error('Unknown tenant')}

  async resolve(input:ResolveCustomerIdentityInput):Promise<ResolveCustomerIdentityResult>{
    await this.requireTenant(input.tenantId)
    const externalIdentifier=normalizeExternal(input.channel,input.externalIdentifier)
    const existingIdentity=await this.repositories.identities.resolve(input.tenantId,input.channel,externalIdentifier)
    if(existingIdentity){
      const customer=await this.repositories.customers.getById(input.tenantId,existingIdentity.customerId)
      if(!customer)throw new Error('Customer identity points to a missing customer')
      return {customer,identity:existingIdentity,createdCustomer:false,createdIdentity:false}
    }

    const now=this.clock()
    const phone=clean(input.phone)
    const email=clean(input.email)?.toLocaleLowerCase()
    const candidates=await this.repositories.customers.listByTenant(input.tenantId)
    const matched=candidates.find(item=>
      (!!phone&&item.phone?.replace(/\D/g,'')===phone.replace(/\D/g,''))||
      (!!email&&item.email?.trim().toLocaleLowerCase()===email)
    )

    const customer:Customer=matched??{
      id:this.id('customer'),
      tenantId:input.tenantId,
      name:clean(input.name)??phone??email??`${input.channel} ${externalIdentifier}`,
      phone,
      email,
      status:'LEAD',
      acquisitionSource:clean(input.acquisitionSource)??input.channel,
      createdAt:now,
      updatedAt:now,
      lastInteractionAt:now,
    }
    if(!matched)await this.repositories.customers.save(input.tenantId,customer)

    const identity:CustomerIdentity={
      id:this.id('identity'),
      tenantId:input.tenantId,
      customerId:customer.id,
      channel:input.channel,
      externalIdentifier,
      createdAt:now,
      updatedAt:now,
    }
    await this.repositories.identities.save(input.tenantId,identity)
    return {customer,identity,createdCustomer:!matched,createdIdentity:true}
  }
}
