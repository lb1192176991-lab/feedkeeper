import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type User } from "../api/client.ts";
import { resetItemsScrollY } from "../utils/scrollState.ts";
import { clearOfflineData } from "../utils/serviceWorker.ts";

interface AuthState {
  user: User | null;
  loading: boolean;
  needsOnboarding: boolean;
  /** The server could not be reached, so we do not know whether the user is signed in. */
  unreachable: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  /** Apply a profile change returned by the API without a full auth reload. */
  setCurrentUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [unreachable, setUnreachable] = useState(false);

  async function refresh() {
    setLoading(true);
    setUnreachable(false);
    try {
      const status = await api.onboardingStatus();
      if (status.needsOnboarding) {
        setNeedsOnboarding(true);
        setUser(null);
        return;
      }
      setNeedsOnboarding(false);
      try {
        setUser(await api.me());
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          void clearOfflineData();
        } else if (error instanceof ApiError && error.status === 0) {
          setUnreachable(true);
        } else {
          console.error("Auth check failed:", error);
          setUser(null);
        }
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        setUnreachable(true);
      } else {
        console.error("Failed to check onboarding/auth status:", err);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await api.logout();
    await clearOfflineData();
    resetItemsScrollY();
    setUser(null);
  }

  useEffect(() => {
    refresh();
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, needsOnboarding, unreachable, refresh, logout, setCurrentUser: setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
