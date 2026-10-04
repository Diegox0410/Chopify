import { useEffect,useState } from 'react'
import { onAuthStateChanged,type User } from 'firebase/auth'
import { auth } from './firebaseClient'

export function useAuthState(){
  const [user,setUser]=useState<User|null>(auth.currentUser)
  const [loading,setLoading]=useState(true)

  useEffect(()=>{
    return onAuthStateChanged(auth,current=>{
      setUser(current)
      setLoading(false)
    })
  },[])

  return {user,loading}
}
