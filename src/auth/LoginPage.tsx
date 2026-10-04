import { FormEvent,useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { Navigate,useLocation,useNavigate } from 'react-router-dom'
import { auth } from './firebaseClient'
import { useAuthState } from './useAuthState'

export function LoginPage(){
  const {user,loading}=useAuthState()
  const navigate=useNavigate()
  const location=useLocation()
  const [email,setEmail]=useState('')
  const [password,setPassword]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')

  if(loading)return <main className="owner-login"><section><p>Verificando sesión...</p></section></main>
  if(user)return <Navigate to="/dashboard" replace/>

  const submit=async(event:FormEvent)=>{
    event.preventDefault()
    setBusy(true)
    setError('')
    try{
      await signInWithEmailAndPassword(auth,email.trim(),password)
      const destination=(location.state as {from?:string}|null)?.from??'/dashboard'
      navigate(destination,{replace:true})
    }catch{
      setError('Correo o contraseña incorrectos.')
    }finally{
      setBusy(false)
    }
  }

  return <main className="owner-login">
    <section>
      <span className="owner-mark">CHOPIFY</span>
      <h1>Command Center</h1>
      <p>Acceso administrativo seguro.</p>

      <form onSubmit={submit}>
        <label>
          Correo electrónico
          <input
            type="email"
            value={email}
            onChange={event=>setEmail(event.target.value)}
            autoComplete="email"
            required
          />
        </label>

        <label>
          Contraseña
          <input
            type="password"
            value={password}
            onChange={event=>setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        <button type="submit" disabled={busy}>
          {busy?'Ingresando...':'Ingresar'}
        </button>

        {error&&<p className="owner-error">{error}</p>}
      </form>
    </section>
  </main>
}
