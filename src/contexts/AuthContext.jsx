import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase } from '../lib/supabaseClient'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) {
      console.error('Failed to load profile', error)
      setProfile(null)
    } else {
      setProfile(data)
    }
  }, [])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      await loadProfile(data.session?.user?.id)
      setLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession)
      await loadProfile(newSession?.user?.id)
      // Only on an explicit sign-in (not on INITIAL_SESSION/refresh from an
      // already-open tab) do we flip presence to available.
      if (event === 'SIGNED_IN') {
        try {
          await supabase.rpc('set_presence', { p_status: 'available' })
          // Realtime subscription for this session isn't attached yet at this
          // point (it's set up in a separate effect that fires after this
          // handler returns), so re-fetch rather than waiting on the channel.
          await loadProfile(newSession?.user?.id)
        } catch (e) {
          console.error('Failed to set available presence on sign-in', e)
        }
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  // Keep the profile row (role/status) live — another tab, an admin edit, or
  // set_presence() from this tab should all reflect instantly everywhere.
  useEffect(() => {
    if (!session?.user?.id) return
    const channel = supabase
      .channel(`profile-${session.user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${session.user.id}` },
        (payload) => setProfile(payload.new)
      )
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [session?.user?.id])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email, password, fullName) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    try {
      await supabase.rpc('set_presence', { p_status: 'offline' })
    } catch (e) {
      console.error('Failed to set offline presence on sign-out', e)
    }
    await supabase.auth.signOut()
  }, [])

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
    refreshProfile: () => loadProfile(session?.user?.id),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}