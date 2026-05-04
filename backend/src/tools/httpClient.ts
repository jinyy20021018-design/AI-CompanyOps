export type JsonRequestOptions = {
  timeoutMs: number;
  headers?: Record<string, string>;
};

export class ToolTimeoutError extends Error {
  constructor(message = "tool request timed out") {
    super(message);
    this.name = "ToolTimeoutError";
  }
}

export async function fetchJson<T>(url: string, options: JsonRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: options.headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json() as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ToolTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson<T>(url: string, body: unknown, options: JsonRequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.json() as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ToolTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, options: JsonRequestOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: options.headers,
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new ToolTimeoutError();
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
