import { useState } from 'react'
import { auth } from '../../auth/firebaseClient'
import { adminCall } from '../../services/adminApi'
import { readCatalogFile } from '../../application/catalogFiles'
import { normalizeCatalogKey, normalizeImagePath, previewCatalogImport, type CatalogPreview, type CatalogRow } from '../../application/catalogImport'
import type { CommerceProduct } from '../../domain/commerce'

interface Asset { name: string; bytes: Uint8Array }
function base64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
async function collectAssets(files: FileList | null): Promise<Asset[]> {
  if (!files) return []
  const assets: Asset[] = []
  for (const file of Array.from(files)) {
    if (file.size > 20 * 1024 * 1024) throw new Error('Cada archivo debe pesar menos de 20 MB')
    if (/\.zip$/i.test(file.name)) {
      const { Unzip, AsyncUnzipInflate } = await import('fflate')
      let total=0
      await new Promise<void>((resolve,reject) => {
        let pending=0, ended=false
        const finish=()=>{if(ended&&pending===0)resolve()}
        const unzip=new Unzip(entry=>{
          if(!/\.(jpg|jpeg|png|webp)$/i.test(entry.name))return
          if(/(^|\/)\.\.(\/|$)/.test(entry.name)||entry.name.startsWith('/')){reject(new Error('ZIP contiene una ruta inválida'));return}
          pending++
          const chunks:Uint8Array[]=[];let size=0
          entry.ondata=(error,data,final)=>{
            if(error){reject(error);return}
            size+=data.length;total+=data.length
            if(size>3*1024*1024||total>100*1024*1024){entry.terminate();reject(new Error('ZIP excede límite de imágenes (3 MB cada una / 100 MB total)'));return}
            chunks.push(data)
            if(final){const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}assets.push({name:entry.name,bytes});pending--;finish()}
          }
          entry.start()
        })
        unzip.register(AsyncUnzipInflate)
        file.arrayBuffer().then(buffer=>{unzip.push(new Uint8Array(buffer),true);ended=true;finish()}).catch(reject)
      })
    } else if (/\.(jpg|jpeg|png|webp)$/i.test(file.name)) {
      if(file.size>3*1024*1024)throw new Error('Cada imagen debe pesar menos de 3 MB')
      assets.push({ name: file.webkitRelativePath || file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
    }
  }
  if(assets.length>1000)throw new Error('Máximo 1000 imágenes por importación')
  return assets
}
export function CatalogImportPanel({tenantId,products,onImported}:{tenantId:string;products:readonly CommerceProduct[];onImported():Promise<void>}) {
  const [rows,setRows]=useState<CatalogRow[]>([]),[assets,setAssets]=useState<Asset[]>([]),[preview,setPreview]=useState<CatalogPreview|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('')
  const analyze=async(file?:File)=>{
    if(!file)return
    setBusy(true);setError('');setStatus('');setPreview(null)
    try {const parsed=await readCatalogFile(file.name,await file.arrayBuffer());setRows(parsed);setPreview(previewCatalogImport(tenantId,parsed,products,Object.fromEntries(assets.map(asset=>[asset.name,`https://pending-upload.invalid/${encodeURIComponent(asset.name)}`]))))}
    catch(cause){setRows([]);setError(cause instanceof Error?cause.message:'No se pudo analizar el archivo')}
    finally{setBusy(false)}
  }
  const selectAssets=async(files:FileList|null)=>{
    setBusy(true);setError('');setStatus('')
    try{const selected=await collectAssets(files);setAssets(selected);if(rows.length)setPreview(previewCatalogImport(tenantId,rows,products,Object.fromEntries(selected.map(asset=>[asset.name,`https://pending-upload.invalid/${encodeURIComponent(asset.name)}`]))))}
    catch(cause){setError(cause instanceof Error?cause.message:'No se pudieron leer las imágenes')}
    finally{setBusy(false)}
  }
  const commit=async()=>{
    setBusy(true);setError('');setStatus('')
    try{
      const user=auth.currentUser;if(!user)throw new Error('Inicia sesión nuevamente')
      const token=await user.getIdToken();const urls:Record<string,string>={}
      for(const [index,asset] of assets.entries()) {
        const path=asset.name.replace(/\\/g,'/').split('/');const filename=path.at(-1)??''
        const key=normalizeImagePath(asset.name)
        let model=path.length>1?normalizeCatalogKey(path.at(-2)??''):''
        if(!model){const matching=rows.filter(row=>Array.from({length:6},(_,index)=>index+1).some(number=>normalizeImagePath(String(row[`imagen_${number}`]??'')).endsWith(key)));const models=[...new Set(matching.map(row=>normalizeCatalogKey(String(row.nombre_producto??'').replace(/^modelo\s+/i,''))))];if(models.length!==1)throw new Error(`Coloca ${filename} dentro de la carpeta de su modelo`);model=models[0]}
        setStatus(`Verificando imagen ${index+1} de ${assets.length}…`)
        // Preserve the original byte mapping; use a safe upload filename accepted by Storage.
        // These are model gallery assets, not evidence that a pictured color is available.
        const extension = filename.split('.').at(-1)?.toLowerCase()
        if (!extension || !['jpg','jpeg','png','webp'].includes(extension)) throw new Error(`Formato de imagen no compatible: ${filename}`)
        const uploadFilename = `foto-${String(index+1).padStart(2,'0')}.${extension}`
        const response=await fetch('/api/catalog-assets',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${token}`},body:JSON.stringify({tenantId,model,color:'galeria',filename:uploadFilename,dataBase64:base64(asset.bytes)})})
        const body=await response.json() as {ok?:boolean;data?:{url:string};error?:string}
        if(!response.ok||!body.ok||!body.data)throw new Error(body.error??'No se pudo subir la imagen')
        urls[asset.name]=body.data.url
      }
      const validated=await adminCall<CatalogPreview>('previewCatalogImport',tenantId,{rows,imageUrls:urls})
      if(validated.issues.some(issue=>issue.severity==='ERROR')){setPreview(validated);throw new Error('El catálogo cambió o tiene errores; revisa la nueva vista previa')}
      const result=await adminCall<CatalogPreview>('importCatalog',tenantId,{rows,imageUrls:urls},crypto.randomUUID())
      setPreview(result);setStatus(`Importación completada: ${result.summary.newProducts} productos nuevos, ${result.summary.newVariants} variantes nuevas, ${result.summary.updates} actualizaciones.`)
      await onImported()
    }catch(cause){setError(cause instanceof Error?cause.message:'La importación falló')}
    finally{setBusy(false)}
  }
  if(tenantId!=='tenant-floes')return null
  return <section className="panel catalog-import" key={tenantId}>
    <header><span className="eyebrow">Catálogo → Importar productos</span><h2>Excel + imágenes</h2><p>Usa la plantilla maestra FLOES e incluye el SKU principal oficial del modelo (`sku_producto`) y el SKU real de cada variante. No se generan SKU automáticamente. Revisa las filas antes de importar; el mismo SKU actualiza su variante y conserva los pedidos existentes.</p></header>
    <div className="product-form-grid">
      <label className="field"><span>1. Excel o CSV</span><input type="file" accept=".xlsx,.csv" disabled={busy} onChange={event=>void analyze(event.target.files?.[0])}/></label>
      <label className="field"><span>2. ZIP o imágenes (carpetas por modelo)</span><input type="file" multiple accept=".zip,.jpeg,.jpg,.png,.webp" disabled={busy} onChange={event=>void selectAssets(event.target.files)}/><small>{assets.length} imágenes seleccionadas. También puedes arrastrar el archivo sobre este control.</small></label>
      <label className="field"><span>O selecciona una carpeta de imágenes</span><input type="file" multiple {...{webkitdirectory:''}} disabled={busy} onChange={event=>void selectAssets(event.target.files)}/></label>
    </div>
    {preview&&<><div className="catalog-import-summary">{Object.entries(preview.summary).map(([label,value])=><span key={label}><strong>{value}</strong> {{rows:'Filas',validRows:'Válidas',newProducts:'Productos nuevos',newVariants:'Variantes nuevas',updates:'Actualizaciones',duplicateSkus:'SKUs repetidos',imagesFound:'Imágenes encontradas',imagesMissing:'Imágenes faltantes'}[label]}</span>)}</div>
      <div className="catalog-import-table"><table><thead><tr><th>Modelo</th><th>Variantes</th><th>Moneda</th><th>Estado</th></tr></thead><tbody>{preview.products.map(product=><tr key={product.id}><td>{product.name}</td><td>{product.variants.length}</td><td>{product.currency}</td><td>{product.status}</td></tr>)}</tbody></table></div>
      {preview.issues.length>0&&<details open><summary>{preview.issues.filter(issue=>issue.severity==='ERROR').length} errores · {preview.issues.filter(issue=>issue.severity==='WARNING').length} advertencias</summary><ul>{preview.issues.map((issue,index)=><li key={index}>Fila {issue.row} · {issue.severity==='ERROR'?'Error':'Advertencia'} · {issue.message}</li>)}</ul></details>}
      <button className="primary-button" disabled={busy||preview.issues.some(issue=>issue.severity==='ERROR')||!preview.products.length} onClick={()=>void commit()}>{busy?'Procesando…':'Importar / actualizar catálogo'}</button>
    </>}
    {status&&<p role="status">{status}</p>}{error&&<div className="error-banner" role="alert">{error}</div>}
  </section>
}
