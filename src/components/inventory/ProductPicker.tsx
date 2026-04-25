import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatNumber } from "@/utils/currency";

export type PickerProduct = {
  id: string;
  sku: string;
  name: string;
  current_stock: number;
  cost_avg: number;
  unit: string;
};

export function ProductPicker({
  tenantId,
  value,
  onChange,
  disabled,
}: {
  tenantId: string;
  value: PickerProduct | null;
  onChange: (p: PickerProduct | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerProduct[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      setOpen(false);
      return;
    }
    const term = query.trim();
    if (term.length < 1) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      const safe = term.replace(/[%_]/g, "");
      const { data } = await supabase
        .from("products")
        .select("id, sku, name, current_stock, cost_avg, unit")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .is("deleted_at", null)
        .or(`sku.ilike.%${safe}%,name.ilike.%${safe}%`)
        .limit(8);
      setResults((data ?? []) as PickerProduct[]);
      setLoading(false);
      setOpen(true);
    }, 200);
    return () => clearTimeout(t);
  }, [query, tenantId, value]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  if (value) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-medium text-foreground">{value.name}</div>
            <div className="font-mono text-xs text-muted-foreground">{value.sku}</div>
            <div className="mt-1 text-xs text-muted-foreground tabular-nums">
              Stock actual: <span className="font-medium text-foreground">{formatNumber(value.current_stock, 0)}</span> {value.unit}
              {" · "}Costo prom.: <span className="font-medium text-foreground">${formatNumber(value.cost_avg, 2)}</span>
            </div>
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setQuery("");
              }}
              className="text-xs text-primary hover:underline"
            >
              Cambiar
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar por SKU o nombre"
          disabled={disabled}
          className="w-full rounded-md border border-border bg-card py-2 pl-9 pr-9 text-sm outline-none focus:border-primary"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border bg-card shadow-lg">
          {loading ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">Buscando…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">Sin resultados</div>
          ) : (
            results.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                  setQuery("");
                }}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-foreground">{p.name}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{p.sku}</div>
                </div>
                <div className="text-right text-xs text-muted-foreground tabular-nums">
                  <div>Stock: {formatNumber(p.current_stock, 0)}</div>
                  <div>${formatNumber(p.cost_avg, 2)}</div>
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
