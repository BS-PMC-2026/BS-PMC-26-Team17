import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  registerForPushNotifications,
  clearPushNotifications,
} from '@/services/notifications';

type User = {
  id: string;
  email: string;
  name: string;
  role: string;
  telephone: string;
};

type AuthContextType = {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  isLoggedIn: boolean;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load user from storage when app starts
  useEffect(() => {
    async function loadUser() {
      try {
        const stored = await AsyncStorage.getItem('user');
        if (stored) {
          setUser(JSON.parse(stored));
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    }
    loadUser();
  }, []);

  // Re-register the push token whenever an admin user is set (login OR
  // app restart with a stored admin user). Regular users aren't asked for
  // notification permission since they don't receive any.
  useEffect(() => {
    if (user?.role === 'admin' && user.id) {
      registerForPushNotifications(user.id).catch((e) =>
        console.log('[auth] push registration failed:', e),
      );
    }
  }, [user]);

  const login = async (userData: User) => {
    setUser(userData);
    await AsyncStorage.setItem('user', JSON.stringify(userData));
  };

  const logout = async () => {
    const prevId = user?.id;
    setUser(null);
    await AsyncStorage.removeItem('user');
    // Tell the server to stop pushing to this device. Fire-and-forget so a
    // network error doesn't block the logout.
    if (prevId) {
      clearPushNotifications(prevId).catch(() => {});
    }
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, isLoggedIn: !!user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
