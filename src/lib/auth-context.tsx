import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type TenantMembership = {
  tenant_id: string;
  role: string;
  is_active: boolean;
  tenants: {
    id: string;
    name: string;
    slug: string;
    is_system?: boolean;
  };
};

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  memberships: TenantMembership[];
  currentTenantId: string | null;
  currentMembership: TenantMembership | null;
  selectTenant: (tenantId: string) => void;
  signOut: () => Promise<void>;
  refreshMemberships: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const STORAGE_KEY = "erp.currentTenantId";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<TenantMembership[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });
  const [loading, setLoading] = useState(true);

  const loadMemberships = async (uid: string) => {
    const { data, error } = await supabase
      .from("user_tenants")
      .select("tenant_id, role, is_active, tenants(id, name, slug, is_system)")
      .eq("user_id", uid)
      .eq("is_active", true);
    if (error) {
      console.error("Error cargando tenants:", error);
      setMemberships([]);
      return [] as TenantMembership[];
    }
    const list = (data ?? []) as unknown as TenantMembership[];
    setMemberships(list);
    return list;
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (!sess) {
        setMemberships([]);
        setCurrentTenantId(null);
        if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
      } else {
        // Defer DB call to avoid deadlocks inside the listener
        setTimeout(() => {
          void loadMemberships(sess.user.id);
        }, 0);
      }
    });

    void supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      if (data.session) {
        await loadMemberships(data.session.user.id);
      }
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Auto-select if exactly one membership and none selected
  useEffect(() => {
    if (!currentTenantId && memberships.length === 1) {
      const id = memberships[0].tenant_id;
      setCurrentTenantId(id);
      if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, id);
    }
    // If selected tenant no longer in memberships, clear
    if (
      currentTenantId &&
      memberships.length > 0 &&
      !memberships.find((m) => m.tenant_id === currentTenantId)
    ) {
      setCurrentTenantId(null);
      if (typeof window !== "undefined") localStorage.removeItem(STORAGE_KEY);
    }
  }, [memberships, currentTenantId]);

  const selectTenant = (tenantId: string) => {
    setCurrentTenantId(tenantId);
    if (typeof window !== "undefined") localStorage.setItem(STORAGE_KEY, tenantId);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const refreshMemberships = async () => {
    if (user) await loadMemberships(user.id);
  };

  const currentMembership =
    memberships.find((m) => m.tenant_id === currentTenantId) ?? null;

  return (
    <AuthContext.Provider
      value={{
        loading,
        session,
        user,
        memberships,
        currentTenantId,
        currentMembership,
        selectTenant,
        signOut,
        refreshMemberships,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return ctx;
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super administrador",
  implementer: "Implementador",
  tenant_owner: "Propietario",
  gerente: "Gerente",
  vendedor: "Vendedor",
  almacenista: "Almacenista",
  cajero: "Cajero",
};