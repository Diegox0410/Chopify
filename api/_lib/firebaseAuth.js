import { createPublicKey,verify } from 'node:crypto'

const CERTS_URL='https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'

let cachedCerts=null
let certsExpireAt=0

export class FirebaseAuthConfigurationError extends Error{
  constructor(){super('Firebase authentication is not configured');this.name='FirebaseAuthConfigurationError'}
}

export function resetFirebaseAuthCacheForTests(){
  cachedCerts=null
  certsExpireAt=0
}

const decode=value=>{
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/')
  const padded=normalized+'='.repeat((4-normalized.length%4)%4)
  return Buffer.from(padded,'base64')
}

const parse=value=>JSON.parse(decode(value).toString('utf8'))

async function certificates(){
  if(cachedCerts&&Date.now()<certsExpireAt)return cachedCerts

  const response=await fetch(CERTS_URL)
  if(!response.ok)throw new Error(`Firebase certificates unavailable (${response.status})`)

  const body=await response.json()
  const cacheControl=response.headers.get('cache-control')||''
  const maxAge=Number(cacheControl.match(/max-age=(\d+)/)?.[1]||300)

  cachedCerts=body
  certsExpireAt=Date.now()+maxAge*1000

  return body
}

export async function verifyFirebaseIdToken(authorization){
  if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')){
    return null
  }

  const token=authorization.slice(7).trim()
  const parts=token.split('.')
  if(parts.length!==3)return null

  try{
    const header=parse(parts[0])
    const payload=parse(parts[1])

    if(header.alg!=='RS256'||typeof header.kid!=='string')return null

    const projectId=process.env.CHOPIFY_FIREBASE_PROJECT_ID
    if(!projectId)throw new FirebaseAuthConfigurationError()

    const certs=await certificates()
    const cert=certs[header.kid]
    if(typeof cert!=='string')return null

    const now=Math.floor(Date.now()/1000)

    if(payload.aud!==projectId)return null
    if(payload.iss!==`https://securetoken.google.com/${projectId}`)return null
    if(typeof payload.sub!=='string'||!payload.sub||payload.sub.length>128)return null
    if(typeof payload.exp!=='number'||payload.exp<=now)return null
    if(typeof payload.iat!=='number'||payload.iat>now+300)return null
    if(payload.exp<=payload.iat||payload.exp-payload.iat>3600)return null

    const signed=Buffer.from(`${parts[0]}.${parts[1]}`)
    const signature=decode(parts[2])
    const key=createPublicKey(cert)

    if(!verify('RSA-SHA256',signed,key,signature))return null

    return {
      uid:payload.sub,
      email:typeof payload.email==='string'?payload.email:'',
      emailVerified:payload.email_verified===true,
    }
  }catch(error){
    if(error instanceof FirebaseAuthConfigurationError)throw error
    return null
  }
}

export async function requirePlatformOwner(req){
  const identity=await verifyFirebaseIdToken(req.headers?.authorization)
  if(!identity)return null

  const expected=process.env.CHOPIFY_PLATFORM_OWNER_UID
  if(!expected)throw new FirebaseAuthConfigurationError()

  return identity.uid===expected?identity:null
}

export async function authorizePlatformOwner(req){
  try{
    const identity=await verifyFirebaseIdToken(req.headers?.authorization)
    if(!identity)return{ok:false,status:401,error:'Unauthorized'}
    const expected=process.env.CHOPIFY_PLATFORM_OWNER_UID
    if(!expected)throw new FirebaseAuthConfigurationError()
    if(identity.uid!==expected)return{ok:false,status:403,error:'Forbidden'}
    return{ok:true,status:200,identity}
  }catch(error){
    if(error instanceof FirebaseAuthConfigurationError)return{ok:false,status:503,error:'Authentication service not configured'}
    throw error
  }
}
