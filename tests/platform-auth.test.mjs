import test from 'node:test'
import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'

import { authorizePlatformOwner, resetFirebaseAuthCacheForTests } from '../api/_lib/firebaseAuth.js'

const encoded=value=>Buffer.from(JSON.stringify(value)).toString('base64url')
const token=(privateKey,uid)=>{
  const now=Math.floor(Date.now()/1000)
  const header=encoded({alg:'RS256',kid:'test-key',typ:'JWT'})
  const payload=encoded({aud:'test-project',iss:'https://securetoken.google.com/test-project',sub:uid,iat:now-5,exp:now+300})
  const data=`${header}.${payload}`
  return`${data}.${sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url')}`
}

test('Platform auth distinguishes missing token, unauthorized Firebase user and owner',async()=>{
  const previousFetch=globalThis.fetch
  const previousProject=process.env.CHOPIFY_FIREBASE_PROJECT_ID
  const previousOwner=process.env.CHOPIFY_PLATFORM_OWNER_UID
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048})
  const pem=publicKey.export({type:'spki',format:'pem'}).toString()
  process.env.CHOPIFY_FIREBASE_PROJECT_ID='test-project'
  process.env.CHOPIFY_PLATFORM_OWNER_UID='owner-uid'
  globalThis.fetch=async()=>new Response(JSON.stringify({'test-key':pem}),{status:200,headers:{'cache-control':'max-age=60'}})
  resetFirebaseAuthCacheForTests()

  try{
    assert.deepEqual(await authorizePlatformOwner({headers:{}}),{ok:false,status:401,error:'Unauthorized'})
    assert.deepEqual(await authorizePlatformOwner({headers:{authorization:`Bearer ${token(privateKey,'other-uid')}`}}),{ok:false,status:403,error:'Forbidden'})
    const owner=await authorizePlatformOwner({headers:{authorization:`Bearer ${token(privateKey,'owner-uid')}`}})
    assert.equal(owner.ok,true)
    assert.equal(owner.identity.uid,'owner-uid')
  }finally{
    globalThis.fetch=previousFetch
    if(previousProject===undefined)delete process.env.CHOPIFY_FIREBASE_PROJECT_ID;else process.env.CHOPIFY_FIREBASE_PROJECT_ID=previousProject
    if(previousOwner===undefined)delete process.env.CHOPIFY_PLATFORM_OWNER_UID;else process.env.CHOPIFY_PLATFORM_OWNER_UID=previousOwner
    resetFirebaseAuthCacheForTests()
  }
})
