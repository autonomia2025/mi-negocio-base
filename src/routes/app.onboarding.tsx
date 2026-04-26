import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Building2,
  Boxes,
  Users,
  Settings2,
  PartyPopper,
  CheckCircle2,
  Plus,
  Trash2,
  ImagePlus,
  Loader2,
  Mail,
} from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { logAudit, slugify } from "@/lib/admin-utils";
import {
  getServerFunctionAuthHeaders,
  getServerFunctionErrorMessage,
} from "@/lib/server-function-client";
import {
  TOTAL_STEPS,
  type TenantSettings,
  PAYMENT_METHODS,
  TIMEZONES_MX,
  ROLE_OPTIONS_TEAM,
  SUGGESTED_ATTRIBUTES,
  suggestionKeyFor,
  RFC_REGEX,
  PHONE_REGEX,
  URL_REGEX,
} from "@/lib/onboarding";
import { inviteTenantUser, saveOnboardingSettings } from "@/utils/onboarding.functions";

export const Route = createFileRoute("/app/onboarding")({
  component: OnboardingWizard,
});

type AttrType = "text" | "number" | "enum";
type AttrRow = {
  label: string;
  key: string;
  type: AttrType;
  required: boolean;
  options: string[];
  keyEdited: boolean;
};
type InviteRow = {
  email: string;
  full_name: string;
  role: "gerente" | "vendedor" | "almacenista" | "cajero";
  status: "idle" | "sending" | "sent" | "error";
  error?: string;
};

type TenantRow = {
  id: string;
  name: string;
  business_type: string | null;
  settings: TenantSettings | null;
};

const STEP_ICONS = [PartyPopper, Building2, Boxes, Users, Settings2, CheckCircle2];
const STEP_TITLES = [
  "Bienvenida",
  "Datos del negocio",
  "Catálogo",
  "Tu equipo",
  "Operación",
  "Listo",
];

function OnboardingWizard() {
  const navigate = useNavigate();
  const { user, currentTenantId, currentMembership, memberships, signOut } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const isSuperAdmin = useMemo(
    () => memberships.some((m) => m.role === "super_admin" && m.is_active),
    [memberships],
  );
  const tenantId =
    impersonatingId && isSuperAdmin ? impersonatingId : currentTenantId;

  const [tenant, setTenant] = useState<TenantRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  // Step 2 (business)
  const [razonSocial, setRazonSocial] = useState("");
  const [rfc, setRfc] = useState("");
  const [direccion, setDireccion] = useState("");
  const [telefono, setTelefono] = useState("");
  const [correoContacto, setCorreoContacto] = useState("");
  const [sitioWeb, setSitioWeb] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Step 3 (catalog)
  const [catalogDescription, setCatalogDescription] = useState("");
  const [attrs, setAttrs] = useState<AttrRow[]>([]);

  // Step 4 (team)
  const [invites, setInvites] = useState<InviteRow[]>([]);

  // Step 5 (operations)
  const [moneda, setMoneda] = useState<"MXN" | "USD" | "EUR">("MXN");
  const [usaCfdi, setUsaCfdi] = useState<boolean>(false);
  const [puntoReorden, setPuntoReorden] = useState<number>(5);
  const [metodos, setMetodos] = useState<string[]>(["Efectivo"]);
  const [zona, setZona] = useState<string>("America/Mexico_City");

  const ownerFullName =
    (user?.user_metadata as { full_name?: string } | null)?.full_name ||
    user?.email?.split("@")[0] ||
    "";
  const ownerFirstName = ownerFullName.split(" ")[0] || ownerFullName;

  // Load tenant settings on mount + hydrate forms
  useEffect(() => {
    let cancelled = false;
    if (!tenantId) return;
    setLoading(true);
    void supabase
      .from("tenants")
      .select("id, name, business_type, settings")
      .eq("id", tenantId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setLoading(false);
          return;
        }
        const row = data as TenantRow;
        setTenant(row);
        const s = (row.settings ?? {}) as TenantSettings;
        if (s.onboarding_completed) {
          // Already done — bounce to /app
          void navigate({ to: "/app" });
          return;
        }
        setStep(Math.min(s.onboarding_step ?? 0, TOTAL_STEPS - 1));
        const b = s.business ?? {};
        setRazonSocial(b.razon_social ?? "");
        setRfc(b.rfc ?? "");
        setDireccion(b.direccion_fiscal ?? "");
        setTelefono(b.telefono ?? "");
        setCorreoContacto(b.correo_contacto ?? user?.email ?? "");
        setSitioWeb(b.sitio_web ?? "");
        setLogoUrl(b.logo_url ?? null);
        setCatalogDescription(b.catalog_description ?? "");

        const op = s.operations ?? {};
        setMoneda(op.moneda ?? "MXN");
        setUsaCfdi(op.usa_cfdi ?? false);
        setPuntoReorden(op.punto_reorden_default ?? 5);
        setMetodos(op.metodos_pago ?? ["Efectivo"]);
        setZona(op.zona_horaria ?? "America/Mexico_City");

        // Load default product schema if present
        void supabase
          .from("product_schemas")
          .select("attributes")
          .eq("tenant_id", row.id)
          .eq("is_default", true)
          .is("deleted_at", null)
          .maybeSingle()
          .then(({ data: ps }) => {
            if (cancelled) return;
            const arr = (ps?.attributes as unknown as Array<{
              key: string;
              label: string;
              type: AttrType;
              required?: boolean;
              options?: string[];
            }>) ?? [];
            if (arr.length > 0) {
              setAttrs(
                arr.map((a) => ({
                  key: a.key,
                  label: a.label,
                  type: a.type,
                  required: !!a.required,
                  options: a.options ?? [],
                  keyEdited: true,
                })),
              );
            }
            setLoading(false);
          });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  if (!tenantId) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }
  if (loading || !tenant) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  const persistSettings = async (
    patch: Partial<TenantSettings>,
    nextStep: number,
  ) => {
    const merged: TenantSettings = {
      ...((tenant.settings ?? {}) as TenantSettings),
      ...patch,
      onboarding_step: nextStep,
    };
    const headers = await getServerFunctionAuthHeaders();
    await saveOnboardingSettings({
      data: { tenantId: tenant.id, patch, nextStep },
      headers,
    });
    setTenant({ ...tenant, settings: merged });
    await logAudit({
      tenantId: tenant.id,
      action: "onboarding.step_completed",
      entityType: "tenant",
      entityId: tenant.id,
      changes: { step: nextStep - 1 },
    });
  };

  const validateStep = (): string | null => {
    if (step === 0) return null;
    if (step === 1) {
      if (!razonSocial.trim()) return "La razón social es obligatoria.";
      if (rfc.trim() && !RFC_REGEX.test(rfc.trim()))
        return "El RFC no tiene un formato válido.";
      if (!direccion.trim()) return "La dirección fiscal es obligatoria.";
      if (!telefono.trim() || !PHONE_REGEX.test(telefono.trim()))
        return "Ingresa un teléfono válido.";
      if (!correoContacto.trim() || !/.+@.+\..+/.test(correoContacto))
        return "Ingresa un correo de contacto válido.";
      if (sitioWeb.trim() && !URL_REGEX.test(sitioWeb.trim()))
        return "El sitio web debe iniciar con http(s)://";
      return null;
    }
    if (step === 2) {
      if (!catalogDescription.trim())
        return "Cuéntanos qué tipo de productos vendes.";
      const valid = attrs.filter((a) => a.label.trim() && a.key.trim());
      if (valid.length < 2) return "Define al menos 2 atributos para tu catálogo.";
      const keys = new Set<string>();
      for (const a of valid) {
        if (keys.has(a.key))
          return `La llave "${a.key}" se repite. Cada atributo debe tener una llave única.`;
        keys.add(a.key);
        if (a.type === "enum" && a.options.length === 0)
          return `Agrega al menos una opción al atributo "${a.label}".`;
      }
      return null;
    }
    if (step === 3) {
      // Optional step — but per-row validation if rows exist
      for (const inv of invites) {
        if (!inv.email && !inv.full_name) continue;
        if (!/.+@.+\..+/.test(inv.email))
          return "Revisa los correos: hay alguno inválido.";
        if (!inv.full_name.trim())
          return "Cada invitación necesita un nombre completo.";
      }
      return null;
    }
    if (step === 4) {
      if (puntoReorden < 0 || !Number.isFinite(puntoReorden))
        return "El punto de reorden debe ser 0 o mayor.";
      if (metodos.length === 0)
        return "Selecciona al menos un método de pago.";
      return null;
    }
    return null;
  };

  const onNext = async () => {
    setStepError(null);
    const err = validateStep();
    if (err) {
      setStepError(err);
      return;
    }
    setSaving(true);
    try {
      if (step === 0) {
        await persistSettings({}, 1);
      } else if (step === 1) {
        const business = {
          razon_social: razonSocial.trim(),
          rfc: rfc.trim() || null,
          direccion_fiscal: direccion.trim(),
          telefono: telefono.trim(),
          correo_contacto: correoContacto.trim(),
          sitio_web: sitioWeb.trim() || null,
          logo_url: logoUrl,
        };
        const prev = (tenant.settings ?? {}) as TenantSettings;
        await persistSettings(
          { business: { ...(prev.business ?? {}), ...business } },
          2,
        );
      } else if (step === 2) {
        const valid = attrs.filter((a) => a.label.trim() && a.key.trim());
        const attributesPayload = valid.map((a) => ({
          key: a.key,
          label: a.label.trim(),
          type: a.type,
          required: a.required,
          ...(a.type === "enum" ? { options: a.options } : {}),
        }));
        // Upsert default product schema
        const { data: existing } = await supabase
          .from("product_schemas")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("name", "Catálogo principal")
          .maybeSingle();
        if (existing?.id) {
          const { error } = await supabase
            .from("product_schemas")
            .update({
              attributes: attributesPayload as never,
              is_default: true,
              deleted_at: null,
            })
            .eq("id", existing.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase.from("product_schemas").insert({
            tenant_id: tenant.id,
            name: "Catálogo principal",
            attributes: attributesPayload as never,
            is_default: true,
          });
          if (error) throw new Error(error.message);
        }
        const prev = (tenant.settings ?? {}) as TenantSettings;
        await persistSettings(
          {
            business: {
              ...(prev.business ?? {}),
              catalog_description: catalogDescription.trim(),
            },
          },
          3,
        );
      } else if (step === 3) {
        // Send invitations sequentially with per-row status
        const rows = invites.filter((i) => i.email && i.full_name);
        for (let i = 0; i < rows.length; i++) {
          const idx = invites.indexOf(rows[i]);
          setInvites((prev) =>
            prev.map((r, j) => (j === idx ? { ...r, status: "sending", error: undefined } : r)),
          );
          try {
            await inviteTenantUser({
              data: {
                tenantId: tenant.id,
                email: rows[i].email.trim(),
                full_name: rows[i].full_name.trim(),
                role: rows[i].role,
              },
            });
            setInvites((prev) =>
              prev.map((r, j) => (j === idx ? { ...r, status: "sent" } : r)),
            );
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Error al invitar";
            setInvites((prev) =>
              prev.map((r, j) => (j === idx ? { ...r, status: "error", error: msg } : r)),
            );
          }
        }
        await persistSettings({}, 4);
      } else if (step === 4) {
        const operations = {
          moneda,
          usa_cfdi: usaCfdi,
          punto_reorden_default: puntoReorden,
          metodos_pago: metodos,
          zona_horaria: zona,
        };
        await persistSettings({ operations }, 5);
      } else if (step === 5) {
        // Finish
        const merged: TenantSettings = {
          ...((tenant.settings ?? {}) as TenantSettings),
          onboarding_completed: true,
          onboarding_completed_at: new Date().toISOString(),
          onboarding_step: TOTAL_STEPS - 1,
        };
        const headers = await getServerFunctionAuthHeaders();
        await saveOnboardingSettings({
          data: {
            tenantId: tenant.id,
            patch: {
              onboarding_completed: true,
              onboarding_completed_at: merged.onboarding_completed_at,
            },
            nextStep: TOTAL_STEPS - 1,
          },
          headers,
        });
        await logAudit({
          tenantId: tenant.id,
          action: "onboarding.completed",
          entityType: "tenant",
          entityId: tenant.id,
        });
        void navigate({ to: "/app" });
        return;
      }
      setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
    } catch (e) {
      setStepError(getServerFunctionErrorMessage(e, "Error al guardar"));
    } finally {
      setSaving(false);
    }
  };

  const onPrev = () => {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  };

  const onSaveAndExit = async () => {
    // Persist current step number; current data has been persisted on each Next.
    // Try to also persist current in-flight values for the active step (best effort, no validation).
    try {
      await persistSettings({}, step);
    } catch {
      // ignore — not blocking exit
    }
    if (memberships.length > 1) {
      void navigate({ to: "/select-tenant" });
    } else {
      await signOut();
      void navigate({ to: "/login" });
    }
  };

  // ---- Step 2 logo upload ----
  const onLogoChange = async (e: ChangeEvent<HTMLInputElement>) => {
    setLogoError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setLogoError("El archivo no debe exceder 2 MB.");
      return;
    }
    const allowed = ["image/png", "image/jpeg", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      setLogoError("Formato no permitido. Usa PNG, JPG o SVG.");
      return;
    }
    setUploadingLogo(true);
    try {
      const ext =
        file.type === "image/png"
          ? "png"
          : file.type === "image/svg+xml"
            ? "svg"
            : "jpg";
      const path = `${tenant.id}/logo.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("tenant-branding")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw new Error(upErr.message);
      const { data: pub } = supabase.storage
        .from("tenant-branding")
        .getPublicUrl(path);
      // Cache-bust by appending t param
      setLogoUrl(`${pub.publicUrl}?t=${Date.now()}`);
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : "Error al subir");
    } finally {
      setUploadingLogo(false);
    }
  };

  // ---- Step 3 attributes helpers ----
  const addAttr = () =>
    setAttrs((a) => [
      ...a,
      {
        label: "",
        key: "",
        type: "text",
        required: false,
        options: [],
        keyEdited: false,
      },
    ]);
  const removeAttr = (i: number) =>
    setAttrs((a) => a.filter((_, idx) => idx !== i));
  const updateAttr = (i: number, patch: Partial<AttrRow>) =>
    setAttrs((a) =>
      a.map((row, idx) => {
        if (idx !== i) return row;
        const next = { ...row, ...patch };
        if (patch.label !== undefined && !row.keyEdited) {
          next.key = slugify(patch.label).replace(/-/g, "_");
        }
        return next;
      }),
    );

  const applySuggestedTemplate = () => {
    const key = suggestionKeyFor(tenant.business_type);
    if (!key) return;
    const tpl = SUGGESTED_ATTRIBUTES[key];
    setAttrs(
      tpl.map((a) => ({
        label: a.label,
        key: a.key,
        type: a.type,
        required: a.required,
        options: a.options ?? [],
        keyEdited: true,
      })),
    );
  };

  // ---- Step 4 invites helpers ----
  const addInvite = () =>
    setInvites((rows) => [
      ...rows,
      { email: "", full_name: "", role: "vendedor", status: "idle" },
    ]);
  const removeInvite = (i: number) =>
    setInvites((rows) => rows.filter((_, idx) => idx !== i));
  const updateInvite = (i: number, patch: Partial<InviteRow>) =>
    setInvites((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const toggleMetodo = (m: string) =>
    setMetodos((arr) =>
      arr.includes(m) ? arr.filter((x) => x !== m) : [...arr, m],
    );

  const suggestedKey = suggestionKeyFor(tenant.business_type);

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pb-16 pt-8 sm:pt-12">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Configuración inicial · {tenant.name}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            Paso {step + 1} de {TOTAL_STEPS} · {STEP_TITLES[step]}
          </h1>
        </div>
        <button
          onClick={() => void onSaveAndExit()}
          className="text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          Guardar y salir
        </button>
      </div>

      {/* Progress with tick marks */}
      <ol className="mb-8 grid grid-cols-6 gap-1.5">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => {
          const Icon = STEP_ICONS[i];
          const completed = i < step;
          const active = i === step;
          return (
            <li key={i} className="flex flex-col items-center gap-1.5">
              <div
                className={[
                  "h-1.5 w-full rounded-full transition-colors",
                  completed
                    ? "bg-primary"
                    : active
                      ? "bg-primary/60"
                      : "bg-border",
                ].join(" ")}
              />
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                {completed ? (
                  <CheckCircle2 className="h-3 w-3 text-primary" />
                ) : (
                  <Icon
                    className={`h-3 w-3 ${active ? "text-foreground" : "text-muted-foreground"}`}
                  />
                )}
                <span className="hidden sm:inline">{STEP_TITLES[i]}</span>
              </div>
            </li>
          );
        })}
      </ol>

      {/* Step body */}
      <div className="rounded-lg border border-border bg-card p-6 sm:p-8">
        {step === 0 && (
          <div className="space-y-5">
            <div className="flex items-center justify-center">
              <div className="rounded-full bg-accent p-4">
                <PartyPopper className="h-8 w-8 text-primary" />
              </div>
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold text-foreground">
                Bienvenido a tu ERP{ownerFullName ? `, ${ownerFullName}` : ""}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Vamos a configurar tu empresa en unos 10-15 minutos. Puedes
                guardar y continuar después si lo necesitas.
              </p>
            </div>
            <ul className="mx-auto max-w-sm space-y-2 text-sm text-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                Datos de tu negocio
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                Qué tipo de productos vendes
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                Tu equipo (opcional)
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />
                Cómo operas (moneda, pagos, reorden)
              </li>
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <Field label="Razón social" required>
              <input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                className={inputCls}
                placeholder="Mi empresa, S.A. de C.V."
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="RFC" hint="Opcional">
                <input
                  value={rfc}
                  onChange={(e) => setRfc(e.target.value.toUpperCase())}
                  className={inputCls}
                  placeholder="ABC123456XYZ"
                  maxLength={13}
                />
              </Field>
              <Field label="Teléfono" required>
                <input
                  value={telefono}
                  onChange={(e) => setTelefono(e.target.value)}
                  className={inputCls}
                  placeholder="55 1234 5678"
                />
              </Field>
            </div>
            <Field label="Dirección fiscal" required>
              <textarea
                value={direccion}
                onChange={(e) => setDireccion(e.target.value)}
                className={`${inputCls} min-h-[80px]`}
                placeholder="Calle, número, colonia, CP, ciudad, estado"
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Correo de contacto" required>
                <input
                  type="email"
                  value={correoContacto}
                  onChange={(e) => setCorreoContacto(e.target.value)}
                  className={inputCls}
                  placeholder="contacto@miempresa.mx"
                />
              </Field>
              <Field label="Sitio web" hint="Opcional">
                <input
                  value={sitioWeb}
                  onChange={(e) => setSitioWeb(e.target.value)}
                  className={inputCls}
                  placeholder="https://miempresa.mx"
                />
              </Field>
            </div>
            <Field label="Logo" hint="PNG, JPG o SVG · máx. 2 MB">
              <div className="flex items-center gap-4">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                  {logoUrl ? (
                    <img src={logoUrl} alt="Logo" className="h-full w-full object-contain" />
                  ) : (
                    <ImagePlus className="h-6 w-6 text-muted-foreground" />
                  )}
                </div>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent">
                  {uploadingLogo ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="h-4 w-4" />
                  )}
                  {logoUrl ? "Cambiar logo" : "Subir logo"}
                  <input
                    type="file"
                    accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={onLogoChange}
                  />
                </label>
              </div>
              {logoError && (
                <p className="mt-2 text-xs text-destructive">{logoError}</p>
              )}
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <Field
              label="¿Qué tipo de productos vendes?"
              hint="Esto nos ayudará a sugerirte mejores configuraciones."
              required
            >
              <textarea
                value={catalogDescription}
                onChange={(e) => setCatalogDescription(e.target.value)}
                className={`${inputCls} min-h-[88px]`}
                placeholder="Ej. Vendemos perfiles de aluminio y herrajes para canceles de baño"
              />
            </Field>

            <div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Define los atributos de tus productos
                  </h3>
                  <p className="mt-1 max-w-prose text-xs text-muted-foreground">
                    Los atributos son las características que distinguen tus
                    productos. Por ejemplo, si vendes playeras, los atributos
                    podrían ser Talla, Color y Marca.
                  </p>
                </div>
                {suggestedKey && attrs.length === 0 && (
                  <button
                    onClick={applySuggestedTemplate}
                    className="shrink-0 rounded-md border border-input bg-background px-3 py-1.5 text-xs hover:bg-accent"
                  >
                    Usar plantilla sugerida
                  </button>
                )}
              </div>

              <div className="mt-4 space-y-3">
                {attrs.length === 0 && (
                  <div className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                    Aún no has definido atributos. Agrega al menos 2 para
                    continuar.
                  </div>
                )}
                {attrs.map((a, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-background p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Etiqueta
                        </label>
                        <input
                          value={a.label}
                          onChange={(e) =>
                            updateAttr(i, { label: e.target.value })
                          }
                          className={inputCls}
                          placeholder="Ej. Color"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Llave
                        </label>
                        <input
                          value={a.key}
                          onChange={(e) =>
                            updateAttr(i, {
                              key: e.target.value
                                .toLowerCase()
                                .replace(/[^a-z0-9_]/g, "_"),
                              keyEdited: true,
                            })
                          }
                          className={`${inputCls} font-mono text-xs`}
                          placeholder="color"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Tipo
                        </label>
                        <select
                          value={a.type}
                          onChange={(e) =>
                            updateAttr(i, { type: e.target.value as AttrType })
                          }
                          className={inputCls}
                        >
                          <option value="text">Texto</option>
                          <option value="number">Número</option>
                          <option value="enum">Lista de opciones</option>
                        </select>
                      </div>
                      <div className="flex items-end justify-between gap-2 sm:col-span-2">
                        <label className="flex items-center gap-1.5 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={a.required}
                            onChange={(e) =>
                              updateAttr(i, { required: e.target.checked })
                            }
                          />
                          Requerido
                        </label>
                        <button
                          onClick={() => removeAttr(i)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                          aria-label="Eliminar atributo"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {a.type === "enum" && (
                      <div className="mt-2">
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Opciones (separadas por coma)
                        </label>
                        <input
                          value={a.options.join(", ")}
                          onChange={(e) =>
                            updateAttr(i, {
                              options: e.target.value
                                .split(",")
                                .map((s) => s.trim())
                                .filter(Boolean),
                            })
                          }
                          className={inputCls}
                          placeholder="blanco, negro, gris"
                        />
                      </div>
                    )}
                  </div>
                ))}

                <button
                  onClick={addAttr}
                  className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent"
                >
                  <Plus className="h-4 w-4" />
                  Agregar atributo
                </button>
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-base font-medium text-foreground">
                Invita a tu equipo
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Puedes hacerlo después. Enviaremos un correo de invitación a
                cada persona para que cree su contraseña.
              </p>
            </div>

            {invites.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
                Aún no has agregado a nadie. Puedes saltar este paso y hacerlo
                más tarde.
              </div>
            ) : (
              <div className="space-y-3">
                {invites.map((row, i) => (
                  <div
                    key={i}
                    className="rounded-md border border-border bg-background p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-12">
                      <div className="sm:col-span-4">
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Correo
                        </label>
                        <input
                          type="email"
                          value={row.email}
                          onChange={(e) =>
                            updateInvite(i, { email: e.target.value })
                          }
                          className={inputCls}
                          placeholder="persona@miempresa.mx"
                        />
                      </div>
                      <div className="sm:col-span-4">
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Nombre completo
                        </label>
                        <input
                          value={row.full_name}
                          onChange={(e) =>
                            updateInvite(i, { full_name: e.target.value })
                          }
                          className={inputCls}
                          placeholder="Nombre y apellidos"
                        />
                      </div>
                      <div className="sm:col-span-3">
                        <label className="mb-1 block text-[11px] uppercase tracking-wide text-muted-foreground">
                          Rol
                        </label>
                        <select
                          value={row.role}
                          onChange={(e) =>
                            updateInvite(i, {
                              role: e.target.value as InviteRow["role"],
                            })
                          }
                          className={inputCls}
                        >
                          {ROLE_OPTIONS_TEAM.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end justify-end sm:col-span-1">
                        <button
                          onClick={() => removeInvite(i)}
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-destructive"
                          aria-label="Quitar"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {row.status !== "idle" && (
                      <div className="mt-2 text-xs">
                        {row.status === "sending" && (
                          <span className="inline-flex items-center gap-1 text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Enviando…
                          </span>
                        )}
                        {row.status === "sent" && (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <Mail className="h-3 w-3" /> Invitación enviada
                          </span>
                        )}
                        {row.status === "error" && (
                          <span className="text-destructive">{row.error}</span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                onClick={addInvite}
                className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-input bg-background px-3 py-2 text-sm text-foreground hover:bg-accent"
              >
                <Plus className="h-4 w-4" />
                Agregar persona
              </button>
              {invites.length > 0 && (
                <button
                  onClick={() => setInvites([])}
                  className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  Saltar este paso
                </button>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Moneda">
                <select
                  value={moneda}
                  onChange={(e) =>
                    setMoneda(e.target.value as "MXN" | "USD" | "EUR")
                  }
                  className={inputCls}
                >
                  <option value="MXN">Peso mexicano (MXN)</option>
                  <option value="USD">Dólar (USD)</option>
                  <option value="EUR">Euro (EUR)</option>
                </select>
              </Field>
              <Field label="Zona horaria">
                <select
                  value={zona}
                  onChange={(e) => setZona(e.target.value)}
                  className={inputCls}
                >
                  {TIMEZONES_MX.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="¿Emites facturas fiscales (CFDI)?">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="cfdi"
                    checked={usaCfdi}
                    onChange={() => setUsaCfdi(true)}
                  />
                  Sí, emitimos facturas fiscales
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="cfdi"
                    checked={!usaCfdi}
                    onChange={() => setUsaCfdi(false)}
                  />
                  No, solo comprobantes internos
                </label>
              </div>
              {usaCfdi && (
                <div className="mt-3 rounded-md border border-border bg-accent/40 p-3 text-xs text-foreground">
                  La integración con el SAT estará disponible próximamente. Por
                  ahora generaremos comprobantes PDF internos y cuando esté
                  lista la integración CFDI, tus datos fiscales ya estarán
                  configurados.
                </div>
              )}
            </Field>

            <Field
              label="Punto de reorden por defecto"
              hint="Se usará al crear nuevos productos."
            >
              <input
                type="number"
                min={0}
                value={puntoReorden}
                onChange={(e) => setPuntoReorden(Number(e.target.value))}
                className={`${inputCls} max-w-[160px]`}
              />
            </Field>

            <Field label="Métodos de pago aceptados">
              <div className="grid gap-2 sm:grid-cols-2">
                {PAYMENT_METHODS.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={metodos.includes(m)}
                      onChange={() => toggleMetodo(m)}
                    />
                    {m}
                  </label>
                ))}
              </div>
            </Field>
          </div>
        )}

        {step === 5 && (
          <div className="space-y-5">
            <div className="text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
                <CheckCircle2 className="h-7 w-7 text-primary" />
              </div>
              <h2 className="text-xl font-semibold text-foreground">
                Todo listo{ownerFirstName ? `, ${ownerFirstName}` : ""}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Tu ERP está configurado. Ahora puedes empezar a cargar tu
                catálogo de productos.
              </p>
            </div>

            <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
              <dl className="grid gap-2 sm:grid-cols-2">
                <SummaryRow label="Razón social" value={razonSocial} />
                <SummaryRow label="Teléfono" value={telefono} />
                <SummaryRow label="Correo" value={correoContacto} />
                <SummaryRow
                  label="Atributos"
                  value={`${attrs.filter((a) => a.label && a.key).length} definidos`}
                />
                <SummaryRow
                  label="Invitaciones enviadas"
                  value={String(invites.filter((i) => i.status === "sent").length)}
                />
                <SummaryRow label="Moneda" value={moneda} />
                <SummaryRow
                  label="Métodos de pago"
                  value={metodos.join(", ") || "—"}
                />
                <SummaryRow label="Zona horaria" value={zona} />
              </dl>
            </div>
          </div>
        )}

        {stepError && (
          <div className="mt-5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {stepError}
          </div>
        )}
      </div>

      {/* Footer nav */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onPrev}
          disabled={step === 0 || saving}
          className="rounded-md border border-input bg-background px-4 py-2 text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          onClick={() => void onNext()}
          disabled={saving || !!validateStep()}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {step === 0
            ? "Comenzar"
            : step === TOTAL_STEPS - 1
              ? "Entrar a mi ERP"
              : "Siguiente"}
        </button>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none transition focus:ring-2 focus:ring-ring";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-baseline justify-between text-sm font-medium text-foreground">
        <span>
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </span>
        {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
      </label>
      {children}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/60 py-1.5 last:border-0 sm:border-0">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-right text-sm text-foreground">{value || "—"}</dd>
    </div>
  );
}