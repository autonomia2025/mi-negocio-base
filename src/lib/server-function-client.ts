import { supabase } from "@/integrations/supabase/client";

export const SESSION_EXPIRED_MESSAGE =
  "Tu sesión expiró. Refresca la página e inicia sesión de nuevo para continuar.";

export async function getServerFunctionAuthHeaders(): Promise<HeadersInit> {
  const { data, error } = await supabase.auth.getSession();
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  return { Authorization: `Bearer ${accessToken}` };
}

export function isSessionExpiredError(error: unknown) {
  if (error instanceof Response) return true;

  if (error && typeof error === "object") {
    const maybeStatus = (error as { status?: unknown }).status;
    if (maybeStatus === 401) return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    message === SESSION_EXPIRED_MESSAGE ||
    /\b401\b|unauthorized|invalid token|authorization header|no token/i.test(
      message,
    )
  );
}

export function getServerFunctionErrorMessage(
  error: unknown,
  fallback = "Error desconocido",
) {
  if (isSessionExpiredError(error)) return SESSION_EXPIRED_MESSAGE;
  if (error instanceof Error) return error.message;
  return fallback;
}