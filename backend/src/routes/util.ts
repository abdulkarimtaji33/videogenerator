import type { ZodType } from "zod";
import { AppError } from "../errors";

/** Validates a request body with a zod schema and turns failures into a 400 with a readable message. */
export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new AppError(r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), 400);
  return r.data;
}

export function intParam(value: unknown, name = "id"): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new AppError(`invalid ${name}`, 400);
  return n;
}

export function jsonOr<T>(raw: unknown, fallback: T): T {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
