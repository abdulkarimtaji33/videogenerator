function getStatus(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in err) {
    return (err as { status?: number }).status;
  }
  return undefined;
}

/** Extracts the "try again in Ns" hint OpenAI puts in 429 error messages, if present. */
function getRetryAfterMs(err: unknown): number | undefined {
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/try again in (\d+(?:\.\d+)?)s/i);
  return match ? Math.ceil(parseFloat(match[1]) * 1000) : undefined;
}

const NETWORK_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

/** A dropped or failed connection (no HTTP status): worth retrying. */
export function isNetworkError(err: unknown): boolean {
  for (let e: any = err, depth = 0; e && depth < 4; e = e.cause, depth++) {
    if (e.name === "APIConnectionError" || e.name === "APIConnectionTimeoutError") return true;
    if (typeof e.code === "string" && NETWORK_CODES.has(e.code)) return true;
    if (e instanceof TypeError && /terminated|fetch failed/i.test(e.message)) return true;
  }
  return false;
}

/**
 * Retries `fn` on rate limit (429), transient server errors (>=500) and dropped connections, with
 * exponential backoff. Any other error is thrown immediately without retrying.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 2000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = getStatus(err);
      const retryable = status === 429 || (typeof status === "number" && status >= 500) || (status === undefined && isNetworkError(err));
      if (!retryable || attempt === retries) {
        throw err;
      }
      const delay = getRetryAfterMs(err) ?? baseDelayMs * 2 ** attempt;
      const message = err instanceof Error ? err.message : String(err);
      console.warn(
        `Retrying after ${status ?? "network"} error (attempt ${attempt + 1}/${retries}, waiting ${delay}ms): ${message}`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
