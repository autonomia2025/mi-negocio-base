# Plan: Resolver `invalid input syntax for type uuid: "undefined"` al crear tenant

## Diagnóstico confirmado

Hay **tres causas** combinadas que producen los errores que viste:

1. **Sesión expirada (401s en consola)** — Estás actualmente en `/login`. Las llamadas a server functions (`/_serverFn/...`) devuelven 401 porque `requireSupabaseAuth` rechaza el token. Esto sólo se arregla **re-logueándote**, no es un bug de código.

2. **Lógica frágil en `createTenantWithOwner`** (`src/utils/admin.functions.ts`) — Si `supabaseAdmin.auth.admin.createUser` falla por **cualquier motivo distinto** a "email duplicado" (p. ej. password débil, rate limit, validación de Supabase Auth), el código entra al bloque `else` con `ownerUserId = null`, pero el `if (!ownerUserId)` lanza correctamente. El problema es que el `msg.includes("already")` es brittle: si Supabase cambia el wording, o si el email **sí** está duplicado pero en una página posterior del `listUsers` (limit 200), `ownerUserId` queda como `null`/`undefined` y el insert a `tenants` o `user_tenants` revienta con UUID inválido.

3. **Navegación ciega en el wizard** (`src/routes/admin.tenants.new.tsx` línea 95) — Al terminar `submit()`, navega a `/admin/tenants/$id` con `res.tenantId` sin validar que exista. Si la server function devuelve un objeto malformado (p. ej. por el bug #2), TanStack Router pasa `undefined` como param, y el detalle hace `.eq("id", "undefined")` → 400 de Supabase REST.

## Cambios

### 1. `src/utils/admin.functions.ts` — lookup-first y validaciones

Añadir helper paginado:

```ts
async function findUserIdByEmail(email: string): Promise<string | null> {
  const target = email.toLowerCase();
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page, perPage: 200,
    });
    if (error) throw new Error(error.message);
    const found = data.users.find((u) => u.email?.toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}
```

Refactorizar `createTenantWithOwner`:
- **Primero** buscar si el email ya existe con `findUserIdByEmail`.
- Si existe → usar ese `userId` (no intentar crear).
- Si no existe → crear con `createUser`. Si falla, propagar el mensaje real de Supabase (no asumir "duplicado").
- Validar explícitamente `if (!ownerUserId || typeof ownerUserId !== "string") throw new Error("No se pudo obtener el id del usuario dueño")` **antes** de cualquier insert.
- Mismo refactor en `inviteUserToTenant`.

### 2. `src/routes/admin.tenants.new.tsx` — navegación defensiva

Reemplazar el bloque `submit` (líneas ~94-95):

```ts
const res = await createTenantWithOwner({ data: { ... } });
if (!res?.tenantId) {
  throw new Error("La creación no devolvió un id de tenant válido");
}
void navigate({ to: "/admin/tenants/$id", params: { id: res.tenantId } });
```

Esto evita el `id=eq.undefined` aunque haya un bug aguas arriba.

### 3. `src/routes/admin.tenants.$id.tsx` — guard de param

Al inicio de `TenantDetail`, después de `const { id } = Route.useParams()`:

```ts
if (!id || id === "undefined") {
  return (
    <div className="space-y-3">
      <Link to="/admin/tenants" className="text-xs text-muted-foreground hover:text-foreground">
        ← Volver a tenants
      </Link>
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
        ID de tenant inválido. Vuelve al listado y selecciona un tenant válido.
      </div>
    </div>
  );
}
```

Esto previene el 400 a `/rest/v1/tenants?id=eq.undefined` aunque alguien navegue manual a la URL rota.

### 4. Mejor feedback en el wizard

El `catch` en `submit()` ya muestra `e.message`. Con el fix #1, ahora el mensaje será real (p. ej. "Password should be at least 6 characters") en vez de un crash silencioso.

## NO se hace

- No tocar RLS ni esquema DB (no es necesario).
- No tocar `assertSuperAdmin` (sigue lanzando 401/403, eso es correcto).
- No tocar `getTenantOwners` (ya tiene try/catch del fix anterior).

## Acción requerida del usuario antes de probar

**Re-loguearte** en `/login` con `jtmenesesg@gmail.com`. Los 401 que ves son por sesión expirada — sin login fresco, ningún fix de código va a funcionar porque el middleware rechaza la request antes de llegar al handler.

## Verificación post-cambio

1. `npx tsc --noEmit` pasa.
2. Re-login → ir a `/admin/tenants/new` → completar wizard con un email **nuevo** → debe crear tenant y redirigir a `/admin/tenants/<uuid-real>` sin errores en consola.
3. Repetir con un email **ya existente** → debe reusar el usuario y crear el tenant igualmente.
4. Repetir con password de 5 caracteres (forzar error de Supabase) → debe mostrar el mensaje real de Supabase en el banner rojo del paso 4, **sin** crash de UUID.
5. Visitar manualmente `/admin/tenants/undefined` → debe mostrar el empty state, sin 400 a Supabase REST.