import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Search, MapPin, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import {
  fetchDefaultSchemaAttributes,
  fetchPopularProducts,
  logProductClick,
  logSearch,
  preprocessVoiceQuery,
  quickSearch,
  type QuickSearchResult,
  type SchemaAttribute,
  type StockStatus,
} from "@/utils/quickSearch";
import { formatCurrency, getTenantCurrency, type CurrencyCode } from "@/utils/currency";
import { useImpersonatingTenantId } from "@/lib/impersonation";

export const Route = createFileRoute("/app/consulta")({
  component: ConsultaPage,
});

const STATUS_STYLES: Record<
  StockStatus,
  { bg: string; dot: string; text: string }
> = {
  available: { bg: "bg-green-50", dot: "bg-green-500", text: "text-green-800" },
  low: { bg: "bg-amber-50", dot: "bg-amber-500", text: "text-amber-800" },
  critical: { bg: "bg-red-50", dot: "bg-red-500", text: "text-red-800" },
  out: { bg: "bg-red-50", dot: "bg-red-500", text: "text-red-800" },
};

const SESSION_KEY = "consulta.lastResults";

function ConsultaPage() {
  const navigate = useNavigate();
  const { user, currentMembership, currentTenantId, signOut } = useAuth();
  const impersonatingId = useImpersonatingTenantId();
  const tenantId = impersonatingId ?? currentTenantId;
  const tenantName = currentMembership?.tenants.name ?? "";
  const firstName = useMemo(() => {
    const meta = (user?.user_metadata ?? {}) as { full_name?: string };
    const full = meta.full_name?.trim() || user?.email?.split("@")[0] || "";
    return full.split(" ")[0] || "";
  }, [user]);
  const initials = useMemo(() => {
    const meta = (user?.user_metadata ?? {}) as { full_name?: string };
    const src = meta.full_name?.trim() || user?.email || "";
    const parts = src.split(/\s+|@/).filter(Boolean);
    return (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
  }, [user]);

  const [moneda, setMoneda] = useState<CurrencyCode>("MXN");
  const [schemaAttrs, setSchemaAttrs] = useState<SchemaAttribute[]>([]);
  const [query, setQuery] = useState("");
  const [committed, setCommitted] = useState("");
  const [source, setSource] = useState<"text" | "voice">("text");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [popular, setPopular] = useState<QuickSearchResult[]>([]);
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const lastSearchIdRef = useRef<{ id: string; ts: number } | null>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const voiceErrorTimerRef = useRef<number | null>(null);

  const SpeechRecognition: any =
    typeof window !== "undefined"
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : undefined;
  const voiceSupported = !!SpeechRecognition;

  // Load tenant settings + schema + popular + restore cache
  useEffect(() => {
    if (!tenantId) return;
    void supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenantId)
      .maybeSingle()
      .then(({ data }) => {
        const ops = ((data?.settings as any)?.operations ?? {}) as {
          moneda?: string;
        };
        if (ops.moneda) setMoneda(ops.moneda);
      });
    void fetchDefaultSchemaAttributes(tenantId).then(setSchemaAttrs);
    void fetchPopularProducts(tenantId).then(setPopular);
    if (typeof sessionStorage !== "undefined") {
      const cached = sessionStorage.getItem(SESSION_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as {
            query: string;
            results: QuickSearchResult[];
          };
          setQuery(parsed.query);
          setResults(parsed.results);
          if (parsed.results[0]) setExpandedId(parsed.results[0].id);
        } catch {
          /* ignore */
        }
      }
    }
  }, [tenantId]);

  useEffect(() => {
    const onUp = () => setOnline(true);
    const onDown = () => setOnline(false);
    window.addEventListener("online", onUp);
    window.addEventListener("offline", onDown);
    return () => {
      window.removeEventListener("online", onUp);
      window.removeEventListener("offline", onDown);
    };
  }, []);

  // Debounce input
  useEffect(() => {
    const t = window.setTimeout(() => {
      setCommitted(query.trim());
    }, 200);
    return () => window.clearTimeout(t);
  }, [query]);

  // Run search when committed changes
  useEffect(() => {
    if (!tenantId) return;
    if (committed.length < 2) {
      setResults([]);
      setHasMore(false);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    void quickSearch(tenantId, committed)
      .then(({ results: res, hasMore: more }) => {
        if (cancelled) return;
        setResults(res);
        setHasMore(more);
        setExpandedId(res[0]?.id ?? null);
        setSearching(false);
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.setItem(
            SESSION_KEY,
            JSON.stringify({ query: committed, results: res }),
          );
        }
        if (user) {
          void logSearch({
            tenantId,
            userId: user.id,
            query: committed,
            source,
            resultCount: res.length,
          }).then((id) => {
            if (id) lastSearchIdRef.current = { id, ts: Date.now() };
          });
        }
      })
      .catch(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [committed, tenantId]);

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
    if (!voiceSupported) return;
    if (listening) {
      stopListening();
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "es-MX";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onstart = () => {
      setListening(true);
      setVoiceError(null);
    };
    rec.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      const cleaned = preprocessVoiceQuery(transcript);
      setSource("voice");
      setQuery(cleaned);
      // reset silence timer
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
      setVoiceError("No pudimos escuchar, intenta de nuevo");
      if (voiceErrorTimerRef.current) window.clearTimeout(voiceErrorTimerRef.current);
      voiceErrorTimerRef.current = window.setTimeout(() => setVoiceError(null), 3000);
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

  const onProductClick = (id: string) => {
    setExpandedId((prev) => (prev === id ? prev : id));
    const last = lastSearchIdRef.current;
    if (last && Date.now() - last.ts < 60_000) {
      void logProductClick(last.id, id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      setSource("text");
    }
  };

  const handleSignOut = async () => {
    await signOut();
    void navigate({ to: "/login" });
  };

  if (!tenantId) return null;

  const showEmpty = committed.length < 2 && !searching;
  const showZero = committed.length >= 2 && !searching && results.length === 0;

  return (
    <div className="mx-auto -mx-6 -my-10 min-h-screen max-w-[480px] bg-background px-4 pb-10 pt-4 md:mx-auto md:my-0 md:rounded-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              className={`h-1.5 w-1.5 rounded-full ${online ? "bg-green-500" : "bg-amber-500"}`}
              aria-hidden
            />
            <span className="truncate">{tenantName}</span>
          </div>
          <div className="mt-0.5 text-base font-medium text-foreground">
            Hola, {firstName}
          </div>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((m) => !m)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-accent text-sm font-semibold text-foreground"
            aria-label="Menú de usuario"
          >
            {initials.toUpperCase()}
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-card shadow-md">
              <button
                onClick={handleSignOut}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-accent"
              >
                <LogOut className="h-4 w-4" /> Cerrar sesión
              </button>
            </div>
          )}
        </div>
      </div>

      {!online && (
        <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Sin conexión — los datos pueden estar desactualizados
        </div>
      )}

      {/* Search */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setSource("text");
              setQuery(e.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Buscar producto..."
            className="h-12 w-full rounded-md border border-input bg-background pl-9 pr-3 text-base outline-none focus:ring-2 focus:ring-ring"
            aria-label="Buscar producto"
          />
          {searching && (
            <div className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          )}
        </div>
        {voiceSupported && (
          <button
            onClick={startListening}
            aria-label={listening ? "Detener búsqueda por voz" : "Buscar por voz"}
            className={`flex h-12 w-12 items-center justify-center rounded-md border transition ${
              listening
                ? "animate-pulse border-red-500 bg-red-500 text-white"
                : "border-primary text-primary hover:bg-primary/5"
            }`}
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        )}
      </div>
      {voiceError && (
        <div className="mt-2 text-xs text-destructive">{voiceError}</div>
      )}

      {/* Results */}
      <div
        className={`mt-4 transition-opacity ${searching && results.length > 0 ? "opacity-60" : "opacity-100"}`}
        aria-live="polite"
      >
        {showEmpty && (
          <EmptyState
            popular={popular}
            moneda={moneda}
            onPick={(name) => {
              setSource("text");
              setQuery(name);
            }}
          />
        )}

        {showZero && (
          <div className="rounded-md border border-border bg-card px-4 py-6 text-center">
            <p className="text-sm font-medium text-foreground">
              No encontramos «{committed}»
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Revisa la ortografía o prueba con menos palabras
            </p>
            <button
              onClick={() => void navigate({ to: "/app/productos" })}
              className="mt-3 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
            >
              Ver todo el catálogo
            </button>
          </div>
        )}

        <div className="space-y-3">
          {results.map((r) =>
            expandedId === r.id ? (
              <ExpandedCard
                key={r.id}
                product={r}
                moneda={moneda}
                schemaAttrs={schemaAttrs}
              />
            ) : (
              <CompactRow
                key={r.id}
                product={r}
                moneda={moneda}
                onClick={() => onProductClick(r.id)}
              />
            ),
          )}
        </div>

        {hasMore && (
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Hay más resultados. Ajusta tu búsqueda.
          </p>
        )}
      </div>
    </div>
  );
}

function EmptyState({
  popular,
  moneda,
  onPick,
}: {
  popular: QuickSearchResult[];
  moneda: string;
  onPick: (name: string) => void;
}) {
  return (
    <div className="py-10 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent">
        <Search className="h-7 w-7 text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium text-foreground">
        Busca un producto por SKU, nombre o características
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Toca el micrófono y di lo que buscas
      </p>
      {popular.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            Más buscados
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {popular.map((p) => (
              <button
                key={p.id}
                onClick={() => onPick(p.name)}
                className="rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-foreground hover:bg-accent"
                title={`${p.name} · ${formatCurrency(Number(p.price), moneda)}`}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function attrSummary(
  attributes: Record<string, unknown>,
  schemaAttrs: SchemaAttribute[],
): string {
  if (!schemaAttrs || schemaAttrs.length === 0) {
    return Object.entries(attributes)
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .slice(0, 3)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(" · ");
  }
  return schemaAttrs
    .map((a) => {
      const v = attributes[a.key];
      if (v === undefined || v === null || v === "") return null;
      return `${a.label}: ${String(v)}`;
    })
    .filter((x): x is string => !!x)
    .slice(0, 3)
    .join(" · ");
}

function ExpandedCard({
  product,
  moneda,
  schemaAttrs,
}: {
  product: QuickSearchResult;
  moneda: string;
  schemaAttrs: SchemaAttribute[];
}) {
  const styles = STATUS_STYLES[product.status];
  const summary = attrSummary(product.attributes, schemaAttrs);
  return (
    <div
      className={`rounded-lg border border-border ${styles.bg} p-4`}
      aria-label={`${product.status_label}, ${product.current_stock} ${product.unit} en stock`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-6 w-6 rounded-full ${styles.dot}`} aria-hidden />
        <span
          className={`text-[11px] font-semibold uppercase tracking-wide ${styles.text}`}
        >
          {product.status_label}
        </span>
      </div>
      <h2 className="mt-2 text-lg font-bold text-foreground">{product.name}</h2>
      <p className="text-sm text-muted-foreground">
        {product.sku} · {product.unit}
      </p>
      {summary && (
        <p className="mt-1 truncate text-xs text-muted-foreground" title={summary}>
          {summary}
        </p>
      )}
      <div className="my-3 h-px bg-border/60" />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            En stock
          </div>
          <div className="text-xl font-semibold tabular-nums text-foreground">
            {Number(product.current_stock)} {product.unit}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Precio
          </div>
          <div className="text-xl font-semibold tabular-nums text-foreground">
            {formatCurrency(Number(product.price), moneda)}
          </div>
        </div>
      </div>
      {product.location && (
        <div className="mt-3 flex items-center gap-1 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" />
          Ubicación: {product.location}
        </div>
      )}
    </div>
  );
}

function CompactRow({
  product,
  moneda,
  onClick,
}: {
  product: QuickSearchResult;
  moneda: string;
  onClick: () => void;
}) {
  const styles = STATUS_STYLES[product.status];
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-3 text-left hover:bg-accent"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={`h-3.5 w-3.5 shrink-0 rounded-full ${styles.dot}`}
          aria-hidden
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-foreground">
            {product.name}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {product.sku}
          </div>
        </div>
      </div>
      <div className="text-right text-sm tabular-nums text-foreground">
        {Number(product.current_stock)} · {formatCurrency(Number(product.price), moneda)}
      </div>
    </button>
  );
}
