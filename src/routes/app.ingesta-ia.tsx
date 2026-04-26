import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Mic, MessageSquare, Sparkles, Trash2, Plus, ArrowLeft, MicOff } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-context";
import { useImpersonatingTenantId } from "@/lib/impersonation";
import { supabase } from "@/integrations/supabase/client";
import {
  extractFromText,
  extractFromImage,
  confirmIngestion,
  discardIngestion,
  searchProductForIngestion,
  readAiQuota,
  getAiQuotaColor,
  getAiQuotaPct,
  formatAiQuota,
  aiErrorMessage,
  INTENT_LABELS,
  INTENT_ICONS,
  type ExtractedData,
  type ExtractedItem,
  type Intent,
} from "@/utils/ai";
import { PAYMENT_METHODS, PAYMENT_LABELS, type PaymentMethod } from "@/utils/sales";

export const Route = createFileRoute("/app/ingesta-ia")({
  component: IngestaIAPage,
});

type Mode = "capture" | "confirm";
type Tab = "foto" | "voz" | "texto";

const PROCESSING_TEXT_MESSAGES = [
  "La IA está leyendo tu mensaje...",
  "Identificando productos y cantidades...",
  "Estructurando los datos...",
];
const PROCESSING_IMAGE_MESSAGES = [
  "Subiendo imagen...",
  "La IA está leyendo el ticket...",
  "Estructurando los datos...",
];

function IngestaIAPage() {
  const navigate = useNavigate();
  const { currentTenantId } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const tenantId = impersonatingId ?? currentTenantId;

  const [mode, setMode] = useState<Mode>("capture");
  const [tab, setTab] = useState<Tab>("texto");
  const [quota, setQuota] = useState<{ used: number; limit: number } | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processingMsgIdx, setProcessingMsgIdx] = useState(0);

  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [ingestionId, setIngestionId] = useState<string | null>(null);
  const [originalInput, setOriginalInput] = useState<{
    kind: "text" | "photo";
    text?: string;
    imagePath?: string;
  } | null>(null);

  const loadQuota = async () => {
    if (!tenantId) return;
    const { data } = await supabase.from("tenants").select("settings").eq("id", tenantId).maybeSingle();
    const q = readAiQuota(data?.settings ?? {});
    setQuota({ used: q.used_current_month, limit: q.limit_monthly });
  };

  useEffect(() => {
    void loadQuota();
  }, [tenantId]);

  // Rotating processing messages
  useEffect(() => {
    if (!processing) return;
    setProcessingMsgIdx(0);
    const id = window.setInterval(() => {
      setProcessingMsgIdx((i) => i + 1);
    }, 2000);
    return () => window.clearInterval(id);
  }, [processing]);

  const quotaPct = quota ? getAiQuotaPct(quota.used, quota.limit) : 0;
  const quotaColor = quota ? getAiQuotaColor(quota.used, quota.limit) : "green";
  const quotaExhausted = quota ? quota.used >= quota.limit : false;

  const onExtractedFromText = (text: string, ingId: string, ext: ExtractedData) => {
    setOriginalInput({ kind: "text", text });
    setIngestionId(ingId);
    setExtractedData(ext);
    setMode("confirm");
    void loadQuota();
  };

  const onExtractedFromImage = (imagePath: string, ingId: string, ext: ExtractedData) => {
    setOriginalInput({ kind: "photo", imagePath });
    setIngestionId(ingId);
    setExtractedData(ext);
    setMode("confirm");
    void loadQuota();
  };

  if (!tenantId) {
    return <div className="text-sm text-muted-foreground">Cargando…</div>;
  }

  if (mode === "confirm" && extractedData && ingestionId) {
    return (
      <ConfirmScreen
        tenantId={tenantId}
        ingestionId={ingestionId}
        initialData={extractedData}
        originalInput={originalInput}
        onBack={() => setMode("capture")}
        onDone={() => {
          setMode("capture");
          setExtractedData(null);
          setIngestionId(null);
          setOriginalInput(null);
          void loadQuota();
        }}
        navigate={navigate}
      />
    );
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-foreground">
          <Sparkles className="h-6 w-6 text-primary" />
          Ingesta inteligente
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Registra movimientos por foto, voz o texto.
        </p>
      </header>

      {/* Quota indicator */}
      <div className="sticky top-0 z-10 -mx-6 border-b border-border bg-background/95 px-6 py-3 backdrop-blur">
        {quota === null ? (
          <div className="text-xs text-muted-foreground">Cargando cuota…</div>
        ) : (
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Operaciones IA: <span className="font-medium text-foreground">{formatAiQuota(quota.used, quota.limit)}</span> este mes
              </span>
              <span className={`font-semibold ${quotaColor === "red" ? "text-rose-600" : quotaColor === "amber" ? "text-amber-600" : "text-emerald-600"}`}>
                {quotaPct}%
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full transition-all ${quotaColor === "red" ? "bg-rose-500" : quotaColor === "amber" ? "bg-amber-500" : "bg-emerald-500"}`}
                style={{ width: `${quotaPct}%` }}
              />
            </div>
            {quotaExhausted && (
              <div className="mt-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
                Has alcanzado el límite mensual. Contacta a tu administrador.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-card p-1">
        <TabButton active={tab === "foto"} onClick={() => setTab("foto")} icon={<Camera className="h-4 w-4" />} label="Foto" />
        <TabButton active={tab === "voz"} onClick={() => setTab("voz")} icon={<Mic className="h-4 w-4" />} label="Voz" />
        <TabButton active={tab === "texto"} onClick={() => setTab("texto")} icon={<MessageSquare className="h-4 w-4" />} label="Texto" />
      </div>

      {/* Tab content */}
      <div className="rounded-lg border border-border bg-card p-5">
        {tab === "texto" && (
          <TextTab
            tenantId={tenantId}
            disabled={quotaExhausted || processing}
            processing={processing}
            processingMsg={PROCESSING_TEXT_MESSAGES[processingMsgIdx % PROCESSING_TEXT_MESSAGES.length]}
            onProcessingChange={setProcessing}
            onExtracted={onExtractedFromText}
          />
        )}
        {tab === "foto" && (
          <PhotoTab
            tenantId={tenantId}
            disabled={quotaExhausted || processing}
            processing={processing}
            processingMsg={PROCESSING_IMAGE_MESSAGES[processingMsgIdx % PROCESSING_IMAGE_MESSAGES.length]}
            onProcessingChange={setProcessing}
            onExtracted={onExtractedFromImage}
          />
        )}
        {tab === "voz" && (
          <VoiceTab
            tenantId={tenantId}
            disabled={quotaExhausted || processing}
            processing={processing}
            processingMsg={PROCESSING_TEXT_MESSAGES[processingMsgIdx % PROCESSING_TEXT_MESSAGES.length]}
            onProcessingChange={setProcessing}
            onExtracted={onExtractedFromText}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium transition ${
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/* ==================== TEXT TAB ==================== */
function TextTab({
  tenantId,
  disabled,
  processing,
  processingMsg,
  onProcessingChange,
  onExtracted,
}: {
  tenantId: string;
  disabled: boolean;
  processing: boolean;
  processingMsg: string;
  onProcessingChange: (b: boolean) => void;
  onExtracted: (text: string, ingestionId: string, ext: ExtractedData) => void;
}) {
  const [text, setText] = useState("");

  const submit = async () => {
    if (text.trim().length < 3) return;
    onProcessingChange(true);
    try {
      const r = await extractFromText(tenantId, text.trim());
      onExtracted(text.trim(), r.ingestionId, r.extracted);
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      onProcessingChange(false);
    }
  };

  return (
    <div className="space-y-3">
      <textarea
        rows={6}
        maxLength={2000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        placeholder="Ejemplo: Llegaron 50 cajas de pasta Corona a 18 pesos cada una del proveedor La Moderna"
        className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
      />
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{text.length}/2000</span>
        {processing && <span className="text-primary">{processingMsg}</span>}
      </div>
      <button
        onClick={() => void submit()}
        disabled={disabled || text.trim().length < 3}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        <Sparkles className="h-4 w-4" />
        {processing ? "Procesando…" : "Procesar con IA"}
      </button>
    </div>
  );
}

/* ==================== PHOTO TAB ==================== */
function PhotoTab({
  tenantId,
  disabled,
  processing,
  processingMsg,
  onProcessingChange,
  onExtracted,
}: {
  tenantId: string;
  disabled: boolean;
  processing: boolean;
  processingMsg: string;
  onProcessingChange: (b: boolean) => void;
  onExtracted: (imagePath: string, ingestionId: string, ext: ExtractedData) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      toast.error("La imagen es muy grande, máximo 5MB. Tómala con menor resolución.");
      e.target.value = "";
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => setPreview(reader.result as string);
    reader.readAsDataURL(f);
  };

  const submit = async () => {
    if (!file) return;
    onProcessingChange(true);
    try {
      const r = await extractFromImage(tenantId, file);
      onExtracted(r.imagePath, r.ingestionId, r.extracted);
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      onProcessingChange(false);
    }
  };

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={onFileChange}
        className="hidden"
      />
      {!preview ? (
        <button
          onClick={() => inputRef.current?.click()}
          disabled={disabled}
          className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-background py-12 text-sm text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-50"
        >
          <Camera className="h-8 w-8" />
          <span className="font-medium">📸 Tomar foto o subir imagen</span>
          <span className="text-xs">JPG, PNG, WEBP · máx 5MB</span>
        </button>
      ) : (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-md border border-border bg-muted">
            <img src={preview} alt="Vista previa" className="mx-auto block max-h-[300px]" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => inputRef.current?.click()}
              disabled={disabled}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              Cambiar imagen
            </button>
            <button
              onClick={() => void submit()}
              disabled={disabled}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {processing ? "Procesando…" : "Procesar con IA"}
            </button>
          </div>
          {processing && (
            <div className="rounded-md bg-accent/50 px-3 py-2 text-xs text-foreground">
              {processingMsg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ==================== VOICE TAB ==================== */
function VoiceTab({
  tenantId,
  disabled,
  processing,
  processingMsg,
  onProcessingChange,
  onExtracted,
}: {
  tenantId: string;
  disabled: boolean;
  processing: boolean;
  processingMsg: string;
  onProcessingChange: (b: boolean) => void;
  onExtracted: (text: string, ingestionId: string, ext: ExtractedData) => void;
}) {
  const SpeechRecognitionCtor: any =
    typeof window !== "undefined"
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : undefined;
  const supported = !!SpeechRecognitionCtor;

  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [editable, setEditable] = useState("");
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<number | null>(null);

  const stopListening = () => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
  };

  const startListening = () => {
    if (!supported) return;
    if (listening) {
      stopListening();
      return;
    }
    setTranscript("");
    setEditable("");
    const rec = new SpeechRecognitionCtor();
    rec.lang = "es-MX";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onstart = () => setListening(true);
    rec.onresult = (event: any) => {
      let full = "";
      for (let i = 0; i < event.results.length; i++) {
        full += event.results[i][0].transcript;
      }
      setTranscript(full);
      setEditable(full);
      if (silenceTimerRef.current) window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = window.setTimeout(() => {
        try {
          rec.stop();
        } catch {
          /* ignore */
        }
      }, 5000);
    };
    rec.onerror = () => {
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      if (silenceTimerRef.current) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      /* ignore */
    }
  };

  const submit = async () => {
    const text = editable.trim();
    if (text.length < 3) return;
    onProcessingChange(true);
    try {
      const r = await extractFromText(tenantId, text);
      onExtracted(text, r.ingestionId, r.extracted);
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      onProcessingChange(false);
    }
  };

  if (!supported) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Tu navegador no soporta dictado por voz. Usa la pestaña Texto.
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <button
        onClick={startListening}
        disabled={disabled}
        className={`mx-auto flex h-32 w-32 items-center justify-center rounded-full transition disabled:opacity-50 ${
          listening
            ? "animate-pulse bg-rose-500 text-white shadow-lg shadow-rose-200"
            : "bg-primary text-primary-foreground hover:bg-primary/90"
        }`}
      >
        {listening ? <MicOff className="h-12 w-12" /> : <Mic className="h-12 w-12" />}
      </button>
      <div className="text-sm text-muted-foreground">
        {listening ? "Escuchando…" : "Toca para hablar"}
      </div>
      {listening && transcript && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm">
          {transcript}
        </div>
      )}
      {!listening && editable && (
        <div className="space-y-2 text-left">
          <label className="text-xs font-medium text-muted-foreground">
            Edita la transcripción si es necesario:
          </label>
          <textarea
            value={editable}
            onChange={(e) => setEditable(e.target.value)}
            rows={4}
            disabled={disabled}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <button
            onClick={() => void submit()}
            disabled={disabled || editable.trim().length < 3}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            {processing ? "Procesando…" : "Procesar con IA"}
          </button>
          {processing && (
            <div className="text-xs text-primary">{processingMsg}</div>
          )}
        </div>
      )}
    </div>
  );
}

/* ==================== CONFIRMATION SCREEN ==================== */
type SchemaAttr = { key: string; label: string; type: string; options?: string[] };

function ConfirmScreen({
  tenantId,
  ingestionId,
  initialData,
  originalInput,
  onBack,
  onDone,
  navigate,
}: {
  tenantId: string;
  ingestionId: string;
  initialData: ExtractedData;
  originalInput: { kind: "text" | "photo"; text?: string; imagePath?: string } | null;
  onBack: () => void;
  onDone: () => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const [data, setData] = useState<ExtractedData>(() => structuredClone(initialData));
  const [submitting, setSubmitting] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [schemaAttrs, setSchemaAttrs] = useState<SchemaAttr[]>([]);

  useEffect(() => {
    void supabase
      .from("product_schemas")
      .select("attributes")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .is("deleted_at", null)
      .maybeSingle()
      .then(({ data: row }) => {
        const attrs = (row as { attributes?: unknown } | null)?.attributes;
        setSchemaAttrs(Array.isArray(attrs) ? (attrs as SchemaAttr[]) : []);
      });
  }, [tenantId]);

  useEffect(() => {
    if (originalInput?.kind !== "photo") return;
    void (async () => {
      const { getIngestionImageUrlFn } = await import("@/utils/ai.functions");
      const r = await getIngestionImageUrlFn({ data: { ingestionId } });
      setImageUrl(r.signedUrl);
    })();
  }, [originalInput, ingestionId]);

  const updateItem = (idx: number, patch: Partial<ExtractedItem>) => {
    setData((d) => ({ ...d, items: d.items.map((it, i) => (i === idx ? { ...it, ...patch } : it)) }));
  };
  const removeItem = (idx: number) => {
    setData((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));
  };
  const addItem = () => {
    setData((d) => ({
      ...d,
      items: [...d.items, { quantity: 1, attributes: {} } as ExtractedItem],
    }));
  };

  const handleDiscard = async () => {
    if (!window.confirm("¿Seguro que quieres descartar esta ingesta?")) return;
    try {
      await discardIngestion(ingestionId);
      toast.success("Ingesta descartada");
      onDone();
    } catch (e) {
      toast.error(aiErrorMessage(e));
    }
  };

  const handleConfirm = async () => {
    // Validation
    if (data.items.length === 0) {
      toast.error("Agrega al menos una línea");
      return;
    }
    for (const [i, it] of data.items.entries()) {
      if (data.intent !== "catalog" && !it.product_id) {
        toast.error(`Línea ${i + 1}: selecciona un producto`);
        return;
      }
      if (data.intent === "catalog" && !it.create_new && !it.product_id) {
        // For catalog, treat all as create_new
        it.create_new = true;
      }
      if (!it.quantity || it.quantity <= 0) {
        toast.error(`Línea ${i + 1}: cantidad inválida`);
        return;
      }
      if (data.intent === "sale" && (!it.unit_price || it.unit_price <= 0)) {
        toast.error(`Línea ${i + 1}: precio requerido para venta`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await confirmIngestion(ingestionId, data, "confirm");
      toast.success("Ingesta confirmada");
      const ref = result.references[0];
      if (data.intent === "sale" && ref) {
        void navigate({ to: "/app/ventas/$saleId", params: { saleId: ref } });
      } else if (data.intent === "inventory_in" || data.intent === "inventory_out") {
        toast.success(`${result.references.length} movimiento(s) registrado(s)`);
        void navigate({ to: "/app/inventario/movimientos" });
      } else if (data.intent === "catalog") {
        toast.success(`${result.references.length} producto(s) creado(s)`);
        void navigate({ to: "/app/productos" });
      } else {
        onDone();
      }
    } catch (e) {
      toast.error(aiErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const confidencePct = Math.round((data.confidence ?? 0) * 100);
  const confColor = confidencePct >= 80 ? "emerald" : confidencePct >= 50 ? "amber" : "rose";

  return (
    <div className="space-y-5 pb-24">
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="rounded-md p-2 hover:bg-accent">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            Confirma los datos extraídos
          </h1>
          <p className="text-sm text-muted-foreground">Revisa y edita antes de guardar.</p>
        </div>
      </header>

      {/* Original input */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Entrada original
        </div>
        {originalInput?.kind === "text" && originalInput.text && (
          <blockquote className="border-l-2 border-border pl-3 text-sm italic text-foreground">
            {originalInput.text}
          </blockquote>
        )}
        {originalInput?.kind === "photo" && (
          imageUrl ? (
            <img src={imageUrl} alt="Imagen original" className="max-h-48 rounded-md border border-border" />
          ) : (
            <div className="text-xs text-muted-foreground">Cargando imagen…</div>
          )
        )}
      </div>

      {/* Intent card */}
      <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50/40 p-4 dark:bg-amber-950/20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-amber-900">
              La IA detectó
            </div>
            <div className="mt-1 text-lg font-semibold text-foreground">
              {INTENT_ICONS[data.intent]} {INTENT_LABELS[data.intent]}
            </div>
          </div>
          <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${
            confColor === "emerald" ? "border-emerald-300 bg-emerald-50 text-emerald-800" :
            confColor === "amber" ? "border-amber-300 bg-amber-50 text-amber-800" :
            "border-rose-300 bg-rose-50 text-rose-800"
          }`}>
            Confianza: {confidencePct}%
          </span>
        </div>
        <div className="mt-3">
          <label className="text-xs font-medium text-muted-foreground">Cambiar intención:</label>
          <select
            value={data.intent}
            onChange={(e) => setData((d) => ({ ...d, intent: e.target.value as Intent }))}
            className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="inventory_in">📦 Entrada de inventario</option>
            <option value="inventory_out">📤 Salida / merma</option>
            <option value="sale">💰 Venta</option>
            <option value="catalog">➕ Nuevo producto al catálogo</option>
            <option value="unknown">❓ No detectado</option>
          </select>
        </div>
      </div>

      {/* Warnings */}
      {data.warnings && data.warnings.length > 0 && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <div className="font-medium">⚠️ La IA tuvo dudas sobre:</div>
          <ul className="mt-1 list-disc pl-5">
            {data.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Sale fields */}
      {data.intent === "sale" && (
        <div className="grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Cliente</label>
            <input
              value={data.customer_name ?? ""}
              onChange={(e) => setData((d) => ({ ...d, customer_name: e.target.value }))}
              placeholder="Público general"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Método de pago</label>
            <select
              value={data.payment_method ?? "efectivo"}
              onChange={(e) => setData((d) => ({ ...d, payment_method: e.target.value }))}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>{PAYMENT_LABELS[m as PaymentMethod]}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* Items */}
      <div className="space-y-3">
        {data.items.map((item, idx) => (
          <ItemCard
            key={idx}
            index={idx}
            item={item}
            intent={data.intent}
            tenantId={tenantId}
            schemaAttrs={schemaAttrs}
            onChange={(patch) => updateItem(idx, patch)}
            onRemove={() => removeItem(idx)}
          />
        ))}
        <button
          onClick={addItem}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background px-3 py-3 text-sm font-medium text-muted-foreground hover:border-primary hover:text-foreground"
        >
          <Plus className="h-4 w-4" /> Agregar línea manualmente
        </button>
      </div>

      {/* Footer fijo */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 py-3 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-5xl items-center justify-end gap-2">
          <button
            onClick={() => void handleDiscard()}
            disabled={submitting}
            className="rounded-md border border-rose-300 bg-background px-4 py-2 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
          >
            Descartar
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={submitting}
            className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {submitting ? "Guardando…" : "Confirmar y guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ==================== ITEM CARD ==================== */
type ProductMatch = Awaited<ReturnType<typeof searchProductForIngestion>>[number];

function ItemCard({
  index,
  item,
  intent,
  tenantId,
  schemaAttrs,
  onChange,
  onRemove,
}: {
  index: number;
  item: ExtractedItem;
  intent: Intent;
  tenantId: string;
  schemaAttrs: SchemaAttr[];
  onChange: (patch: Partial<ExtractedItem>) => void;
  onRemove: () => void;
}) {
  const [searchQuery, setSearchQuery] = useState(item.product_query ?? "");
  const [matches, setMatches] = useState<ProductMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ProductMatch | null>(null);
  const [showResults, setShowResults] = useState(false);

  // Auto-search on mount and on query change
  useEffect(() => {
    if (item.product_id || item.create_new) return;
    if (searchQuery.trim().length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void searchProductForIngestion(tenantId, searchQuery).then((r) => {
      if (cancelled) return;
      setMatches(r);
      setSearching(false);
      // Auto-select if AI gave a query and there's exactly one strong match on first run
      if (!selectedProduct && r.length === 1 && searchQuery === item.product_query) {
        setSelectedProduct(r[0]);
        onChange({ product_id: r[0].id });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, tenantId]);

  const pickProduct = (p: ProductMatch) => {
    setSelectedProduct(p);
    setShowResults(false);
    onChange({ product_id: p.id, create_new: false });
  };

  const clearProduct = () => {
    setSelectedProduct(null);
    onChange({ product_id: null });
  };

  const showPrice = intent === "sale" || intent === "catalog";
  const showCost = intent === "inventory_in" || intent === "catalog";

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Línea {index + 1}
        </div>
        <button
          onClick={onRemove}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600"
          aria-label="Quitar línea"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Producto */}
      {intent !== "catalog" || !item.create_new ? (
        <div>
          <label className="text-xs font-medium text-muted-foreground">Producto</label>
          {selectedProduct || item.product_id ? (
            <div className="mt-1 flex items-center justify-between rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-emerald-900">
                  ✓ {selectedProduct?.name ?? "Producto seleccionado"}
                </span>
                {selectedProduct && (
                  <span className="ml-2 text-xs text-emerald-700">({selectedProduct.sku})</span>
                )}
              </div>
              <button onClick={clearProduct} className="text-xs text-emerald-700 hover:underline">
                Cambiar
              </button>
            </div>
          ) : (
            <div className="relative mt-1">
              <input
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowResults(true);
                }}
                onFocus={() => setShowResults(true)}
                placeholder="Buscar producto por SKU o nombre…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
              {showResults && (matches.length > 0 || searching) && (
                <div className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-md border border-border bg-card shadow-lg">
                  {searching && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Buscando…</div>
                  )}
                  {matches.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => pickProduct(m)}
                      className="block w-full px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <div className="font-medium">{m.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {m.sku} · Stock: {m.current_stock}
                      </div>
                    </button>
                  ))}
                  {intent === "catalog" && (
                    <button
                      onClick={() => {
                        setShowResults(false);
                        onChange({ create_new: true, product_id: null });
                      }}
                      className="block w-full border-t border-border px-3 py-2 text-left text-sm font-medium text-primary hover:bg-accent"
                    >
                      + Crear nuevo producto con estos datos
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">SKU nuevo</label>
            <input
              value={item.sku_hint ?? ""}
              onChange={(e) => onChange({ sku_hint: e.target.value })}
              placeholder="Auto-generado si vacío"
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Nombre</label>
            <input
              value={item.name_hint ?? item.product_query ?? ""}
              onChange={(e) => onChange({ name_hint: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {/* Cantidad y precios */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Cantidad</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={item.quantity}
            onChange={(e) => onChange({ quantity: Number(e.target.value) })}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
          />
        </div>
        {showCost && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Costo unitario</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={item.unit_cost ?? ""}
              onChange={(e) => onChange({ unit_cost: e.target.value === "" ? null : Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
            />
          </div>
        )}
        {showPrice && (
          <div>
            <label className="text-xs font-medium text-muted-foreground">Precio unitario</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={item.unit_price ?? ""}
              onChange={(e) => onChange({ unit_price: e.target.value === "" ? null : Number(e.target.value) })}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums"
            />
          </div>
        )}
      </div>

      {/* Schema attrs (catalog only) */}
      {intent === "catalog" && schemaAttrs.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted-foreground">Atributos</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {schemaAttrs.map((a) => {
              const val = (item.attributes ?? {})[a.key];
              return (
                <div key={a.key}>
                  <label className="text-xs text-muted-foreground">{a.label}</label>
                  {a.type === "select" && a.options ? (
                    <select
                      value={String(val ?? "")}
                      onChange={(e) => onChange({ attributes: { ...(item.attributes ?? {}), [a.key]: e.target.value } })}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      {a.options.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input
                      type={a.type === "number" ? "number" : "text"}
                      value={String(val ?? "")}
                      onChange={(e) => {
                        const v = a.type === "number" ? Number(e.target.value) : e.target.value;
                        onChange({ attributes: { ...(item.attributes ?? {}), [a.key]: v } });
                      }}
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Notas */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Notas</label>
        <textarea
          rows={2}
          value={item.notes ?? ""}
          onChange={(e) => onChange({ notes: e.target.value })}
          className="mt-1 w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
}
