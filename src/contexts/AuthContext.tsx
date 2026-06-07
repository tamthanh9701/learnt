import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import type { AuthError, User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  display_name: string;
  ui_language: 'vi' | 'en';
  daily_goal: number;
  current_streak: number;
  longest_streak: number;
  last_activity_date?: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isMock: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: unknown }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Check if we are running in mock mode
const isSupabaseConfigured =
  import.meta.env.VITE_SUPABASE_URL &&
  import.meta.env.VITE_SUPABASE_URL !== 'https://placeholder-project.supabase.co';

// CH7-fix (2026-06-07, P2-#8): derive the mock-mode user ID from the
// email instead of the previous hard-coded "mock-user-123". Two
// Learners using demo/offline mode would otherwise share ALL
// data (Topics progress, Conversations, Pronunciation history,
// Writing submissions) because every localStorage key is keyed
// on the user ID. btoa() is a quick stable hash; it's NOT a
// security boundary (no secret material here, just an email),
// it just gives a unique per-email ID.
const mockUserId = (email: string): string => 'mock-' + btoa(email).replace(/[=+/]/g, '');

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMock] = useState(!isSupabaseConfigured);

  // Load mock profile from localStorage
  const loadMockProfile = (userId: string): UserProfile => {
    const saved = localStorage.getItem(`learnt_profile_${userId}`);
    if (saved) {
      return JSON.parse(saved);
    }
    const newProfile: UserProfile = {
      id: userId,
      display_name: 'Mock Learner',
      ui_language: 'vi',
      daily_goal: 20,
      current_streak: 1,
      longest_streak: 1,
    };
    localStorage.setItem(`learnt_profile_${userId}`, JSON.stringify(newProfile));
    return newProfile;
  };

  const saveMockProfile = (userId: string, data: UserProfile) => {
    localStorage.setItem(`learnt_profile_${userId}`, JSON.stringify(data));
    setProfile(data);
  };

  // Sync Supabase Auth state
  // CH7-fix (2026-06-07, P1-#5): fetchProfile was defined AFTER the
  // useEffect (further down in the file). TypeScript + React lint
  // both flagged this as a bug because the closure captured the
  // wrong binding. Function hoisting saved us at runtime, but the
  // lint error and the implicit dependency on hoisting was a footgun.
  //
  // CH7-fix (P2 bonus): useCallback deps with `user` are unstable
  // (the user object identity changes on every render), and the
  // React Compiler flagged `user` vs `user?.email` as a mismatch.
  // Fix: use a ref to capture the latest email. The callback's
  // identity is now stable so the useEffect below doesn't refire
  // on every render.
  const userEmailRef = useRef<string | undefined>(undefined);
  useEffect(() => { userEmailRef.current = user?.email; }, [user?.email]);

  const fetchProfile = useCallback(async (userId: string) => {
    try {
      const profileRes = await withTimeout(
        async (signal) => {
          const res = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .abortSignal(signal)
            .maybeSingle();
          return res;
        },
        6_000,
        'AuthContext: fetchProfile',
      );

      const { data: row, error } = profileRes;
      // CH7-fix (2026-06-07, P2-#10): pre-fix checked
      // `error.code === 'PGRST116'` to detect "no row" - but that
      // error is only thrown by .single(). With .maybeSingle(), the
      // no-row case is { data: null, error: null }, NOT PGRST116.
      // Result: the "profile doesn't exist, create one" branch
      // NEVER fired. New Learners had no profiles row, and the UI
      // showed empty defaults.
      if (!row && !error) {
        const newProfile = {
          id: userId,
          display_name: userEmailRef.current?.split('@')[0] || 'Learner',
          ui_language: 'vi',
          daily_goal: 20,
          current_streak: 0,
          longest_streak: 0,
        };
        const insertRes = await withTimeout(
          async (signal) => {
            const r = await supabase
              .from('profiles')
              .insert(newProfile)
              .abortSignal(signal);
            return r;
          },
          6_000,
          'AuthContext: createProfile',
        );
        if (!insertRes.error) setProfile(newProfile as UserProfile);
      } else if (error) {
        console.error('Error fetching profile:', error);
      } else if (row) {
        setProfile(row as unknown as UserProfile);
      }
    } catch (err) {
      console.error('Error in fetchProfile:', err);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Mock mode initialization
      const savedMockUser = localStorage.getItem('learnt_mock_user');
      if (savedMockUser) {
        const u = JSON.parse(savedMockUser) as User;
        setUser(u);
        setProfile(loadMockProfile(u.id));
      }
      setLoading(false);
      return;
    }

    let loadingTimedOut = false;

    // Safety net: force loading to false after 8s even if something hangs.
    // Stale localStorage tokens pointing to an unreachable Supabase URL can
    // cause fetchProfile to hang forever (no fetch timeout by default).
    const safetyTimeout = setTimeout(() => {
      if (!loadingTimedOut) {
        loadingTimedOut = true;
        console.warn('Auth loading timed out after 8s — forcing loading=false.');
        setUser(null);
        setProfile(null);
        setLoading(false);
      }
    }, 8000);

    // Supabase mode initialization
    const initSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          setUser(session.user);
          await fetchProfile(session.user.id);
        }
      } catch (err) {
        console.error('Error fetching session:', err);
        // Clear stale session that might be causing the hang
        try { await supabase.auth.signOut(); } catch { /* ignore */ }
      } finally {
        if (!loadingTimedOut) {
          clearTimeout(safetyTimeout);
          setLoading(false);
        }
      }
    };

    initSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        setUser(session.user);
        await fetchProfile(session.user.id);
      } else {
        setUser(null);
        setProfile(null);
      }
      if (!loadingTimedOut) {
        clearTimeout(safetyTimeout);
        setLoading(false);
      }
    });

    return () => {
      clearTimeout(safetyTimeout);
      subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const refreshProfile = async () => {
    if (user) {
      if (isMock) {
        setProfile(loadMockProfile(user.id));
      } else {
        await fetchProfile(user.id);
      }
    }
  };

  const signIn = async (email: string, password: string) => {
    if (isMock) {
      // Simulate successful login in mock mode
      const mockUser = {
        id: mockUserId(email),
        email,
        aud: 'authenticated',
        role: 'authenticated',
        created_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
      } as User;
      localStorage.setItem('learnt_mock_user', JSON.stringify(mockUser));
      setUser(mockUser);
      setProfile(loadMockProfile(mockUser.id));
      return { error: null };
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string, displayName: string) => {
    if (isMock) {
      const mockUser = {
        id: mockUserId(email),
        email,
        aud: 'authenticated',
        role: 'authenticated',
        created_at: new Date().toISOString(),
        app_metadata: {},
        user_metadata: {},
      } as User;
      localStorage.setItem('learnt_mock_user', JSON.stringify(mockUser));
      setUser(mockUser);
      
      const newProfile: UserProfile = {
        id: mockUser.id,
        display_name: displayName,
        ui_language: 'vi',
        daily_goal: 20,
        current_streak: 1,
        longest_streak: 1,
      };
      saveMockProfile(mockUser.id, newProfile);
      return { error: null };
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName,
        },
      },
    });

    if (!error && data.user) {
      // Create user profile
      const newProfile = {
        id: data.user.id,
        display_name: displayName,
        ui_language: 'vi',
        daily_goal: 20,
        current_streak: 1,
        longest_streak: 1,
      };
      await supabase.from('profiles').insert(newProfile);
    }
    return { error };
  };

  const signOut = async () => {
    if (isMock) {
      localStorage.removeItem('learnt_mock_user');
      setUser(null);
      setProfile(null);
      return { error: null };
    }

    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return { error: 'No authenticated user' };

    if (isMock) {
      const current = loadMockProfile(user.id);
      const updated = { ...current, ...updates };
      saveMockProfile(user.id, updated);
      return { error: null };
    }

    const { error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id);
    
    if (!error) {
      setProfile(prev => prev ? { ...prev, ...updates } : null);
    }
    return { error };
  };

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      loading,
      isMock,
      signIn,
      signUp,
      signOut,
      updateProfile,
      refreshProfile
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
