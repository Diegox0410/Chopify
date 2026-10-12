import { Bell } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../features/admin/adminApi'
import { useVisiblePolling } from '../hooks/useVisiblePolling'

type Alert = { id:string; tenantId:string; type:string; summary:string; href:string; read:boolean; createdAt:string }
type Snapshot = { alerts:readonly Alert[]; unreadAlertCount:number }

export function OperationalAlertsBell(){
  const [alerts,setAlerts]=useState<readonly Alert[]>([])
  const [open,setOpen]=useState(false)
  const load=useCallback(async()=>{
    try{
      const snapshot=await adminApi<Snapshot>('notificationsSnapshot','all')
      setAlerts([...snapshot.alerts].sort((a,b)=>Number(a.read)-Number(b.read)||b.createdAt.localeCompare(a.createdAt)))
      return true
    }catch{return false}
  },[])
  useVisiblePolling(load,60_000)
  const unread=alerts.filter(alert=>!alert.read).length
  async function openAlert(alert:Alert){
    if(!alert.read)await adminApi('markOperationalAlertRead',alert.tenantId,{alertId:alert.id},crypto.randomUUID()).catch(()=>{})
    setOpen(false);await load()
  }
  return <div className="operational-alerts"><button className="icon-button operational-alerts-trigger" aria-label={`Notificaciones${unread?`, ${unread} sin leer`:''}`} aria-expanded={open} onClick={()=>setOpen(value=>!value)}><Bell size={18}/>{unread>0&&<span>{unread>99?'99+':unread}</span>}</button>{open&&<section className="operational-alerts-menu" aria-label="Alertas operativas"><header><strong>Alertas operativas</strong><button className="text-button" onClick={()=>void load()}>Actualizar</button></header>{alerts.length===0?<p>Sin alertas abiertas.</p>:alerts.slice(0,20).map(alert=><Link key={alert.id} to={alert.href} className={alert.read?'operational-alert-read':'operational-alert-unread'} onClick={()=>void openAlert(alert)}><span>{alert.summary}</span><small>{alert.type.replaceAll('_',' ')} · {alert.tenantId.replace('tenant-','').toUpperCase()}</small></Link>)}</section>}</div>
}
