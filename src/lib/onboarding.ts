import type { TenantMembership } from "@/lib/auth-context";

export type OnboardingSettings = {
  onboarding_completed?: boolean;
  onboarding_completed_at?: string | null;
  onboarding_step?: number;
  business?: {
    razon_social?: string;
    rfc?: string | null;
    direccion_fiscal?: string;
    telefono?: string;
    correo_contacto?: string;
    sitio_web?: string | null;
    logo_url?: string | null;
    catalog_description?: string;
  };
  operations?: {
    moneda?: "MXN" | "USD" | "EUR";
    usa_cfdi?: boolean;
    punto_reorden_default?: number;
    metodos_pago?: string[];
    zona_horaria?: string;
  };
};

export type TenantSettings = OnboardingSettings & Record<string, unknown>;

export const TOTAL_STEPS = 6;

export function isOnboardingCompleted(settings: unknown): boolean {
  if (!settings || typeof settings !== "object") return false;
  return (settings as OnboardingSettings).onboarding_completed === true;
}

export function getOnboardingStep(settings: unknown): number {
  if (!settings || typeof settings !== "object") return 0;
  const s = (settings as OnboardingSettings).onboarding_step;
  if (typeof s !== "number" || s < 0) return 0;
  return Math.min(s, TOTAL_STEPS - 1);
}

export function ownerFromMembership(m: TenantMembership | null): {
  fullName: string;
  firstName: string;
} {
  // We don't have the user's name directly here; consumers pass user metadata
  return {
    fullName: m?.tenants.name ?? "",
    firstName: m?.tenants.name ?? "",
  };
}

export const ROLE_OPTIONS_TEAM: Array<{ value: string; label: string }> = [
  { value: "gerente", label: "Gerente" },
  { value: "vendedor", label: "Vendedor" },
  { value: "almacenista", label: "Almacenista" },
  { value: "cajero", label: "Cajero" },
];

export const SUGGESTED_ATTRIBUTES: Record<
  string,
  Array<{ key: string; label: string; type: "text" | "number" | "enum"; required: boolean; options?: string[] }>
> = {
  ferreteria: [
    { key: "calibre", label: "Calibre", type: "text", required: false },
    { key: "longitud", label: "Longitud", type: "number", required: false },
    { key: "material", label: "Material", type: "text", required: false },
    { key: "marca", label: "Marca", type: "text", required: true },
  ],
  abarrotes: [
    { key: "marca", label: "Marca", type: "text", required: true },
    { key: "presentacion", label: "Presentación", type: "text", required: false },
    { key: "categoria", label: "Categoría", type: "text", required: false },
  ],
  aluminio: [
    { key: "serie", label: "Serie", type: "text", required: true },
    { key: "color", label: "Color", type: "text", required: false },
    { key: "acabado", label: "Acabado", type: "text", required: false },
    { key: "longitud", label: "Longitud", type: "number", required: false },
  ],
  ropa: [
    { key: "talla", label: "Talla", type: "enum", required: true, options: ["XS","S","M","L","XL"] },
    { key: "color", label: "Color", type: "text", required: true },
    { key: "temporada", label: "Temporada", type: "text", required: false },
    { key: "marca", label: "Marca", type: "text", required: false },
  ],
};

export function suggestionKeyFor(businessType: string | null | undefined): string | null {
  if (!businessType) return null;
  const t = businessType.toLowerCase();
  if (t.includes("ferret")) return "ferreteria";
  if (t.includes("abarrot")) return "abarrotes";
  if (t.includes("alumin")) return "aluminio";
  if (t.includes("ropa") || t.includes("textil") || t.includes("vest")) return "ropa";
  return null;
}

export const TIMEZONES_MX = [
  "America/Mexico_City",
  "America/Cancun",
  "America/Merida",
  "America/Monterrey",
  "America/Chihuahua",
  "America/Hermosillo",
  "America/Mazatlan",
  "America/Tijuana",
];

export const PAYMENT_METHODS = [
  "Efectivo",
  "Transferencia",
  "Tarjeta de débito",
  "Tarjeta de crédito",
  "Crédito directo",
  "Otro",
];

export const RFC_REGEX = /^([A-ZÑ&]{3,4})\d{6}([A-Z\d]{3})$/i;
export const PHONE_REGEX = /^[+]?[\d\s().-]{8,20}$/;
export const URL_REGEX = /^https?:\/\/.+/i;
