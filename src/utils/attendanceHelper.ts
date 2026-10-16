// utils/attendanceHelper.ts
import type { AttendanceStatus } from '../model/attendance';

/* ══════════════════════════════════════════════════════════════
   RULES — single source of truth
   ══════════════════════════════════════════════════════════════ */
export const ATTENDANCE_RULES = {
  /** Anything after this local time counts as late (24h, local tz). */
  LATE_AFTER_HOUR: 9,
  LATE_AFTER_MINUTE: 30,
  /** Worked-hours below this → half_day. */
  HALF_DAY_HOURS: 4,
  /** Worked-hours at/above this → full present. */
  FULL_DAY_HOURS: 8,
  /** Weekend days (0 = Sunday, 6 = Saturday). */
  WEEKEND_DAYS: [0, 6] as number[],
};

/* ══════════════════════════════════════════════════════════════
   Date helpers — all use UTC to stay consistent with Mongo.
   ══════════════════════════════════════════════════════════════ */

/** Normalize any date-like value to UTC midnight of that day. */
export function normalizeDate(input: Date | string): Date {
  const d = input instanceof Date ? input : new Date(input);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  );
}

/** Strict YYYY-MM-DD check. */
export function isValidISODate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(d.getTime());
}

/** True when the date falls on a configured weekend day. */
export function isWeekend(date: Date): boolean {
  return ATTENDANCE_RULES.WEEKEND_DAYS.includes(date.getUTCDay());
}

/* ══════════════════════════════════════════════════════════════
   Time helpers
   ══════════════════════════════════════════════════════════════ */

/** Round to 2 decimals of hours: 1h 30m → 1.5 */
export function computeWorkedHours(
  arrival: Date | null | undefined,
  departure: Date | null | undefined
): number {
  if (!arrival || !departure) return 0;
  const ms = departure.getTime() - arrival.getTime();
  if (ms <= 0) return 0;
  return Math.round((ms / 3_600_000) * 100) / 100;
}

/* ══════════════════════════════════════════════════════════════
   Status derivation
   ══════════════════════════════════════════════════════════════ */
export function deriveStatus(
  date: Date,
  arrival: Date | null | undefined,
  departure: Date | null | undefined
): AttendanceStatus {
  // No times → absent on a weekday.
  if (!arrival && !departure) return 'absent';

  // Late?
  if (arrival) {
    const lateCutoff = new Date(date);
    lateCutoff.setUTCHours(
      ATTENDANCE_RULES.LATE_AFTER_HOUR,
      ATTENDANCE_RULES.LATE_AFTER_MINUTE,
      0,
      0
    );
    if (arrival.getTime() > lateCutoff.getTime()) {
      // Late — but still check if they only worked half a day.
      const hrs = computeWorkedHours(arrival, departure);
      if (departure && hrs > 0 && hrs < ATTENDANCE_RULES.HALF_DAY_HOURS) {
        return 'half_day';
      }
      return 'late';
    }
  }

  // Worked hours bucket.
  const hrs = computeWorkedHours(arrival, departure);
  if (departure && hrs > 0 && hrs < ATTENDANCE_RULES.HALF_DAY_HOURS) {
    return 'half_day';
  }

  return 'present';
}