import { MessageSquareText,RefreshCw } from 'lucide-react'
import { useCallback,useEffect,useState } from 'react'
import { EmptyState,StatusPill } from '../commercial/shared'
import { auth } from '../../auth/firebaseClient'
import { tenantDefinitions, tenantIds } from '../../config/tenantRegistry.js'

type Outbound={status:string;mode:string;attempts:number}
type LiveConversation={id:string;tenantId:string;channel:'WHATSAPP';contact:string;lastActivityAt:string;status:string;mode:string;requiresHuman:boolean;escalationReason:string;outbound:Outbound|null}

const date=(value:string)=>value
  ? new Intl.DateTimeFormat('es-EC',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))
  : 'Sin fecha'

export function ConversationsPage(){
  const [tenant,setTenant]=useState('tenant-floes')
  const [items,setItems]=useState<readonly LiveConversation[]>([])
  const [loading,setLoading]=useState(false)
  const [error,setError]=useState('')

  const load=useCallback(async()=>{
    setLoading(true)
    setError('')

    try{
      const user=auth.currentUser
      if(!user)throw new Error('La sesión administrativa no está disponible.')

      const idToken=await user.getIdToken()

      const response=await fetch(`/api/conversations?tenantId=${encodeURIComponent(tenant)}`,{
        headers:{
          accept:'application/json',
          authorization:`Bearer ${idToken}`,
        },
      })

      const body=await response.json()

      if(!response.ok){
        if(response.status===401)throw new Error('La sesión no es válida o ha expirado.')
        if(response.status===403)throw new Error('Tu usuario no tiene autorización de Platform Owner.')
        throw new Error(body.error||'No fue posible cargar conversaciones reales.')
      }

      setItems(body)
    }catch(cause){
      setItems([])
      setError(cause instanceof Error?cause.message:'No fue posible cargar conversaciones reales.')
    }finally{
      setLoading(false)
    }
  },[tenant])

  useEffect(()=>{
    const timer=window.setTimeout(()=>{void load()},0)
    return()=>window.clearTimeout(timer)
  },[load])

  return <div className="page">
    <div className="page-heading">
      <div>
        <span className="eyebrow">Operación real</span>
        <h1>Conversaciones</h1>
        <p>Eventos WhatsApp persistidos y consultados server-side para el tenant seleccionado.</p>
      </div>
      <div><select value={tenant} onChange={event=>setTenant(event.target.value)}>{tenantIds.map(id=><option key={id} value={id}>{tenantDefinitions[id].name}</option>)}</select> <button className="secondary-button" onClick={()=>void load()} disabled={loading}><RefreshCw size={15}/> {loading?'Actualizando...':'Actualizar'}</button></div>
    </div>

    {error&&
      <div className="error-banner">
        {error} <button onClick={()=>void load()}>Reintentar</button>
      </div>
    }

    {!loading&&items.length===0
      ? <EmptyState
          title="Sin conversaciones reales"
          body={`Cuando llegue un mensaje de un canal configurado para ${tenantDefinitions[tenant].name} aparecerá aquí.`}
        />
      : <section className="conversation-grid">
          {items.map(item=>
            <article className="conversation-card panel" key={item.id}>
              <div className="conversation-icon">
                <MessageSquareText size={18}/>
              </div>

              <div>
                <strong>{item.contact}</strong>
                <span>{tenantDefinitions[item.tenantId]?.name??item.tenantId} · {item.channel}</span>
              </div>

              <StatusPill value={item.outbound?.status||item.status}/>

              <div className="conversation-meta">
                <span>Última actividad</span>
                <strong>{date(item.lastActivityAt)}</strong>
                <span>Modo</span>
                <strong>{item.mode}</strong>
                <span>Requiere atención</span>
                <strong>{item.requiresHuman?'Sí':'No'}</strong>
                {item.requiresHuman&&<><span>Razón</span><strong>{item.escalationReason||'No registrada'}</strong></>}
                <span>Outbound</span>
                <strong>{item.outbound?.status||'Sin outbound'}</strong>
                <span>Intentos</span>
                <strong>{item.outbound?.attempts??'No disponible'}</strong>
              </div>
            </article>
          )}
        </section>
    }
  </div>
}
