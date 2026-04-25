import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/* Configurable models */
const TEXT_MODEL = process.env.AI_TEXT_MODEL || "google/gemini-2.5-flash";
const VISION_MODEL = process.env.AI_VISION_MODEL || "google/gemini-2.5-pro";
const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

type Intent = "inventory_in" | "inventory_out" | "sale" | "catalog" | "unknown";

type ExtractedItem = {
  product_query?: string;
  sku_hint?: string;
  name_hint?: string;
  quantity: number;
  unit_price?: number | null;
  unit_cost?: number | null;
  attributes?: Record<string, unknown>;
  notes?: string;
  product_id?: string | null;
  create_new?: boolean;
};

type ExtractedData = {
  intent: Intent;
  confidence: number;
  items: ExtractedItem[];
  customer_name?: string | null;
  payment_method?: string | null;
  warnings?: string[];
};

async function assertMembership(userId: string, tenantId: string): Promise<string> {
  const { data: m } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .maybeSingle();
  const { data: superA } = await supabaseAdmin
    .from("user_tenants")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "super_admin")
    .eq("is_active", true)
    .maybeSingle();
  const role = (m?.role as string | undefined) ?? (superA ? "super_admin" : null);
  if (!role) throw new Error("No autorizado");
  return role;
}

async function consumeQuota(tenantId: string, amount: number): Promise<void> {
  const sb = supabaseAdmin as unknown as {
    rpc: (
      fn: string,
      params: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await sb.rpc("increment_ai_usage", {
    p_tenant_id: tenantId,
    p_amount: amount,
  });
  if (error) throw new Error(error.message);
  if (data === false) throw new Error("AI_QUOTA_EXCEEDED");
}

async function fetchSchemaAttributes(tenantId: string): Promise<unknown[]> {
  const { data } = await supabaseAdmin
    .from("product_schemas")
    .select("attributes")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .is("deleted_at", null)
    .maybeSingle();
  const attrs = (data as { attributes?: unknown } | null)?.attributes;
  return Array.isArray(attrs) ? attrs : [];
}

const EXTRACTION_TOOL = {
  type: "function" as const,
  function: {
    name: "extract_business_event",
    description: "Extract a structured inventory or sale event from the user input.",
    parameters: {
      type: "object",
      properties: {
        intent: {
          type: "string",
          enum: ["inventory_in", "inventory_out", "sale", "catalog", "unknown"],
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              product_query: { type: "string" },
              sku_hint: { type: "string" },
              name_hint: { type: "string" },
              quantity: { type: "number", minimum: 0 },
              unit_price: { type: ["number", "null"] },
              unit_cost: { type: ["number", "null"] },
              attributes: { type: "object", additionalProperties: true },
              notes: { type: "string" },
            },
            required: ["quantity"],
          },
        },
        customer_name: { type: ["string", "null"] },
        payment_method: { type: ["string", "null"] },
        warnings: { type: "array", items: { type: "string" } },
      },
      required: ["intent", "confidence", "items"],
    },
  },
};

function buildSystemPrompt(schemaAttrs: unknown[], intentHint?: string | null): string {
  const intentHintLine = intentHint
    ? `\nEl usuario sugiere que la intención es "${intentHint}" — confírmala u ajústala según el contexto.`
    : "";
  return [
    "Eres un asistente de inventario en español para PYMES mexicanas.",
    "Extrae datos estructurados desde texto libre o tickets fotografiados (compras, ventas, ajustes).",
    "El negocio usa estos atributos personalizados de productos:",
    JSON.stringify(schemaAttrs),
    "",
    "Reglas:",
    "- Devuelve SIEMPRE la herramienta extract_business_event.",
    "- Productos llegando o comprados → intent=inventory_in.",
    "- Productos saliendo (no por venta), mermas o ajustes negativos → intent=inventory_out.",
    "- Venta a un cliente → intent=sale.",
    "- Producto NUEVO al catálogo (sin movimiento) → intent=catalog.",
    "- Si no estás seguro → intent=unknown y confidence baja.",
    "- Cantidades y precios numéricos en MXN. Si no aparece, deja null.",
    "- En product_query pon texto buscable para localizar el producto en el catálogo.",
    "- En attributes solo claves que coincidan con el schema dado.",
    "- En warnings añade ambigüedades: precios borrosos, letras ilegibles, conflictos.",
    "- En fotos: busca SKUs, cantidades, precios, totales, proveedor, fecha.",
    intentHintLine,
  ].join("\n");
}

type AiCallResult = {
  extracted: ExtractedData;
  raw: unknown;
  tokens_input: number;
  tokens_output: number;
  cost_usd: number;
};

async function callAiGateway(opts: {
  model: string;
  systemPrompt: string;
  userParts: Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
}): Promise<AiCallResult> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userParts },
    ],
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "function", function: { name: "extract_business_event" } },
  };

  let response: Response;
  try {
    response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("AI Gateway fetch failed", e);
    throw new Error("AI_REQUEST_FAILED");
  }

  if (response.status === 429) throw new Error("AI_RATE_LIMIT");
  if (response.status === 402) throw new Error("AI_PAYMENT_REQUIRED");
  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    console.error("AI Gateway non-OK", response.status, txt);
    throw new Error("AI_REQUEST_FAILED");
  }

  const json = (await response.json()) as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = toolCall?.function?.arguments;
  if (!argsStr) {
    console.error("AI Gateway: no tool call", JSON.stringify(json).slice(0, 500));
    throw new Error("AI_INVALID_OUTPUT");
  }

  let parsed: ExtractedData;
  try {
    parsed = JSON.parse(argsStr) as ExtractedData;
  } catch (e) {
    console.error("AI Gateway: invalid JSON args", argsStr.slice(0, 500), e);
    throw new Error("AI_INVALID_OUTPUT");
  }

  if (!parsed.intent || !Array.isArray(parsed.items)) {
    throw new Error("AI_INVALID_OUTPUT");
  }

  const tokens_input = Number(json.usage?.prompt_tokens ?? 0);
  const tokens_output = Number(json.usage?.completion_tokens ?? 0);
  const cost_usd =
    (tokens_input / 1_000_000) * 0.075 + (tokens_output / 1_000_000) * 0.3;

  return { extracted: parsed, raw: json, tokens_input, tokens_output, cost_usd };
}

export const extractFromTextFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { tenantId: string; text: string; intentHint?: string | null }) => {
      if (!data || typeof data.tenantId !== "string") throw new Error("tenantId inválido");
      if (typeof data.text !== "string" || data.text.trim().length < 3)
        throw new Error("Texto demasiado corto");
      if (data.text.length > 4000) throw new Error("Texto demasiado largo");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertMembership(userId, data.tenantId);
    await consumeQuota(data.tenantId, 1);

    const schemaAttrs = await fetchSchemaAttributes(data.tenantId);
    const systemPrompt = buildSystemPrompt(schemaAttrs, data.intentHint ?? undefined);

    let aiResult: AiCallResult;
    try {
      aiResult = await callAiGateway({
        model: TEXT_MODEL,
        systemPrompt,
        userParts: [{ type: "text", text: data.text }],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("ai_ingestions").insert({
        tenant_id: data.tenantId,
        user_id: userId,
        mode: "text",
        intent: "unknown",
        input_text: data.text,
        raw_response: { error: msg } as never,
        extracted_data: {} as never,
        status: "failed",
        error_message: msg,
      });
      throw e;
    }

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("ai_ingestions")
      .insert({
        tenant_id: data.tenantId,
        user_id: userId,
        mode: "text",
        intent: aiResult.extracted.intent,
        input_text: data.text,
        raw_response: aiResult.raw as never,
        extracted_data: aiResult.extracted as never,
        status: "pending",
        tokens_input: aiResult.tokens_input,
        tokens_output: aiResult.tokens_output,
        cost_usd: aiResult.cost_usd,
      })
      .select("id")
      .single();
    if (insertErr || !inserted)
      throw new Error(insertErr?.message ?? "No se pudo guardar la ingesta");

    return {
      ingestionId: (inserted as { id: string }).id,
      extracted: aiResult.extracted,
    };
  });

export const extractFromImageFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { tenantId: string; imageBase64: string; mimeType: string }) => {
      if (!data || typeof data.tenantId !== "string") throw new Error("tenantId inválido");
      if (typeof data.imageBase64 !== "string" || data.imageBase64.length < 100)
        throw new Error("Imagen inválida");
      if (data.imageBase64.length > 8_000_000)
        throw new Error("Imagen demasiado grande (máx ~6 MB)");
      if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(data.mimeType))
        throw new Error("Formato de imagen no soportado");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertMembership(userId, data.tenantId);
    await consumeQuota(data.tenantId, 2);

    const ingestionId = crypto.randomUUID();
    const ext = data.mimeType.split("/")[1]?.toLowerCase() || "jpg";
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const path = `${data.tenantId}/${yyyy}/${mm}/${ingestionId}.${ext}`;

    const buffer = Buffer.from(data.imageBase64, "base64");
    const { error: uploadErr } = await supabaseAdmin.storage
      .from("ai-ingestions")
      .upload(path, buffer, { contentType: data.mimeType, upsert: false });
    if (uploadErr) throw new Error(`No se pudo guardar la imagen: ${uploadErr.message}`);

    const schemaAttrs = await fetchSchemaAttributes(data.tenantId);
    const systemPrompt = buildSystemPrompt(schemaAttrs);

    const dataUrl = `data:${data.mimeType};base64,${data.imageBase64}`;

    let aiResult: AiCallResult;
    try {
      aiResult = await callAiGateway({
        model: VISION_MODEL,
        systemPrompt,
        userParts: [
          {
            type: "text",
            text: "Extrae los datos de este ticket o imagen. Busca SKUs, cantidades, precios, totales y proveedor.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await supabaseAdmin.from("ai_ingestions").insert({
        id: ingestionId,
        tenant_id: data.tenantId,
        user_id: userId,
        mode: "photo",
        intent: "unknown",
        input_image_path: path,
        raw_response: { error: msg } as never,
        extracted_data: {} as never,
        status: "failed",
        error_message: msg,
      });
      throw e;
    }

    const { error: insertErr } = await supabaseAdmin.from("ai_ingestions").insert({
      id: ingestionId,
      tenant_id: data.tenantId,
      user_id: userId,
      mode: "photo",
      intent: aiResult.extracted.intent,
      input_image_path: path,
      raw_response: aiResult.raw as never,
      extracted_data: aiResult.extracted as never,
      status: "pending",
      tokens_input: aiResult.tokens_input,
      tokens_output: aiResult.tokens_output,
      cost_usd: aiResult.cost_usd,
    });
    if (insertErr) throw new Error(insertErr.message);

    return {
      ingestionId,
      extracted: aiResult.extracted,
      imagePath: path,
    };
  });

export const confirmIngestionFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      ingestionId: string;
      finalData: ExtractedData;
      action: "confirm" | "discard";
    }) => {
      if (!data || typeof data.ingestionId !== "string") throw new Error("ingestionId inválido");
      if (data.action !== "confirm" && data.action !== "discard")
        throw new Error("Acción inválida");
      if (data.action === "confirm") {
        if (!data.finalData || typeof data.finalData !== "object")
          throw new Error("finalData requerido");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };

    const { data: ing } = await supabaseAdmin
      .from("ai_ingestions")
      .select("*")
      .eq("id", data.ingestionId)
      .maybeSingle();
    const ingestion = ing as { tenant_id: string; status: string; user_id: string } | null;
    if (!ingestion) throw new Error("Ingesta no encontrada");

    const role = await assertMembership(userId, ingestion.tenant_id);
    const isManager =
      role === "tenant_owner" || role === "gerente" || role === "super_admin";
    if (!isManager && ingestion.user_id !== userId) throw new Error("No autorizado");

    if (ingestion.status !== "pending") {
      throw new Error("Esta ingesta ya fue procesada");
    }

    if (data.action === "discard") {
      const { error } = await supabaseAdmin
        .from("ai_ingestions")
        .update({
          status: "discarded",
          confirmed_at: new Date().toISOString(),
          confirmed_by: userId,
        })
        .eq("id", data.ingestionId);
      if (error) throw new Error(error.message);
      return { ok: true as const, references: [] };
    }

    const final = data.finalData;
    const references: string[] = [];
    const sb = supabaseAdmin as unknown as {
      rpc: (
        fn: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };

    if (final.intent === "inventory_in" || final.intent === "inventory_out") {
      const movementType = final.intent === "inventory_in" ? "purchase" : "adjustment_out";
      for (const item of final.items) {
        if (!item.product_id) throw new Error("Cada línea debe tener un producto seleccionado");
        if (!item.quantity || item.quantity <= 0)
          throw new Error("Cantidad inválida en una línea");
        const { data: movId, error } = await sb.rpc("record_inventory_movement", {
          p_tenant_id: ingestion.tenant_id,
          p_product_id: item.product_id,
          p_movement_type: movementType,
          p_quantity: item.quantity,
          p_unit_cost: item.unit_cost ?? null,
          p_unit_price: item.unit_price ?? null,
          p_reference_type: "ai_ingestion",
          p_reference_id: data.ingestionId,
          p_notes: item.notes ?? `Ingesta IA ${data.ingestionId.slice(0, 8)}`,
        });
        if (error) throw new Error(error.message);
        if (typeof movId === "string") references.push(movId);
      }
    } else if (final.intent === "sale") {
      const items = final.items.map((it) => {
        if (!it.product_id) throw new Error("Cada línea debe tener un producto seleccionado");
        return {
          product_id: it.product_id,
          quantity: it.quantity,
          unit_price: it.unit_price ?? 0,
        };
      });
      const { data: saleId, error } = await sb.rpc("register_sale", {
        p_tenant_id: ingestion.tenant_id,
        p_payment_method: final.payment_method ?? "efectivo",
        p_customer_name: final.customer_name ?? null,
        p_customer_email: null,
        p_notes: `Ingesta IA ${data.ingestionId.slice(0, 8)}`,
        p_items: items,
      });
      if (error) throw new Error(error.message);
      if (typeof saleId === "string") references.push(saleId);
    } else if (final.intent === "catalog") {
      const { data: schema } = await supabaseAdmin
        .from("product_schemas")
        .select("id")
        .eq("tenant_id", ingestion.tenant_id)
        .eq("is_default", true)
        .is("deleted_at", null)
        .maybeSingle();
      const schemaId = (schema as { id?: string } | null)?.id;
      if (!schemaId) throw new Error("No hay un schema por defecto. Crea uno antes.");

      for (const item of final.items) {
        const sku =
          item.sku_hint?.trim() ||
          `AI-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const name =
          item.name_hint?.trim() ||
          item.product_query?.trim() ||
          "Producto sin nombre";
        const { data: prod, error } = await supabaseAdmin
          .from("products")
          .insert({
            tenant_id: ingestion.tenant_id,
            schema_id: schemaId,
            sku,
            name,
            price: item.unit_price ?? 0,
            attributes: (item.attributes ?? {}) as never,
          })
          .select("id")
          .single();
        if (error) throw new Error(error.message);
        if (prod) references.push((prod as { id: string }).id);
      }
    } else {
      throw new Error("La intención no permite confirmación automática");
    }

    const { error: updErr } = await supabaseAdmin
      .from("ai_ingestions")
      .update({
        status: "confirmed",
        confirmed_at: new Date().toISOString(),
        confirmed_by: userId,
        final_data: final as never,
        intent: final.intent,
      })
      .eq("id", data.ingestionId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true as const, references };
  });

export const getIngestionImageUrlFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ingestionId: string }) => {
    if (!data || typeof data.ingestionId !== "string") throw new Error("ingestionId inválido");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { data: ing } = await supabaseAdmin
      .from("ai_ingestions")
      .select("tenant_id, input_image_path")
      .eq("id", data.ingestionId)
      .maybeSingle();
    const rec = ing as { tenant_id: string; input_image_path: string | null } | null;
    if (!rec || !rec.input_image_path) return { signedUrl: null };
    await assertMembership(userId, rec.tenant_id);
    const { data: signed } = await supabaseAdmin.storage
      .from("ai-ingestions")
      .createSignedUrl(rec.input_image_path, 60 * 60);
    return { signedUrl: signed?.signedUrl ?? null };
  });
