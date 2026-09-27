import {useEffect,useState} from 'react'
import {samplePlatformApp} from '../../application/platform'
import type {PlatformUser} from '../../domain'
import {SampleBadge,TenantFilter,StatusPill} from '../commercial/shared'
import {tenantNames} from '../commercial/formatters'
import {useUIStore} from '../../stores/uiStore'
export function UsersPage(){const scope=useUIStore(s=>s.tenantScope);const [rows,setRows]=useState<readonly PlatformUser[]>([]);useEffect(()=>{void samplePlatformApp.users(scope).then(setRows)},[scope]);return <div className="page"><div className="page-heading"><div><span className="eyebrow">H5 · Access control</span><h1>Usuarios</h1><p>Roles y acceso aislados por negocio.</p></div><div className="heading-actions"><SampleBadge/><TenantFilter/></div></div><section className="panel"><div className="h57-table">{rows.map(x=><div key={x.id}><strong>{x.name}</strong><span>{tenantNames[x.tenantId]??x.tenantId}</span><span>{x.role}</span><StatusPill value={x.status}/></div>)}</div></section></div>}
