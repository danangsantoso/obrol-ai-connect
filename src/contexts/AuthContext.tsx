import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export type Profile = Tables<'profiles'>;
export type AppRole = Profile['role'];

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Platform owner, outside all tenants. */
  isMaster: boolean;
  /** The user's tenant was suspended by the Master Admin. */
  tenantSuspended: boolean;
  /** Signed in with the password, the two-step verification code is still due. */
  mfaPending: boolean;
  /** The organization requires two-step verification for this role and it is not set up. */
  mfaSetupNeeded: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// One activity-log entry per sign-in (Supabase also reports SIGNED_IN when a
// tab wakes up, so the session id is remembered).
function logSignIn(accessToken: string) {
  try {
    const claims = JSON.parse(atob(accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    const key = `balas-login-${claims.session_id}`;
    if (!claims.session_id || sessionStorage.getItem(key) || localStorage.getItem(key)) return;
    localStorage.setItem(key, '1');
    sessionStorage.setItem(key, '1');
    // The query only runs once awaited.
    supabase.rpc('log_activity', { p_action: 'login', p_entity: 'session', p_entity_name: navigator.userAgent.slice(0, 120) }).then(() => {});
  } catch {
    // Logging must never block signing in.
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMaster, setIsMaster] = useState(false);
  const [tenantSuspended, setTenantSuspended] = useState(false);
  const [mfaPending, setMfaPending] = useState(false);
  const [mfaSetupNeeded, setMfaSetupNeeded] = useState(false);
  // Whose profile is loaded: a new sign-in shows the spinner until it is, so
  // routes do not act on a half-loaded state (e.g. send a 2FA user to onboarding).
  const loadedFor = useRef<string | null>(null);

  const loadProfile = useCallback(async (userId: string) => {
    // Until the code is entered the database shows nothing but the own profile.
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const pending = aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal2';
    setMfaPending(pending);
    if (pending) {
      setProfile(null);
      return false;
    }
    const [{ data }, { data: master }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabase.rpc('is_master_admin'),
    ]);
    // A suspended tenant is invisible to its own members (RLS).
    let suspended = false;
    let requireMfa = false;
    if (data?.organization_id) {
      const { data: org } = await supabase.from('organizations').select('id, require_mfa').eq('id', data.organization_id).maybeSingle();
      suspended = !org;
      requireMfa = Boolean(org?.require_mfa) && data.role !== 'agent';
    }
    setIsMaster(master === true);
    setTenantSuspended(suspended);
    setMfaSetupNeeded(requireMfa && aal?.nextLevel !== 'aal2');
    setProfile(data);
    return true;
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (!session?.user) {
        setProfile(null);
        setIsMaster(false);
        setTenantSuspended(false);
        setMfaPending(false);
        setMfaSetupNeeded(false);
        loadedFor.current = null;
        setLoading(false);
        return;
      }
      // Defer: Supabase must not be called inside this callback synchronously.
      const userId = session.user.id;
      if (loadedFor.current !== userId) setLoading(true);
      setTimeout(() => {
        loadProfile(userId)
          .then((verified) => {
            loadedFor.current = userId;
            if (verified && (event === 'SIGNED_IN' || event === 'MFA_CHALLENGE_VERIFIED')) logSignIn(session.access_token);
          })
          .finally(() => setLoading(false));
      }, 0);
    });

    return () => subscription.unsubscribe();
  }, [loadProfile]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName },
      },
    });
    return { error };
  };

  const signOut = async () => {
    if (user) {
      await supabase.from('profiles').update({ status: 'offline' }).eq('id', user.id);
    }
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const refreshProfile = useCallback(async () => {
    if (user) await loadProfile(user.id);
  }, [user, loadProfile]);

  return (
    <AuthContext.Provider
      value={{ user, session, profile, loading, isMaster, tenantSuspended, mfaPending, mfaSetupNeeded, signIn, signUp, signOut, refreshProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
