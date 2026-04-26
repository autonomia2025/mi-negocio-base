# Plan: Ocultar tenant de sistema y hardening del panel /admin/tenants

Aplica el plan que describiste. Verifiqué la DB: el slug del tenant de sistema es `mexintli-hq` (ID `28c31dde-b4ef-4e15-9de8-27994e2fb70d`), que coincide con el ID del crash en consola — confirmando el diagnóstico.

## 1. Migración SQL — agregar `is_system` a `tenants`

```sql
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tenants_is_system
  ON public.tenants(is_system) WHERE is_system = true;

UPDATE public.tenants
  SET is_system = true
  WHERE slug = 'mexintli-hq';
```

## 2. `src/routes/admin.tenants.index.tsx` — hardening

- **Filtrar `is_system`** en la query `reload()`: añadir `.eq("is_system", false)`.
- **Render defensivo del owner**: reemplazar `owners[t.id]?.[0]?.email ?? "—"` por
  ```ts
  const ownerList = owners && typeof owners === "object" ? owners[t.id] : null;
  const ownerEmail = ownerList?.[0]?.email ?? "—";
  ```
- **Estado `ownersError`** y banner ámbar no bloqueante arriba de la tabla cuando la carga de owners falla; el `.catch` setea `setOwners({})` y guarda el mensaje.

## 3. `src/routes/select-tenant.tsx` — filtrar system tenants

Filtrar `memberships` donde `m.tenants?.is_system === false` (o no esté marcado) antes de renderizar las opciones, para que el super_admin no vea MEXINTLI HQ como opción de "entrar". Confirmé que el componente ya hace `m.tenants.name`, así que `is_system` está disponible vía la relación. Si el tipo no lo expone aún, hacer cast defensivo.

> Nota: requiere que `useAuth()` traiga `is_system` en el select de memberships. Reviso `src/lib/auth-context.tsx` durante la implementación y, si falta, lo agrego al select de tenants.

## 4. `src/routes/index.tsx` — routing super_admin

Ya está aplicado el bloque `if (role === "super_admin") { void navigate({ to: "/admin" }); }`. Solo añadir `return;` después del navigate para evitar fall-through.

## 5. `src/utils/admin.functions.ts` — `getTenantOwners` no lanza al cliente

Envolver el cuerpo (después de `assertSuperAdmin`) en try/catch:

```ts
.handler(async ({ context }) => {
  await assertSuperAdmin(context.userId);
  try {
    // ... lógica actual ...
    return { ownersByTenant };
  } catch (e) {
    console.error("getTenantOwners failed:", e);
    return { ownersByTenant: {}, warning: "No se pudieron cargar los dueños" };
  }
});
```

`assertSuperAdmin` sigue lanzando (eso es correcto: 401/403 son intencionales).

## 6. `src/routes/admin.tsx` — indicador en sidebar

En el footer del sidebar, justo arriba del `<div>` con `user?.email`:

```tsx
<div className="px-3 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
  Super admin · MEXINTLI HQ
</div>
```

## NO se hace

- UI para gestión de super_admins (manual con SQL)
- Cambios a `/admin/tenants/$id` (sigue accesible por URL directa)
- Cambios a RLS
- Borrar/renombrar MEXINTLI HQ

## Verificación post-cambio

1. `npx tsc --noEmit` pasa
2. `/admin/tenants` muestra empty state (MEXINTLI HQ oculto)
3. Crear tenant nuevo desde "+ Nuevo tenant" aparece en la lista
4. Re-login → `/admin/tenants` sin 401 ni crash en consola
5. `/select-tenant` no muestra MEXINTLI HQ al super_admin
