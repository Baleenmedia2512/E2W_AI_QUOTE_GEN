/**
 * Supabase functions.invoke wraps non-2xx as "Edge Function returned a non-2xx…".
 * The real reason is usually in the response body on error.context.
 */

function readMessageFromBody(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as { error?: unknown; message?: unknown };
  if (typeof record.error === 'string' && record.error.trim()) {
    return record.error.trim();
  }
  if (typeof record.message === 'string' && record.message.trim()) {
    return record.message.trim();
  }
  return null;
}

export async function extractEdgeFunctionMessage(
  error: unknown,
  data: unknown,
  fallback: string,
): Promise<string> {
  const fromData = readMessageFromBody(data);
  if (fromData) return fromData;

  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context
    : undefined;

  try {
    if (context instanceof Response) {
      const body = await context.json();
      const fromBody = readMessageFromBody(body);
      if (fromBody) return fromBody;
    } else {
      const fromContext = readMessageFromBody(context);
      if (fromContext) return fromContext;
    }
  } catch {
    // Keep fallback when the response body cannot be parsed.
  }

  if (error && typeof error === 'object') {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === 'string' && msg.trim() && !/non-2xx/i.test(msg)) {
      return msg.trim();
    }
  }

  return fallback;
}
