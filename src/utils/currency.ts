import type { OnboardingSettings } from "@/lib/onboarding";

export type CurrencyCode = "MXN" | "USD" | "EUR";

export function formatCurrency(value: number | string | null | undefined, currency: CurrencyCode = "MXN"): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  const safe = Number.isFinite(n) ? (n as number) : 0;
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safe);
}

export function getTenantCurrency(settings: unknown): CurrencyCode {
  if (!settings || typeof settings !== "object") return "MXN";
  const s = settings as OnboardingSettings;
  const m = s.operations?.moneda;
  if (m === "MXN" || m === "USD" || m === "EUR") return m;
  return "MXN";
}

export function formatNumber(value: number | string | null | undefined, fractionDigits = 2): string {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  const safe = Number.isFinite(n) ? (n as number) : 0;
  return new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(safe);
}