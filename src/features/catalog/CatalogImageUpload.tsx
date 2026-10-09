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
      const imageColor=color||file.name.replace(/\.[^.]+$/,'')
      const response=await fetch('/api/catalog-assets',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${await user.getIdToken()}`},body:JSON.stringify({tenantId,model,color:imageColor})})
      const result=await response.json() as {ok?:boolean;data?:ProductImage;error?:string}
      if(!response.ok||!result.ok||!result.data)throw new Error(result.error??'No se pudo subir la imagen')
      onUploaded(result.data)
    }catch(cause){setError(cause instanceof Error?cause.message:'No se pudo subir la imagen')}
    finally{setBusy(false)}
  }
  if(tenantId!=='tenant-floes')return null
  return <label className="field"><span>{busy?'Buscando imagen…':'Vincular imagen pública ya sincronizada'}</span><input type="file" accept=".jpg,.jpeg,.png,.webp" disabled={busy||!model.trim()} onChange={event=>void upload(event.target.files?.[0])}/>{error&&<small role="alert">{error}</small>}</label>
}
