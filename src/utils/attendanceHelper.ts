// utils/attendanceHelper.ts
import type { AttendanceStatus } from '../model/attendance';

/* ══════════════════════════════════════════════════════════════
   BUSINESS TIMEZONE
   All "dates" in the system are UTC-midnight Date objects that
   represent a *calendar day in the business timezone*. Set the
   offset (in minutes) via env var. Default: UTC+5 (Pakistan).
   ══════════════════════════════════════════════════════════════ */
const TZ_OFFSET_MINUTES = Number(
  process.env.BUSINESS_TZ_OFFSET_MINUTES ?? 300 // +05:00
);

export const ATTENDANCE_RULES = {
  weekendDays: [0] as number[],
  shiftStartHour: 9,
  shiftStartMinute: 0,
  lateGraceMinutes: 15,
  halfDayAfterHour: 13,
  halfDayMinHours: 4,
};

/**
 * Normalizes any date-ish input into a UTC-midnight Date that
 * represents the calendar day in the BUSINESS timezone.
 *
 * Example (offset = +5h):
 *   2024-03-19T22:30:00Z  →  2024-03-20T00:00:00Z  (next day in PKT)
 *   2024-03-19T02:00:00Z  →  2024-03-19T00:00:00Z
 */
export function normalizeDate(d: Date | string): Date {
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return new Date(NaN);

  const shifted = new Date(date.getTime() + TZ_OFFSET_MINUTES * 60_000);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate()
    )
  );
}

/**
 * Strict YYYY-MM-DD validator. Rejects 2024-13-99, 2024-02-30,
 * trailing garbage, and non-strings. Round-trips through Date to
 * catch impossible calendar days.
 */
export function isValidISODate(s: unknown): boolean {
  if (typeof s !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00.000Z');
  if (Number.isNaN(d.getTime())) return false;
  return d.toISOString().startsWith(s);
}

/**
 * Weekend check against the BUSINESS timezone day.
 * Assumes `d` is already a UTC-midnight normalized date.
 */
export function isWeekend(d: Date): boolean {
  // Since d is UTC-midnight of the business day, getUTCDay() is the
  // correct weekday for that business day.
  return ATTENDANCE_RULES.weekendDays.includes(d.getUTCDay());
}

export function computeWorkedHours(
  arrivalAt?: Date | null,
  departureAt?: Date | null
): number {
  if (!arrivalAt || !departureAt) return 0;
  const ms = departureAt.getTime() - arrivalAt.getTime();
  if (ms <= 0) return 0;
  return +((ms / (1000 * 60 * 60)).toFixed(2));
}

/**
 * Derives an attendance status from times. Does NOT check holidays —
 * callers are responsible for that (they have DB access).
 *
 * Priority:
 *   1. Weekend → 'weekend'
 *   2. No arrival → 'absent'
 *   3. Arrived after halfDayAfterHour → 'half_day'
 *   4. Worked < halfDayMinHours → 'half_day'
 *   5. Arrived after grace → 'late'
 *   6. Otherwise → 'present'
 */
export function deriveStatus(
  date: Date,
  arrivalAt?: Date | null,
  departureAt?: Date | null
): AttendanceStatus {
  if (isWeekend(date)) return 'weekend';
  if (!arrivalAt) return 'absent';

  // Build shift boundaries in the business timezone, then express
  // them as UTC instants so they compare correctly against arrivalAt
  // (which is a real UTC timestamp).
  const shiftStart = new Date(
    date.getTime() +
      ATTENDANCE_RULES.shiftStartHour * 3_600_000 +
      ATTENDANCE_RULES.shiftStartMinute * 60_000 -
      TZ_OFFSET_MINUTES * 60_000
  );

  const grace = new Date(
    shiftStart.getTime() + ATTENDANCE_RULES.lateGraceMinutes * 60_000
  );

  const halfDayBoundary = new Date(
    date.getTime() +
      ATTENDANCE_RULES.halfDayAfterHour * 3_600_000 -
      TZ_OFFSET_MINUTES * 60_000
  );

  const workedHours = computeWorkedHours(arrivalAt, departureAt);

  if (arrivalAt >= halfDayBoundary) return 'half_day';
  if (departureAt && workedHours > 0 && workedHours < ATTENDANCE_RULES.halfDayMinHours) {
    return 'half_day';
  }
  if (arrivalAt > grace) return 'late';
  return 'present';
}