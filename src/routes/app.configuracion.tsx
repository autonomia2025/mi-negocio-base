import { createFileRoute, useBlocker } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import { updateTenantSettings } from "@/utils/tenant-admin.functions";
import { TIMEZONES_MX, RFC_REGEX } from "@/lib/onboarding";

export const Route = createFileRoute("/app/configuracion")({
  component: ConfiguracionPage,
});

type TabKey = "empresa" | "marca" | "operaciones";

type FormState = {
  name: string;
  business: {
    razon_social: string;
    rfc: string;
    direccion_fiscal: string;
    telefono: string;
    correo_contacto: string;
    sitio_web: string;
    logo_url: string;
    brand_color: string;
  };
  operations: {
    moneda: "MXN" | "USD" | "EUR";
    zona_horaria: string;
    price_rounding: "0.01" | "0.05" | "0.10" | "1.00";
  };
};

const EMPTY: FormState = {
  name: "",
  business: {
    razon_social: "",
    rfc: "",
    direccion_fiscal: "",
    telefono: "",
    correo_contacto: "",
    sitio_web: "",
    logo_url: "",
    brand_color: "#378ADD",
  },
  operations: {
    moneda: "MXN",
    zona_horaria: "America/Mexico_City",
    price_rounding: "0.01",
  },
};

function ConfiguracionPage() {
  const { currentTenantId, currentMembership, memberships } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = memberships.some((m) => m.role === "super_admin" && m.is_active);
  const tenantId = impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;
  const role = impersonatingId && isSuperAdmin ? "tenant_owner" : currentMembership?.role ?? null;

  const updateFn = useServerFn(updateTenantSettings);

  const [tab, setTab] = useState<TabKey>("empresa");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [original, setOriginal] = useState<FormState>(EMPTY);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [hasSales, setHasSales] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(original) !== JSON.stringify(form),
    [original, form],
  );

  useBlocker({
    shouldBlockFn: () => {
      if (!dirty) return false;
      return !window.confirm("Tienes cambios sin guardar. ¿Salir de todas formas?");
    },
  });

  useEffect(() => {
    if (!tenantId || role !== "tenant_owner") return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, role]);

  const load = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from("tenants")
        .select("name, settings")
        .eq("id", tenantId)
        .single();
      const settings = (data?.settings ?? {}) as Record<string, unknown>;
      const business = (settings.business as Record<string, unknown>) ?? {};
      const operations = (settings.operations as Record<string, unknown>) ?? {};
      const next: FormState = {
        name: data?.name ?? "",
        business: {
          razon_social: (business.razon_social as string) ?? "",
          rfc: (business.rfc as string) ?? "",
          direccion_fiscal: (business.direccion_fiscal as string) ?? "",
          telefono: (business.telefono as string) ?? "",
          correo_contacto: (business.correo_contacto as string) ?? "",
          sitio_web: (business.sitio_web as string) ?? "",
          logo_url: (business.logo_url as string) ?? "",
          brand_color: (business.brand_color as string) ?? "#378ADD",
        },
        operations: {
          moneda: ((operations.moneda as FormState["operations"]["moneda"]) ?? "MXN"),
          zona_horaria:
            (operations.zona_horaria as string) ?? "America/Mexico_City",
          price_rounding:
            ((operations.price_rounding as FormState["operations"]["price_rounding"]) ??
              "0.01"),
        },
      };
      setForm(next);
      setOriginal(next);

      const { count } = await supabase
        .from("sales")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId);
      setHasSales((count ?? 0) > 0);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al cargar configuración");
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!tenantId) return;
    if (form.name.trim().length < 2) {
      toast.error("El nombre debe tener al menos 2 caracteres");
      return;
    }
    if (form.business.rfc && !RFC_REGEX.test(form.business.rfc)) {
      toast.error("RFC con formato inválido");
      return;
    }
    setSaving(true);
    try {
      await updateFn({
        data: {
          tenantId,
          updates: {
            name: form.name,
            settings_patch: {
              business: form.business,
              operations: form.operations,
            },
          },
        },
      });
      toast.success("Cambios guardados");
      setOriginal(form);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (file: File) => {
    if (!tenantId) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("El logo debe pesar menos de 2 MB");
      return;
    }
    const ext = file.name.split(".").pop() || "png";
    const path = `${tenantId}/logo-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from("tenant-branding")
      .upload(path, file, { upsert: true });
    if (error) {
      toast.error(error.message);
      return;
    }
    const { data } = supabase.storage.from("tenant-branding").getPublicUrl(path);
    setForm({ ...form, business: { ...form.business, logo_url: data.publicUrl } });
    toast.success("Logo cargado. Recuerda guardar.");
  };

  if (role !== "tenant_owner") {
    return (
      <div className="rounded-md border border-border bg-card p-8 text-center">
        <h2 className="text-lg font-semibold">Acceso restringido</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Solo el propietario puede modificar la configuración.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuración</h1>
        <p className="text-sm text-muted-foreground">
          Ajustes generales de tu empresa.
        </p>
      </div>

      <div className="overflow-x-auto border-b border-border">
        <div className="flex gap-1 whitespace-nowrap">
          {(
            [
              { key: "empresa", label: "Empresa" },
              { key: "marca", label: "Marca" },
              { key: "operaciones", label: "Operaciones" },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm border-b-2 -mb-px ${
                tab === t.key
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="space-y-4">
          {tab === "empresa" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Nombre de la empresa *">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </Field>
              <Field label="Razón social">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.business.razon_social}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      business: { ...form.business, razon_social: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="RFC">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm uppercase"
                  value={form.business.rfc}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      business: { ...form.business, rfc: e.target.value.toUpperCase() },
                    })
                  }
                />
              </Field>
              <Field label="Teléfono">
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.business.telefono}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      business: { ...form.business, telefono: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Correo de contacto">
                <input
                  type="email"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.business.correo_contacto}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      business: { ...form.business, correo_contacto: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Sitio web">
                <input
                  type="url"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.business.sitio_web}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      business: { ...form.business, sitio_web: e.target.value },
                    })
                  }
                />
              </Field>
              <Field label="Dirección" full>
                <textarea
                  rows={3}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.business.direccion_fiscal}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      business: { ...form.business, direccion_fiscal: e.target.value },
                    })
                  }
                />
              </Field>
            </div>
          )}

          {tab === "marca" && (
            <div className="space-y-4">
              <Field label="Logo">
                <div className="flex items-center gap-4">
                  {form.business.logo_url ? (
                    <img
                      src={form.business.logo_url}
                      alt="Logo"
                      className="h-16 w-16 rounded-md border border-border object-contain"
                    />
                  ) : (
                    <div className="flex h-16 w-16 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
                      Sin logo
                    </div>
                  )}
                  <label className="cursor-pointer rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
                    Subir nuevo logo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadLogo(f);
                      }}
                    />
                  </label>
                </div>
              </Field>
              <Field label="Color de marca">
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    className="h-10 w-20 rounded-md border border-border"
                    value={form.business.brand_color}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        business: { ...form.business, brand_color: e.target.value },
                      })
                    }
                  />
                  <input
                    type="text"
                    className="w-32 rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                    value={form.business.brand_color}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        business: { ...form.business, brand_color: e.target.value },
                      })
                    }
                  />
                </div>
              </Field>
            </div>
          )}

          {tab === "operaciones" && (
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Moneda">
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.operations.moneda}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      operations: {
                        ...form.operations,
                        moneda: e.target.value as FormState["operations"]["moneda"],
                      },
                    })
                  }
                >
                  <option value="MXN">MXN — Peso Mexicano</option>
                  <option value="USD">USD — Dólar</option>
                  <option value="EUR">EUR — Euro</option>
                </select>
                {hasSales && form.operations.moneda !== original.operations.moneda && (
                  <p className="mt-1 text-xs text-amber-700">
                    ⚠️ Ya existen ventas en {original.operations.moneda}. Cambiar la
                    moneda no convierte ni recalcula montos históricos.
                  </p>
                )}
              </Field>
              <Field label="Zona horaria">
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.operations.zona_horaria}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      operations: { ...form.operations, zona_horaria: e.target.value },
                    })
                  }
                >
                  {TIMEZONES_MX.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Redondeo de precios">
                <select
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={form.operations.price_rounding}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      operations: {
                        ...form.operations,
                        price_rounding: e.target.value as FormState["operations"]["price_rounding"],
                      },
                    })
                  }
                >
                  <option value="0.01">$0.01 — Centavos</option>
                  <option value="0.05">$0.05</option>
                  <option value="0.10">$0.10</option>
                  <option value="1.00">$1.00 — Pesos enteros</option>
                </select>
              </Field>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-border pt-4">
            {dirty ? (
              <span className="text-xs text-amber-700">● Sin guardar</span>
            ) : (
              <span className="text-xs text-muted-foreground">Sin cambios</span>
            )}
            <button
              disabled={!dirty || saving}
              onClick={() => void save()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Guardando…" : "Guardar cambios"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <label className="mb-1 block text-xs font-medium">{label}</label>
      {children}
    </div>
  );
}
