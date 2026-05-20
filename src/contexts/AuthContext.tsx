import React, { createContext, useContext, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { User } from '@supabase/supabase-js';

export interface UserProfile {
  id: string;
  display_name: string;
  ui_language: 'vi' | 'en';
  daily_goal: number;
  current_streak: number;
  longest_streak: number;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isMock: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: any }>;
  signOut: () => Promise<{ error: any }>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: any }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Check if we are running in mock mode
const isSupabaseConfigured = 
  import.meta.env.VITE_SUPABASE_URL && 
  import.meta.env.VITE_SUPABASE_URL !== 'https://placeholder-project.supabase.co';

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
      } finally {
        setLoading(false);
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
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      
      if (error) {
        if (error.code === 'PGRST116') {
          // Profile doesn't exist, create it
          const newProfile = {
            id: userId,
            display_name: user?.email?.split('@')[0] || 'Learner',
            ui_language: 'vi',
            daily_goal: 20,
            current_streak: 0,
            longest_streak: 0,
          };
          const { error: insertError } = await supabase.from('profiles').insert(newProfile);
          if (!insertError) setProfile(newProfile as UserProfile);
        } else {
          console.error('Error fetching profile:', error);
        }
      } else {
        setProfile(data as UserProfile);
      }
    } catch (err) {
      console.error('Error in fetchProfile:', err);
    }
  };

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
        id: 'mock-user-123',
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
        id: 'mock-user-123',
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
