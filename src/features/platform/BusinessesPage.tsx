import {Building2,UsersRound,ShoppingBag} from 'lucide-react'
import {useEffect,useState} from 'react'
import {samplePlatformApp} from '../../application/platform'
import {SampleBadge} from '../commercial/shared'
type Row=Awaited<ReturnType<typeof samplePlatformApp.businesses>>[number]
export function BusinessesPage(){const [rows,setRows]=useState<readonly Row[]>([]);useEffect(()=>{void samplePlatformApp.businesses().then(setRows)},[]);return <div className="page"><div className="page-heading"><div><span className="eyebrow">H5 · Super Admin</span><h1>Negocios</h1><p>Portafolio multi-tenant y configuración operacional SAMPLE.</p></div><SampleBadge/></div><div className="platform-grid">{rows.map(x=><article className="platform-card" key={x.id}><div className="platform-card-head"><Building2/><Status value={x.status}/></div><h2>{x.name}</h2><p>{x.profile?.ownerEmail}</p><div className="platform-stats"><span><UsersRound/> {x.users} usuarios</span><span><ShoppingBag/> {x.orders} pedidos</span></div><small>{x.profile?.primaryChannel} · {x.profile?.timezone}</small></article>)}</div></div>}
function Status({value}:{value:string}){return <span className={`entity-status status-${value.toLowerCase()}`}>{value}</span>}
