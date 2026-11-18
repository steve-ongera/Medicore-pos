// src/context/AuthContext.jsx
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as API from "../services/api";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(API.getStoredUser());
  const [loading, setLoading] = useState(API.isAuthenticated());

  // Refresh the user from the server on first load (role/name may have changed).
  useEffect(() => {
    if (!API.isAuthenticated()) {
      setLoading(false);
      return;
    }
    API.getMe()
      .then((u) => {
        setUser(u);
        localStorage.setItem("user", JSON.stringify(u));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await API.login(username, password);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await API.logout();
    setUser(null);
  }, []);

  const refreshUser = useCallback((u) => {
    setUser(u);
    localStorage.setItem("user", JSON.stringify(u));
  }, []);

  return (
    <AuthCtx.Provider value={{ user, loading, login, logout, refreshUser, isAuthenticated: !!user }}>
      {children}
    </AuthCtx.Provider>
  );
}
