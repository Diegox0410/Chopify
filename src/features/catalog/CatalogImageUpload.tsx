import { useState } from 'react'
import { auth } from '../../auth/firebaseClient'
import type { ProductImage } from '../../domain/commerce'
export function CatalogImageUpload({tenantId,model,color,onUploaded}:{tenantId:string;model:string;color?:string;onUploaded(image:ProductImage):void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  const upload=async(file?:File)=>{
    if(!file)return
    setBusy(true);setError('')
    try{
      if(file.size>3*1024*1024)throw new Error('La imagen supera 3 MB')
      const user=auth.currentUser;if(!user)throw new Error('Inicia sesión nuevamente')
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192))
      const response=await fetch('/api/catalog-assets',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${await user.getIdToken()}`},body:JSON.stringify({tenantId,model,color:color||'principal',filename:file.name,dataBase64:btoa(binary)})})
      const result=await response.json() as {ok?:boolean;data?:ProductImage;error?:string}
      if(!response.ok||!result.ok||!result.data)throw new Error(result.error??'No se pudo subir la imagen')
      onUploaded(result.data)
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo subir la imagen')}
    finally{setBusy(false)}
  }
  if(tenantId!=='tenant-floes')return null
  return <label className="field"><span>{busy?'Subiendo imagen…':'Subir/reemplazar imagen en Storage'}</span><input type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy||!model.trim()} onChange={event=>void upload(event.target.files?.[0])}/>{error&&<small role="alert">{error}</small>}</label>
}
