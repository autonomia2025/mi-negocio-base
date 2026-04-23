import { useEffect, useState } from "react";

const KEY = "erp.impersonating_tenant_id";
const EVT = "erp:impersonation-change";

export function getImpersonatingTenantId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(KEY);
}

export function setImpersonatingTenantId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) localStorage.setItem(KEY, id);
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new CustomEvent(EVT));
}

export function useImpersonatingTenantId() {
  const [id, setId] = useState<string | null>(() => getImpersonatingTenantId());
  useEffect(() => {
    const sync = () => setId(getImpersonatingTenantId());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return id;
}