/// <reference types="node" />
import { createSign } from 'node:crypto'
import { CommerceStateConflictError, migrateCommerceState, type CommerceRuntimeState, type CommerceStateRecord, type CommerceStateStore } from '../application/commerceRuntime.js'
import { upstreamResponseError } from '../../api/_lib/upstreamError.js'
interface ServiceAccount {project_id:string;client_email:string;private_key:string}
const JSON_HEADERS={'Content-Type':'application/json'}
const must=(env:NodeJS.ProcessEnv,key:string)=>{const value=env[key]?.trim();if(!value)throw new Error(`Missing server environment variable: ${key}`);return value}
function account(env:NodeJS.ProcessEnv):ServiceAccount{const parsed=JSON.parse(must(env,'FIREBASE_SERVICE_ACCOUNT_JSON')) as Partial<ServiceAccount>;if(!parsed.project_id||!parsed.client_email||!parsed.private_key)throw new Error('Invalid Firebase service account JSON');return parsed as ServiceAccount}
let cached:{key:string;value:string;expires:number}|null=null
async function accessToken(env:NodeJS.ProcessEnv){const a=account(env);const key=`${a.project_id}:${a.client_email}`;if(cached?.key===key&&cached.expires>Date.now()+120000)return cached.value;const epoch=Math.floor(Date.now()/1000);const b64=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString('base64url');const data=`${b64({alg:'RS256',typ:'JWT'})}.${b64({iss:a.client_email,sub:a.client_email,aud:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/datastore',iat:epoch,exp:epoch+3600})}`;const sign=createSign('RSA-SHA256');sign.update(data);sign.end();const assertion=`${data}.${sign.sign(a.private_key,'base64url')}`;const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})});if(!response.ok)throw new Error(`Firebase OAuth failed (${response.status})`);const body=await response.json() as {access_token?:string;expires_in?:number};if(!body.access_token)throw new Error('Firebase OAuth returned no access token');cached={key,value:body.access_token,expires:Date.now()+Number(body.expires_in??3600)*1000};return cached.value}
export class FirestoreCommerceStateStore implements CommerceStateStore {
 private readonly collection:string
 constructor(private readonly env:NodeJS.ProcessEnv=process.env){this.collection=env.CHOPIFY_COMMERCE_STATE_COLLECTION?.trim()||'chopifyCommerceRuntime'}
 private emulatorBase(){
  const host=this.env.FIRESTORE_EMULATOR_HOST?.trim()
  if(!host)return null
  if(!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))throw new Error('Firestore emulator host must be loopback-only')
  const projectId=this.env.FIREBASE_PROJECT_ID?.trim()||this.env.GCLOUD_PROJECT?.trim()||'demo-floes-sandbox'
  if(!projectId.startsWith('demo-'))throw new Error('Firestore emulator requires a demo project id')
  return `http://${host}/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/${encodeURIComponent(this.collection)}`
 }
 private base(){const emulator=this.emulatorBase();if(emulator)return emulator;const a=account(this.env);return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(a.project_id)}/databases/(default)/documents/${encodeURIComponent(this.collection)}`}
 private async request(url:string,init:RequestInit={}){const emulator=Boolean(this.env.FIRESTORE_EMULATOR_HOST?.trim());return fetch(url,{...init,signal:init.signal??AbortSignal.timeout(10_000),headers:{...(emulator?{Authorization:'Bearer owner'}:{Authorization:`Bearer ${await accessToken(this.env)}`}),...JSON_HEADERS,...(init.headers??{})}})}
 async load(tenantId:string):Promise<CommerceStateRecord|null>{const response=await this.request(`${this.base()}/${encodeURIComponent(tenantId)}`);if(response.status===404)return null;if(!response.ok)throw await upstreamResponseError(response,{service:'firestore',operation:'commerce_state_read'});const doc=await response.json() as {updateTime?:string;fields?:{stateJson?:{stringValue?:string}}};const json=doc.fields?.stateJson?.stringValue;if(!json)throw new Error('Commerce state document is invalid');const raw=JSON.parse(json) as {schemaVersion?:number;orders?:{products?:unknown}};return{state:migrateCommerceState(tenantId,raw),version:doc.updateTime??null,migrated:raw.schemaVersion!==3||!Array.isArray(raw.orders?.products)}}
 async save(tenantId:string,state:CommerceRuntimeState,expectedVersion:string|null){
  const fields={stateJson:{stringValue:JSON.stringify(state)},schemaVersion:{integerValue:'3'},tenantId:{stringValue:tenantId},updatedAt:{timestampValue:new Date().toISOString()}}
  let response:Response
  if(expectedVersion===null){
   response=await this.request(`${this.base()}?documentId=${encodeURIComponent(tenantId)}`,{method:'POST',body:JSON.stringify({fields})})
  }else{
   const collectionPath=`/documents/${encodeURIComponent(this.collection)}`
   const apiRoot=this.base().slice(0,-collectionPath.length)
   const documentName=`${new URL(apiRoot).pathname.replace(/^\/v1\//,'')}${collectionPath}/${encodeURIComponent(tenantId)}`
   response=await this.request(`${apiRoot}/documents:commit`,{method:'POST',body:JSON.stringify({writes:[{update:{name:documentName,fields},currentDocument:{updateTime:expectedVersion}}]})})
  }
  if(!response.ok){
   if(response.status===409||response.status===412)throw new CommerceStateConflictError()
   const error=await response.clone().json().catch(()=>null) as {error?:{status?:string}}|null
   if(error?.error?.status==='FAILED_PRECONDITION'||error?.error?.status==='ABORTED')throw new CommerceStateConflictError()
   throw new Error(`Commerce state write failed (${response.status})`)
  }
  const body=await response.json() as {updateTime?:string;writeResults?:Array<{updateTime?:string}>}
  const version=expectedVersion===null?body.updateTime:body.writeResults?.[0]?.updateTime
  if(!version)throw new Error('Commerce state write returned no version')
  return version
 }
}
