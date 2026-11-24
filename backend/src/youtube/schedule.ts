// Publish slot calculation in a channel's own time zone, without a date library.

/** Offset in minutes of `timeZone` from UTC at the given instant (positive = ahead of UTC). */
function offsetMinutes(timeZone: string, at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Converts a wall-clock time in `timeZone` to the UTC instant it represents. */
export function zonedTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const first = new Date(guess.getTime() - offsetMinutes(timeZone, guess) * 60000);
  // Second pass handles days where the offset changes (daylight saving).
  return new Date(guess.getTime() - offsetMinutes(timeZone, first) * 60000);
}

export function localDate(timeZone: string, at: Date): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const [y, m, d] = dtf.format(at).split("-").map(Number);
  return { y, m, d };
}

export interface SlotOptions {
  slots: string[];
  timeZone: string;
  now: Date;
  /** Slots already taken, as ISO strings (UTC). */
  taken?: string[];
  /** Maximum uploads per local day; days at the cap are skipped. */
  dailyCap?: number;
  /** Minimum minutes between now and the slot, so there is time to upload. */
  leadMinutes?: number;
}

/** The next free publish slot after `now`, honouring taken slots, the daily cap and a lead time. */
export function nextPublishSlot(o: SlotOptions): Date {
  const slots = (o.slots.length ? o.slots : ["09:00"]).map((s) => s.split(":").map(Number)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const taken = new Set((o.taken ?? []).map((t) => new Date(t).getTime()));
  const earliest = o.now.getTime() + (o.leadMinutes ?? 15) * 60000;
  const today = localDate(o.timeZone, o.now);
  const perDay = new Map<string, number>();
  for (const t of taken) {
    const ld = localDate(o.timeZone, new Date(t));
    const key = `${ld.y}-${ld.m}-${ld.d}`;
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
  }
  for (let add = 0; add < 60; add++) {
    const base = new Date(Date.UTC(today.y, today.m - 1, today.d + add));
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + 1;
    const d = base.getUTCDate();
    if (o.dailyCap && (perDay.get(`${y}-${m}-${d}`) ?? 0) >= o.dailyCap) continue;
    for (const [hh, mm] of slots) {
      const t = zonedTimeToUtc(y, m, d, hh, mm, o.timeZone);
      if (t.getTime() >= earliest && !taken.has(t.getTime())) return t;
    }
  }
  throw new Error("No free publish slot in the next 60 days; check the channel's slots and daily cap.");
}
