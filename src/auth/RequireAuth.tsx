import { Navigate,useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuthState } from './useAuthState'

export function RequireAuth({children}:{children:ReactNode}){
  const {user,loading}=useAuthState()
  const location=useLocation()

  if(loading){
    return <main className="owner-login">
      <section><p>Verificando sesión...</p></section>
    </main>
  }

  if(!user){
    return <Navigate
      to="/login"
      replace
      state={{from:location.pathname+location.search}}
    />
  }

  return <>{children}</>
}
