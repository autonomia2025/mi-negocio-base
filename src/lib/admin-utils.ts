export const PLAN_PRICES_MXN: Record<string, number> = {
  basico: 2000,
  profesional: 3500,
  empresarial: 6000,
};

export const PLAN_AI_LIMITS: Record<string, number> = {
  basico: 200,
  profesional: 1000,
  empresarial: 5000,
};

export const PLAN_LABELS: Record<string, string> = {
  basico: "Básico",
  profesional: "Profesional",
  empresarial: "Empresarial",
};

export const STATUS_LABELS: Record<string, string> = {
  trial: "Prueba",
  active: "Activo",
  suspended: "Suspendido",
  cancelled: "Cancelado",
};

export const STATUS_TONES: Record<string, string> = {
  trial: "bg-amber-50 text-amber-800 border-amber-200",
  active: "bg-emerald-50 text-emerald-800 border-emerald-200",
  suspended: "bg-rose-50 text-rose-800 border-rose-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

export function formatMXN(amount: number) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function slugify(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function generatePassword(length = 16) {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*";
  const arr = new Uint32Array(length);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 1e9);
  }
  let out = "";
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

import { supabase } from "@/integrations/supabase/client";

export async function logAudit(args: {
  tenantId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  changes?: Record<string, unknown> | null;
}) {
  const { data: u } = await supabase.auth.getUser();
  const userId = u.user?.id;
  if (!userId) return;
  const { error } = await supabase.from("audit_log").insert({
    tenant_id: args.tenantId,
    user_id: userId,
    action: args.action,
    entity_type: args.entityType ?? null,
    entity_id: args.entityId ?? null,
    changes: (args.changes ?? null) as never,
    user_agent:
      typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
  });
  if (error) console.error("audit_log insert error", error);
}