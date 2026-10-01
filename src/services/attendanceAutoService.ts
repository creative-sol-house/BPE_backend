// services/attendanceAutoService.ts
import Attendance from '../model/attendance';
import Employee from '../model/employee';
import Holiday from '../model/holiday';
import {
  normalizeDate,
  isWeekend,
  deriveStatus,
  computeWorkedHours,
} from '../utils/attendanceHelper';
import type { IUser } from '../model/user';

/**
 * Called right after a successful login.
 * Marks today's arrival.
 *
 * Rules:
 *  - If the user has no linked Employee row → silently skip.
 *  - If a MANUAL row exists for today → don't touch it.
 *  - If arrival is already set (second login today) → don't overwrite.
 *  - Weekend / holiday → create a placeholder row with no times.
 *  - Otherwise create or update today's row with arrivalAt = now.
 */
export async function markArrival(user: IUser): Promise<void> {
  try {
    const emp = await Employee.findOne({ user: user._id, isDeleted: false });
    if (!emp) return;

    const today = normalizeDate(new Date());

    const existing = await Attendance.findOne({
      employee: emp._id,
      date: today,
      isDeleted: false,
    });

    // Never clobber an admin's manual override
    if (existing && existing.source === 'manual') return;

    // Already clocked in today — keep the first arrival
    if (existing && existing.arrivalAt) return;

    const weekend = isWeekend(today);
    const holidays = await Holiday.forDate(today);
    const isHoliday = holidays.length > 0;

    // Weekend / holiday — just leave a marker row, no times
    if (weekend || isHoliday) {
      if (existing) return;
      await Attendance.create({
        employee: emp._id,
        user: emp.user || null,
        employeeId: emp.employeeId,
        employeeName: emp.name,
        department: emp.department || '',
        date: today,
        status: isHoliday ? 'holiday' : 'weekend',
        source: 'auto',
      });
      return;
    }

    const now = new Date();

    if (existing) {
      existing.arrivalAt = now;
      existing.status = deriveStatus(today, now, existing.departureAt);
      existing.workedHours = computeWorkedHours(now, existing.departureAt);
      existing.source = 'auto';
      await existing.save();
      return;
    }

    try {
      await Attendance.create({
        employee: emp._id,
        user: emp.user || null,
        employeeId: emp.employeeId,
        employeeName: emp.name,
        department: emp.department || '',
        date: today,
        arrivalAt: now,
        status: deriveStatus(today, now),
        source: 'auto',
      });
    } catch (e: any) {
      // Race: another login created the row between our find and create
      if (e?.code === 11000) {
        const rec = await Attendance.findOne({
          employee: emp._id,
          date: today,
          isDeleted: false,
        });
        if (rec && rec.source !== 'manual' && !rec.arrivalAt) {
          rec.arrivalAt = now;
          rec.status = deriveStatus(today, now, rec.departureAt);
          rec.workedHours = computeWorkedHours(now, rec.departureAt);
          rec.source = 'auto';
          await rec.save();
        }
      } else {
        throw e;
      }
    }
  } catch (err) {
    console.error('markArrival failed (non-fatal):', err);
  }
}

/**
 * Called right before logout.
 * Marks today's departure.
 *
 * Rules:
 *  - No Employee link → skip.
 *  - No row today / no arrival → skip (can't depart if you didn't arrive).
 *  - MANUAL row → skip entirely (admin owns this row).
 *  - Otherwise set departureAt = now (latest logout wins), recompute status.
 */
export async function markDeparture(user: IUser): Promise<void> {
  try {
    const emp = await Employee.findOne({ user: user._id, isDeleted: false });
    if (!emp) return;

    const today = normalizeDate(new Date());

    const rec = await Attendance.findOne({
      employee: emp._id,
      date: today,
      isDeleted: false,
    });

    if (!rec) return;
    if (!rec.arrivalAt) return;

    // Admin owns manual rows entirely — auto flow must not touch them.
    if (rec.source === 'manual') return;

    const now = new Date();

    // Keep the latest logout
    if (rec.departureAt && rec.departureAt.getTime() >= now.getTime()) return;

    rec.departureAt = now;
    rec.workedHours = computeWorkedHours(rec.arrivalAt, now);
    rec.status = deriveStatus(today, rec.arrivalAt, now);
    rec.source = 'auto';
    await rec.save();
  } catch (err) {
    console.error('markDeparture failed (non-fatal):', err);
  }
}