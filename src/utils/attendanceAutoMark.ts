// utils/attendanceAutoMark.ts
import mongoose from 'mongoose';
import Attendance, { type AttendanceStatus } from '../model/attendance';
import Employee from '../model/employee';
import Holiday from '../model/holiday';
import {
  normalizeDate,
  isWeekend,
  deriveStatus,
  computeWorkedHours,
} from './attendanceHelper';

type MarkAction = 'created' | 'updated' | 'skipped';

type MarkReason =
  | 'first-login-of-day'
  | 'already-marked-today'
  | 'locked-manual'
  | 'no-employee'
  | 'nothing-to-check-out';

export interface MarkResult {
  record: any | null;
  action: MarkAction;
  reason?: MarkReason;
}

/**
 * Idempotent login/logout attendance marker.
 *
 * Rules:
 *  - LOGIN  : only the FIRST login of the day creates the record.
 *             Every subsequent login is a no-op.
 *  - LOGOUT : only updates departureAt / workedHours / status.
 *             Never touches arrivalAt.
 *  - Manual overrides (source === 'manual' or status leave/holiday)
 *    are never overwritten.
 *
 * `userId` accepts both `string` and Mongoose `ObjectId` so callers
 * can pass `req.user._id` directly without casting.
 */
export async function markAttendanceFromAuth(
  userId: string | mongoose.Types.ObjectId | undefined,
  event: 'login' | 'logout',
  when: Date = new Date()
): Promise<MarkResult> {
  if (!userId) {
    return { record: null, action: 'skipped', reason: 'no-employee' };
  }

  // Normalize once — everything downstream uses the string form.
  const userIdStr = String(userId);

  const emp = await Employee.findOne({ user: userIdStr, isDeleted: false });
  if (!emp) {
    return { record: null, action: 'skipped', reason: 'no-employee' };
  }

  const date = normalizeDate(when);
  const existing = await Attendance.findOne({ employee: emp._id, date });

  /* ══════════════════════════════════════════════════════════════
     LOGIN — first login of the day wins. Everything else is a no-op.
     ══════════════════════════════════════════════════════════════ */
  if (event === 'login') {
    // Any existing row (active OR soft-deleted) means "already marked".
    // We never overwrite, never resurrect. Admins own that decision.
    if (existing) {
      return {
        record: existing,
        action: 'skipped',
        reason: 'already-marked-today',
      };
    }

    // First login of the day → create.
    const holidays = await Holiday.forDate(date);
    const weekend = isWeekend(date);

    let status: AttendanceStatus;
    if (holidays.length > 0) status = 'holiday';
    else if (weekend) status = 'weekend';
    else status = deriveStatus(date, when, null);

    const created = await new Attendance({
      employee: emp._id,
      user: emp.user || null,
      employeeId: emp.employeeId,
      employeeName: emp.name,
      department: emp.department || '',
      date,
      arrivalAt: when,
      departureAt: null,
      workedHours: 0,
      status,
      source: 'auto',
      isDeleted: false,
    }).save();

    return { record: created, action: 'created', reason: 'first-login-of-day' };
  }

  /* ══════════════════════════════════════════════════════════════
     LOGOUT — only moves departureAt forward.
     ══════════════════════════════════════════════════════════════ */
  if (event === 'logout') {
    if (!existing || existing.isDeleted) {
      return {
        record: existing ?? null,
        action: 'skipped',
        reason: 'nothing-to-check-out',
      };
    }

    // Manual / leave / holiday rows are sacred. Widen the union back
    // before comparing so TS doesn't complain about a dead branch.
    const source = existing.source as 'auto' | 'manual';
    const isManual =
      source === 'manual' ||
      existing.status === 'leave' ||
      existing.status === 'holiday';

    if (isManual) {
      return { record: existing, action: 'skipped', reason: 'locked-manual' };
    }

    const arr = existing.arrivalAt;
    if (!arr) {
      // Defensive: shouldn't happen, but don't fabricate an arrival.
      return {
        record: existing,
        action: 'skipped',
        reason: 'nothing-to-check-out',
      };
    }

    const dep = when;
    existing.departureAt = dep;
    existing.workedHours = computeWorkedHours(arr, dep);
    existing.status = deriveStatus(date, arr, dep);
    await existing.save();

    return { record: existing, action: 'updated' };
  }

  return { record: null, action: 'skipped' };
}