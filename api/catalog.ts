import { PersistentCommerceRuntime } from '../src/application/commerceRuntime.js'
import { FirestoreCommerceStateStore } from '../src/infrastructure/firestoreCommerceStateStore.js'
interface Request { method?: string; query?: Record<string,string|string[]|undefined> }
interface Response { statusCode:number; setHeader(name:string,value:string):void; end(body?:string):void }
const runtime=new PersistentCommerceRuntime(new FirestoreCommerceStateStore())
const value=(entry:string|string[]|undefined)=>Array.isArray(entry)?entry[0]:entry
export default async function handler(req:Request,res:Response){
 if(req.method!=='GET'){res.statusCode=405;res.end(JSON.stringify({error:'Method not allowed'}));return}
 res.setHeader('Content-Type','application/json')
 try{
  const products=await runtime.execute({operation:'searchProducts',tenantId:'tenant-floes',input:{query:'',limit:20}}) as readonly Record<string,unknown>[]
  const slug=value(req.query?.slug)
  res.statusCode=200;res.end(JSON.stringify(slug?products.find((item)=>item.slug===slug)??null:products))
 }catch(error){res.statusCode=500;res.end(JSON.stringify({error:error instanceof Error?error.message:'Catalog unavailable'}))}
}
