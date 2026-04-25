import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Mic, MicOff, Search, X, WifiOff, Loader2, MapPin } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, formatNumber, getTenantCurrency, type CurrencyCode } from "@/utils/currency";
import {
  quickSearch,
  preprocessVoiceQuery,
  logSearch,
  logProductClick,
  fetchPopularProducts,
  fetchSchemaAttributes,
  formatAttributesInline,
  type QuickSearchResult,
  type PopularProduct,
  type StockStatus,
} from "@/utils/quickSearch";
import type { ProductAttributeDef } from "@/utils/products";

export const Route = createFileRoute("/app/buscar")({
  component: QuickSearchPage,
});

const STORAGE_KEY = "quicksearch:lastState";

/* ---------------- SpeechRecognition typing ---------------- */
type SRAlternative = { transcript: string; confidence: number };
type SRResult = { 0: SRAlternative; isFinal: boolean; length: number };
type SREvent = { resultIndex: number; results: ArrayLike<SRResult> };
type SRErrorEvent = { error: string };
interface SR {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: SREvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: SRErrorEvent) => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
}
type SRCtor = new () => SR;

function getSpeechRecognition(): SRCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SRCtor;
    webkitSpeechRecognition?: SRCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/* ---------------- Status visuals ---------------- */
const STATUS_STYLES: Record<
  StockStatus,
  { card: string; dot: string; label: string; text: string }
> = {
  available: {
    card: "bg-emerald-50/70 border-emerald-200",
    dot: "bg-emerald-500",
    label: "text-emerald-700",
    text: "text-emerald-900",
  },
  low: {
    card: "bg-amber-50/70 border-amber-200",
    dot: "bg-amber-500",
    label: "text-amber-700",
    text: "text-amber-900",
  },
  critical: {
    card: "bg-red-50/70 border-red-200",
    dot: "bg-red-500",
    label: "text-red-700",
    text: "text-red-900",
  },
  out: {
    card: "bg-red-50/70 border-red-200",
    dot: "bg-red-500",
    label: "text-red-700",
    text: "text-red-900",
  },
};

function StatusDot({ status, size = 14 }: { status: StockStatus; size?: number }) {
  return (
    <span
      aria-hidden
      className={`inline-block rounded-full ${STATUS_STYLES[status].dot}`}
      style={{ width: size, height: size }}
    />
  );
}

/* ---------------- Page ---------------- */
function QuickSearchPage() {
  const { session, currentTenantId } = useAuth();
  const navigate = useNavigate();
  const tenantId = currentTenantId;
  const userId = session?.user?.id ?? null;

  const [query, setQuery] = useState("");
  const [interim, setInterim] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [results, setResults] = useState<QuickSearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [popular, setPopular] = useState<PopularProduct[]>([]);
  const [currency, setCurrency] = useState<CurrencyCode>("MXN");
  const [schemasMap, setSchemasMap] = useState<Record<string, ProductAttributeDef[]>>({});
  const [online, setOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  // Voice
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognitionRef = useRef<SR | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearchIdRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Online/offline banner
  useEffect(() => {
    function on() {
      setOnline(true);
    }
    function off() {
      setOnline(false);
    }
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  // Voice support detection
  useEffect(() => {
    setVoiceSupported(!!getSpeechRecognition());
  }, []);

  // Restore last state from sessionStorage
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        query?: string;
        committedQuery?: string;
        results?: QuickSearchResult[];
        hasMore?: boolean;
      };
      if (parsed.query) setQuery(parsed.query);
      if (parsed.committedQuery) setCommittedQuery(parsed.committedQuery);
      if (parsed.results) {
        setResults(parsed.results);
        setSearched(true);
        setExpandedId(parsed.results[0]?.id ?? null);
      }
      if (typeof parsed.hasMore === "boolean") setHasMore(parsed.hasMore);
    } catch {
      // ignore
    }
  }, []);

  // Tenant currency + popular products
  useEffect(() => {
    if (!tenantId) return;
    void supabase
      .from("tenants")
      .select("settings")
      .eq("id", tenantId)
      .maybeSingle()
      .then(({ data }) => {
        setCurrency(getTenantCurrency(data?.settings ?? {}));
      });
    void fetchPopularProducts(tenantId, 6).then(setPopular);
  }, [tenantId]);

  // Debounced search
  useEffect(() => {
    if (!tenantId) return;
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setHasMore(false);
      setSearched(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const { results: rows, hasMore: more } = await quickSearch(tenantId, term);
      setResults(rows);
      setHasMore(more);
      setSearched(true);
      setExpandedId(rows[0]?.id ?? null);
      setLoading(false);
      setCommittedQuery(term);
      // persist
      try {
        sessionStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ query: term, committedQuery: term, results: rows, hasMore: more }),
        );
      } catch {
        /* ignore */
      }
      // telemetry — only the final committed query
      if (tenantId) {
        const id = await logSearch({
          tenantId,
          userId,
          query: term,
          source: "text",
          resultCount: rows.length,
        });
        lastSearchIdRef.current = id;
      }
      // Load any missing schemas
      const missing = Array.from(new Set(rows.map((r) => r.schema_id))).filter(
        (id) => !schemasMap[id],
      );
      if (missing.length > 0) {
        const entries = await Promise.all(
          missing.map(async (id) => [id, await fetchSchemaAttributes(id)] as const),
        );
        setSchemasMap((prev) => {
          const next = { ...prev };
          for (const [id, attrs] of entries) next[id] = attrs;
          return next;
        });
      }
    }, 200);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tenantId, userId]);

  function startVoice() {
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "es-MX";
    r.continuous = false;
    r.interimResults = true;
    r.maxAlternatives = 1;
    recognitionRef.current = r;
    setInterim("");
    setListening(true);
    setSpeaking(false);

    const resetSilence = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        try {
          r.stop();
        } catch {
          /* ignore */
        }
      }, 5000);
    };
    resetSilence();

    r.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = res[0].transcript;
        if (res.isFinal) finalText += t;
        else interimText += t;
      }
      if (interimText) {
        setInterim(interimText);
        resetSilence();
      }
      if (finalText) {
        const cleaned = preprocessVoiceQuery(finalText);
        setInterim("");
        setQuery(cleaned);
        // mark next logSearch as voice (handled below by override)
        voiceCommitRef.current = true;
      }
    };
    r.onspeechstart = () => setSpeaking(true);
    r.onspeechend = () => setSpeaking(false);
    r.onerror = () => {
      setListening(false);
      setSpeaking(false);
      setInterim("");
    };
    r.onend = () => {
      setListening(false);
      setSpeaking(false);
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    };
    try {
      r.start();
    } catch {
      setListening(false);
    }
  }

  function stopVoice() {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* ignore */
    }
    setListening(false);
    setSpeaking(false);
    setInterim("");
  }

  // Track when next search comes from voice for telemetry source label
  const voiceCommitRef = useRef(false);
  useEffect(() => {
    if (!voiceCommitRef.current) return;
    if (!tenantId) return;
    const term = query.trim();
    if (term.length < 2) {
      voiceCommitRef.current = false;
      return;
    }
    // Wait one tick after debounce — we'll re-log voice separately.
    const t = setTimeout(async () => {
      voiceCommitRef.current = false;
      const id = await logSearch({
        tenantId,
        userId,
        query: term,
        source: "voice",
        resultCount: results.length,
      });
      lastSearchIdRef.current = id;
    }, 400);
    return () => clearTimeout(t);
  }, [query, results.length, tenantId, userId]);

  function handleResultClick(r: QuickSearchResult) {
    if (lastSearchIdRef.current) {
      void logProductClick(lastSearchIdRef.current, r.id);
    }
    void navigate({ to: "/app/productos/$productId", params: { productId: r.id } });
  }

  function handleClear() {
    setQuery("");
    setResults([]);
    setHasMore(false);
    setSearched(false);
    setCommittedQuery("");
    sessionStorage.removeItem(STORAGE_KEY);
    inputRef.current?.focus();
  }

  const showInterim = listening && interim.length > 0;

  const popularChips = useMemo(() => popular.slice(0, 6), [popular]);

  return (
    <div className="mx-auto w-full max-w-[480px] pb-16">
      {!online && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <WifiOff className="h-3.5 w-3.5" />
          Sin conexión — los datos pueden estar desactualizados
        </div>
      )}

      <h1 className="mb-3 text-xl font-semibold text-foreground">Búsqueda rápida</h1>

      {/* Search bar */}
      <div className="sticky top-0 z-10 -mx-1 mb-4 bg-background px-1 pb-3 pt-1">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            ref={inputRef}
            type="text"
            inputMode="search"
            autoComplete="off"
            value={showInterim ? interim : query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleClear();
            }}
            disabled={listening}
            placeholder={listening ? "Escuchando…" : "Buscar producto por SKU, nombre o atributo"}
            aria-label="Buscar producto"
            className={`h-12 w-full rounded-xl border bg-card pl-10 pr-24 text-base outline-none transition-colors ${
              listening
                ? "border-primary text-muted-foreground italic"
                : "border-border focus:border-primary"
            }`}
          />
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
            {loading && !listening && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />
            )}
            {query && !listening && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Limpiar búsqueda"
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {voiceSupported && (
              <button
                type="button"
                onClick={listening ? stopVoice : startVoice}
                aria-label={listening ? "Detener búsqueda por voz" : "Buscar por voz"}
                className={`flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                  listening
                    ? speaking
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "bg-primary/80 text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </button>
            )}
          </div>
        </div>
        {listening && (
          <p className="mt-2 text-xs text-muted-foreground">
            {speaking ? "Te escucho…" : "Escuchando…"} Toca el micrófono para detener.
          </p>
        )}
      </div>

      {/* Results / empty / popular */}
      <div aria-live="polite">
        {!searched && query.trim().length < 2 ? (
          <EmptyState popular={popularChips} onPickPopular={(p) => setQuery(p.name)} />
        ) : searched && results.length === 0 ? (
          <NoResults query={committedQuery} />
        ) : (
          <ResultsList
            results={results}
            expandedId={expandedId}
            onToggle={(id) => setExpandedId((curr) => (curr === id ? null : id))}
            onClick={handleResultClick}
            currency={currency}
            schemasMap={schemasMap}
            hasMore={hasMore}
          />
        )}
      </div>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function EmptyState({
  popular,
  onPickPopular,
}: {
  popular: PopularProduct[];
  onPickPopular: (p: PopularProduct) => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center">
      <Search className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" aria-hidden />
      <p className="text-sm text-foreground">Busca un producto para ver su disponibilidad y precio.</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Escribe SKU, nombre o atributos. También puedes usar el micrófono.
      </p>
      {popular.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Populares
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {popular.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPickPopular(p)}
                className="rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground hover:bg-accent"
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

function NoResults({ query }: { query: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 text-center">
      <p className="text-sm text-foreground">
        No encontramos <span className="font-medium">"{query}"</span>
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Revisa la ortografía o prueba con menos palabras.
      </p>
      <Link
        to="/app/productos"
        className="mt-4 inline-block rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent"
      >
        Ver todo el catálogo
      </Link>
    </div>
  );
}

function ResultsList({
  results,
  expandedId,
  onToggle,
  onClick,
  currency,
  schemasMap,
  hasMore,
}: {
  results: QuickSearchResult[];
  expandedId: string | null;
  onToggle: (id: string) => void;
  onClick: (r: QuickSearchResult) => void;
  currency: CurrencyCode;
  schemasMap: Record<string, ProductAttributeDef[]>;
  hasMore: boolean;
}) {
  const single = results.length === 1;
  return (
    <div className="space-y-3">
      {results.map((r, idx) => {
        const expanded = single || expandedId === r.id || (expandedId == null && idx === 0);
        return expanded ? (
          <ExpandedCard
            key={r.id}
            r={r}
            currency={currency}
            schema={schemasMap[r.schema_id] ?? []}
            onClick={() => onClick(r)}
            onCollapse={!single && results.length > 1 ? () => onToggle(r.id) : undefined}
          />
        ) : (
          <CompactRow
            key={r.id}
            r={r}
            currency={currency}
            onExpand={() => onToggle(r.id)}
          />
        );
      })}
      {hasMore && (
        <p className="px-1 pt-2 text-center text-xs text-muted-foreground">
          Hay más resultados. Ajusta tu búsqueda.
        </p>
      )}
    </div>
  );
}

function ExpandedCard({
  r,
  currency,
  schema,
  onClick,
  onCollapse,
}: {
  r: QuickSearchResult;
  currency: CurrencyCode;
  schema: ProductAttributeDef[];
  onClick: () => void;
  onCollapse?: () => void;
}) {
  const styles = STATUS_STYLES[r.status];
  const attrLine = formatAttributesInline(r.attributes, schema);
  const stockLabel = `${r.status_label.toLowerCase()} — ${formatNumber(r.current_stock, 0)} ${r.unit} en stock`;
  return (
    <article
      className={`rounded-2xl border p-4 shadow-sm ${styles.card}`}
      aria-label={stockLabel}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusDot status={r.status} size={24} />
          <span
            className={`text-[11px] font-semibold uppercase tracking-wider ${styles.label}`}
          >
            {r.status_label}
          </span>
        </div>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="text-xs text-muted-foreground hover:underline"
          >
            Compactar
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onClick}
        className="mt-3 block w-full text-left"
      >
        <div className="text-[18px] font-semibold leading-snug text-foreground">{r.name}</div>
        <div className="mt-0.5 font-mono text-xs text-muted-foreground">{r.sku}</div>
        {attrLine && (
          <div className="mt-1 truncate text-sm text-muted-foreground">{attrLine}</div>
        )}
      </button>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className={`rounded-xl bg-background/60 p-3 ${styles.text}`}>
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Stock
          </div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums">
            {formatNumber(r.current_stock, 0)}
            <span className="ml-1 text-sm font-normal text-muted-foreground">{r.unit}</span>
          </div>
        </div>
        <div className="rounded-xl bg-background/60 p-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Precio
          </div>
          <div className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
            {formatCurrency(r.price, currency)}
          </div>
        </div>
      </div>

      {r.location && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          <span className="truncate">{r.location}</span>
        </div>
      )}

      <button
        type="button"
        onClick={onClick}
        className="mt-4 block w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        Ver detalle
      </button>
    </article>
  );
}

function CompactRow({
  r,
  currency,
  onExpand,
}: {
  r: QuickSearchResult;
  currency: CurrencyCode;
  onExpand: () => void;
}) {
  const styles = STATUS_STYLES[r.status];
  return (
    <button
      type="button"
      onClick={onExpand}
      className={`flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-3 text-left hover:bg-accent ${styles.card}`}
      aria-label={`${r.status_label.toLowerCase()} — ${r.name}, ${formatNumber(r.current_stock, 0)} ${r.unit}`}
    >
      <StatusDot status={r.status} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-foreground">{r.name}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{r.sku}</div>
      </div>
      <div className="text-right">
        <div className="text-sm font-semibold tabular-nums text-foreground">
          {formatNumber(r.current_stock, 0)}
        </div>
        <div className="text-[11px] tabular-nums text-muted-foreground">
          {formatCurrency(r.price, currency)}
        </div>
      </div>
    </button>
  );
}