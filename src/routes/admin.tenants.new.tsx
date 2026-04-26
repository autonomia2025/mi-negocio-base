import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Check, Copy, ChevronLeft, ChevronRight } from "lucide-react";
import {
  PLAN_AI_LIMITS,
  PLAN_LABELS,
  PLAN_PRICES_MXN,
  formatMXN,
  generatePassword,
  slugify,
} from "@/lib/admin-utils";
import { createTenantWithOwner } from "@/utils/admin.functions";

export const Route = createFileRoute("/admin/tenants/new")({
  component: NewTenantWizard,
});

type Plan = "basico" | "profesional" | "empresarial";
type Status = "trial" | "active";

function NewTenantWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugDirty, setSlugDirty] = useState(false);
  const [businessType, setBusinessType] = useState("");

  // Step 2
  const [plan, setPlan] = useState<Plan>("profesional");
  const [status, setStatus] = useState<Status>("trial");
  const defaultTrial = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  }, []);
  const [trialDate, setTrialDate] = useState<string>(defaultTrial);
  const [aiLimit, setAiLimit] = useState<number>(PLAN_AI_LIMITS["profesional"]);

  // Step 3
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [password, setPassword] = useState(() => generatePassword(16));
  const [copied, setCopied] = useState(false);

  // Step 4
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto slug
  useEffect(() => {
    if (!slugDirty) setSlug(slugify(name));
  }, [name, slugDirty]);

  // AI limit follows plan
  useEffect(() => {
    setAiLimit(PLAN_AI_LIMITS[plan]);
  }, [plan]);

  const canNext1 = name.trim().length >= 2 && /^[a-z0-9-]{2,60}$/.test(slug);
  const canNext2 =
    !!plan && !!status && (status !== "trial" || !!trialDate) && aiLimit >= 0;
  const canNext3 =
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(ownerEmail) &&
    ownerName.trim().length >= 2 &&
    password.length >= 10;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = (await createTenantWithOwner({
        data: {
          name: name.trim(),
          slug: slug.trim(),
          business_type: businessType.trim() || null,
          subscription_plan: plan,
          subscription_status: status,
          trial_ends_at:
            status === "trial"
              ? new Date(trialDate + "T23:59:59Z").toISOString()
              : null,
          ai_ops_limit: aiLimit,
          owner: {
            email: ownerEmail.trim(),
            full_name: ownerName.trim(),
            phone: ownerPhone.trim() || null,
            password,
          },
        },
      })) as unknown;
      // TanStack server fns can return either the payload directly or { result: payload }
      const payload =
        res && typeof res === "object" && "tenantId" in (res as Record<string, unknown>)
          ? (res as { tenantId?: unknown })
          : res && typeof res === "object" && "result" in (res as Record<string, unknown>)
            ? ((res as { result: { tenantId?: unknown } }).result ?? {})
            : {};
      const tenantId = (payload as { tenantId?: unknown }).tenantId;
      if (!tenantId || typeof tenantId !== "string") {
        console.error("createTenantWithOwner unexpected response:", res);
        throw new Error(
          "La creación no devolvió un id de tenant válido. Revisa la consola para ver la respuesta cruda.",
        );
      }
      void navigate({ to: "/admin/tenants/$id", params: { id: tenantId } });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSubmitting(false);
    }
  };

  const copyPassword = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          to="/admin/tenants"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← Volver a tenants
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          Nuevo tenant
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Completa los pasos para crear el cliente y su usuario dueño.
        </p>
      </div>

      <Stepper step={step} />

      <div className="rounded-lg border border-border bg-card p-6">
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-base font-medium text-foreground">
              Información del negocio
            </h2>
            <Field label="Nombre">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={120}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Slug" help="Letras, números y guiones. Se usa en URLs.">
              <input
                value={slug}
                onChange={(e) => {
                  setSlugDirty(true);
                  setSlug(e.target.value.toLowerCase());
                }}
                maxLength={60}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
            <Field label="Tipo de negocio (opcional)">
              <input
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value)}
                maxLength={120}
                placeholder="Ej. tienda de abarrotes, ferretería…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-5">
            <h2 className="text-base font-medium text-foreground">
              Plan y suscripción
            </h2>
            <div>
              <div className="mb-2 text-sm font-medium text-foreground">Plan</div>
              <div className="grid gap-2 sm:grid-cols-3">
                {(["basico", "profesional", "empresarial"] as Plan[]).map((p) => (
                  <label
                    key={p}
                    className={`cursor-pointer rounded-md border p-3 text-sm ${plan === p ? "border-primary ring-1 ring-primary" : "border-border"}`}
                  >
                    <input
                      type="radio"
                      name="plan"
                      value={p}
                      checked={plan === p}
                      onChange={() => setPlan(p)}
                      className="sr-only"
                    />
                    <div className="font-medium text-foreground">{PLAN_LABELS[p]}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatMXN(PLAN_PRICES_MXN[p])} / mes
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {PLAN_AI_LIMITS[p].toLocaleString("es-MX")} AI ops
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-sm font-medium text-foreground">Estado</div>
              <div className="flex gap-3">
                {(["trial", "active"] as Status[]).map((s) => (
                  <label
                    key={s}
                    className={`flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm ${status === s ? "border-primary ring-1 ring-primary" : "border-border"}`}
                  >
                    <input
                      type="radio"
                      name="status"
                      value={s}
                      checked={status === s}
                      onChange={() => setStatus(s)}
                    />
                    {s === "trial" ? "Prueba" : "Activo"}
                  </label>
                ))}
              </div>
            </div>
            {status === "trial" && (
              <Field label="Fin del trial">
                <input
                  type="date"
                  value={trialDate}
                  onChange={(e) => setTrialDate(e.target.value)}
                  className="rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </Field>
            )}
            <Field label="Límite de AI ops">
              <input
                type="number"
                min={0}
                value={aiLimit}
                onChange={(e) => setAiLimit(parseInt(e.target.value || "0", 10))}
                className="w-40 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <h2 className="text-base font-medium text-foreground">
              Usuario dueño inicial
            </h2>
            <Field label="Correo electrónico">
              <input
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                maxLength={255}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Nombre completo">
              <input
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                maxLength={160}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Teléfono (opcional)">
              <input
                value={ownerPhone}
                onChange={(e) => setOwnerPhone(e.target.value)}
                maxLength={40}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field
              label="Contraseña generada"
              help="Compártela de forma segura. El usuario podrá cambiarla luego."
            >
              <div className="flex gap-2">
                <input
                  readOnly
                  value={password}
                  className="flex-1 rounded-md border border-input bg-muted px-3 py-2 text-sm font-mono"
                />
                <button
                  type="button"
                  onClick={() => setPassword(generatePassword(16))}
                  className="rounded-md border border-input bg-background px-3 text-xs text-foreground hover:bg-accent"
                >
                  Regenerar
                </button>
                <button
                  type="button"
                  onClick={() => void copyPassword()}
                  className="inline-flex items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copiado" : "Copiar"}
                </button>
              </div>
            </Field>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <h2 className="text-base font-medium text-foreground">
              Resumen y confirmación
            </h2>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Summary k="Nombre" v={name} />
              <Summary k="Slug" v={slug} />
              <Summary k="Tipo" v={businessType || "—"} />
              <Summary k="Plan" v={PLAN_LABELS[plan]} />
              <Summary
                k="Estado"
                v={status === "trial" ? `Prueba hasta ${trialDate}` : "Activo"}
              />
              <Summary k="AI ops" v={aiLimit.toLocaleString("es-MX")} />
              <Summary k="MRR" v={formatMXN(status === "active" ? PLAN_PRICES_MXN[plan] : 0)} />
              <Summary k="Dueño" v={`${ownerName} <${ownerEmail}>`} />
            </dl>
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="mt-8 flex items-center justify-between border-t border-border pt-4">
          <button
            disabled={step === 1 || submitting}
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" /> Anterior
          </button>
          {step < 4 ? (
            <button
              disabled={
                (step === 1 && !canNext1) ||
                (step === 2 && !canNext2) ||
                (step === 3 && !canNext3)
              }
              onClick={() => setStep((s) => s + 1)}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              Siguiente <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              disabled={submitting}
              onClick={() => void submit()}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {submitting ? "Creando…" : "Crear tenant"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  const labels = ["Negocio", "Plan", "Dueño", "Resumen"];
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs">
      {labels.map((l, i) => {
        const n = i + 1;
        const active = n === step;
        const done = n < step;
        return (
          <li key={l} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border ${active ? "border-primary bg-primary text-primary-foreground" : done ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}
            >
              {n}
            </span>
            <span className={active ? "font-medium text-foreground" : "text-muted-foreground"}>
              {l}
            </span>
            {n < labels.length && <span className="mx-1 text-border">/</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

function Summary({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md border border-border bg-background px-3 py-2">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{k}</dt>
      <dd className="mt-0.5 text-sm text-foreground break-words">{v}</dd>
    </div>
  );
}