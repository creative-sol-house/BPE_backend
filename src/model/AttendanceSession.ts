// model/AttendanceSession.ts  (relevant sections — full file structure preserved)
import mongoose, { Schema, Document, Model } from 'mongoose';
import Employee from './employee';
import Holiday from './holiday';

/* ── Constants ──────────────────────────────────────────────── */
export const SLOT_INTERVAL_MIN = 30;
export const GRACE_MIN = 5;            // ← was 10
export const BREAK_LIMIT_MIN = 75;

/* ── Types ──────────────────────────────────────────────────── */
export type CheckInType =
  | 'regular'
  | 'missed'
  | 'break-start'
  | 'break-end'
  | 'break';                            // ← NEW: slot fell inside a break

export interface IBreakInterval {
  start: Date;
  end: Date | null;
  durationMin: number;
}

export interface ICheckIn {
  at: Date;
  scheduledFor: Date;
  status: 'done' | 'missed';
  type: CheckInType;
}

export interface IAttendanceSession extends Document {
  employee: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  employeeId: string;
  employeeName: string;
  department: string;
  date: Date;
  scheduledStartAt: Date | null;
  scheduleIntervalMin: number;
  startAt: Date | null;
  endAt: Date | null;
  isActive: boolean;
  isWorkingDay: boolean;
  checkIns: ICheckIn[];
  checkInCount: number;
  missedCount: number;
  breaks: IBreakInterval[];
  breakUsedMin: number;
  workedMin: number;
  workedHours: number;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAttendanceSessionModel extends Model<IAttendanceSession> {
  normalizeDate(d: Date | string): Date;
  startDay(userId: any): Promise<IAttendanceSession>;
  checkIn(userId: any): Promise<IAttendanceSession>;
  startBreak(userId: any): Promise<IAttendanceSession>;
  endBreak(userId: any): Promise<IAttendanceSession>;
  endDay(userId: any): Promise<IAttendanceSession>;
  markMissedCheckIns(userId: any): Promise<void>;
  backfillMissedSlots(userId: any): Promise<void>;   // ← NEW
  getMonthlySummary(userId: any, monthStart: Date): Promise<any>;
}

/* ── Helpers ────────────────────────────────────────────────── */

function normalizeDate(d: Date | string): Date {
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}



/** Is `t` strictly inside any break? */
function insideAnyBreak(breaks: IBreakInterval[], t: Date, nowMs: number): boolean {
  const ms = t.getTime();
  for (const b of breaks) {
    const s = new Date(b.start).getTime();
    const e = b.end ? new Date(b.end).getTime() : nowMs;
    if (ms > s && ms < e) return true;
  }
  return false;
}

/** Has this slot already been recorded (regular / missed / break)? */
function isSlotRecorded(checkIns: ICheckIn[], slotMs: number): boolean {
  return checkIns.some(
    (c) =>
      (c.type === 'regular' || c.type === 'missed' || c.type === 'break') &&
      new Date(c.scheduledFor).getTime() === slotMs
  );
}

/**
 * Resolve the shift start (hours, minutes) for an employee.
 * Priority: employee.shiftStartHour/Min → employee.checkInTime ("09:00") → 09:00
 */
function resolveShiftStart(emp: any): { hour: number; min: number } {
  if (Number.isFinite(emp?.shiftStartHour)) {
    return { hour: emp.shiftStartHour, min: emp.shiftStartMin ?? 0 };
  }
  const raw = emp?.checkInTime ?? emp?.shiftStart ?? emp?.startTime;
  if (typeof raw === 'string') {
    const m = raw.match(/^(\d{1,2}):(\d{2})/);
    if (m) return { hour: parseInt(m[1], 10), min: parseInt(m[2], 10) };
  }
  return { hour: 9, min: 0 };
}

/* ── Schema ─────────────────────────────────────────────────── */
const BreakIntervalSchema = new Schema<IBreakInterval>(
  {
    start: { type: Date, required: true },
    end: { type: Date, default: null },
    durationMin: { type: Number, default: 0 },
  },
  { _id: false }
);

const CheckInSchema = new Schema<ICheckIn>(
  {
    at: { type: Date, required: true },
    scheduledFor: { type: Date, required: true },
    status: { type: String, enum: ['done', 'missed'], required: true },
    type: {
      type: String,
      enum: ['regular', 'missed', 'break-start', 'break-end', 'break'],
      required: true,
    },
  },
  { _id: false }
);

const AttendanceSessionSchema = new Schema<IAttendanceSession, IAttendanceSessionModel>(
  {
    employee: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    employeeId: { type: String, required: true },
    employeeName: { type: String, required: true },
    department: { type: String, default: '' },
    date: { type: Date, required: true, index: true },
    scheduledStartAt: { type: Date, default: null },
    scheduleIntervalMin: { type: Number, default: SLOT_INTERVAL_MIN },
    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    isActive: { type: Boolean, default: false },
    isWorkingDay: { type: Boolean, default: true },
    checkIns: { type: [CheckInSchema], default: [] },
    checkInCount: { type: Number, default: 0 },
    missedCount: { type: Number, default: 0 },
    breaks: { type: [BreakIntervalSchema], default: [] },
    breakUsedMin: { type: Number, default: 0 },
    workedMin: { type: Number, default: 0 },
    workedHours: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

AttendanceSessionSchema.index({ user: 1, date: 1 }, { unique: true });

/* ══════════════════════════════════════════════════════════════
   STATIC: backfillMissedSlots
   Walks the grid from scheduledStartAt → (now − grace).
   For each unrecorded slot:
     • if it falls inside a break interval  → record type:'break', status:'done'
     • otherwise, if grace has closed       → record type:'missed', status:'missed'
   This is idempotent.
   ══════════════════════════════════════════════════════════════ */
AttendanceSessionSchema.statics.backfillMissedSlots = async function (
  userId: any
): Promise<void> {
  const today = normalizeDate(new Date());
  const session = await this.findOne({ user: userId, date: today, isDeleted: false });
  if (!session || !session.scheduledStartAt) return;
  if (!session.isWorkingDay) return;

  const intervalMs = (session.scheduleIntervalMin || SLOT_INTERVAL_MIN) * 60_000;
  const graceMs = GRACE_MIN * 60_000;
  const nowMs = Date.now();

  // Grace close of a slot at t is t + graceMs. We only finalize slots
  // whose grace window has fully closed.
  let cursor = new Date(session.scheduledStartAt).getTime();
  const maxSlots = 24 * 2 * 60; // safety
  let dirty = false;

  for (let i = 0; i < maxSlots; i++) {
    const slotMs = cursor;
    const graceCloseMs = slotMs + graceMs;

    // Stop once we reach a slot whose grace is still open
    if (graceCloseMs > nowMs) break;

    if (!isSlotRecorded(session.checkIns, slotMs)) {
      const slotDate = new Date(slotMs);

      if (insideAnyBreak(session.breaks, slotDate, nowMs)) {
        // Slot fell inside a break → not a miss, it's break + work
        session.checkIns.push({
          at: new Date(slotMs),           // marker time = slot time
          scheduledFor: slotDate,
          status: 'done',
          type: 'break',
        });
      } else {
        session.checkIns.push({
          at: new Date(graceCloseMs),     // missed at grace close
          scheduledFor: slotDate,
          status: 'missed',
          type: 'missed',
        });
        session.missedCount += 1;
      }
      dirty = true;
    }

    cursor += intervalMs;
  }

  if (dirty) await session.save();
};

/* Kept for backward-compat — now just delegates to backfillMissedSlots */
AttendanceSessionSchema.statics.markMissedCheckIns = async function (
  userId: any
): Promise<void> {
  return this.backfillMissedSlots(userId);
};

/* ══════════════════════════════════════════════════════════════
   STATIC: startDay
   Anchors the grid to the employee's assigned check-in time,
   then backfills every slot whose grace already closed.
   ══════════════════════════════════════════════════════════════ */
AttendanceSessionSchema.statics.startDay = async function (
  userId: any
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());

  const emp = await Employee.findOne({ user: userId, isDeleted: false });
  if (!emp) {
    throw Object.assign(new Error('No employee record linked'), { status: 404 });
  }

  const { hour, min } = resolveShiftStart(emp);
  const scheduledStartAt = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour, min, 0, 0)
  );

  const holidayList = await Holiday.forDate(today);
  const isWorkingDay = !isWeekend(today) && holidayList.length === 0;

  let session = await this.findOne({ user: userId, date: today, isDeleted: false });

  if (!session) {
    session = new this({
      employee: emp._id,
      user: emp.user ?? userId,
      employeeId: emp.employeeId,
      employeeName: emp.name,
      department: emp.department ?? '',
      date: today,
      scheduledStartAt,
      scheduleIntervalMin: SLOT_INTERVAL_MIN,
      startAt: new Date(),
      isActive: true,
      isWorkingDay,
      checkIns: [],
      breaks: [],
      breakUsedMin: 0,
      workedMin: 0,
      workedHours: 0,
      checkInCount: 0,
      missedCount: 0,
    });
  } else {
    session.startAt = session.startAt ?? new Date();
    session.isActive = true;
    session.isWorkingDay = isWorkingDay;
    // Re-anchor ONLY if missing (never overwrite an existing anchor)
    if (!session.scheduledStartAt) session.scheduledStartAt = scheduledStartAt;
  }

  await session.save();

  // Backfill every expired slot (12:00, 12:30, 1:00 if now is 1:12 & shift=12:00)
  await this.backfillMissedSlots(userId);

  return (await this.findById(session._id))!;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: checkIn
   Records `at = now`, `scheduledFor = current open slot`.
   Unchanged timestamp logic — only works on the open slot.
   ══════════════════════════════════════════════════════════════ */
AttendanceSessionSchema.statics.checkIn = async function (
  userId: any
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());
  const session = await this.findOne({ user: userId, date: today, isDeleted: false });
  if (!session) throw Object.assign(new Error('No active session'), { status: 404 });
  if (!session.isActive || session.endAt) {
    throw Object.assign(new Error('Session is not active'), { status: 409 });
  }
  if (!session.scheduledStartAt) {
    throw Object.assign(new Error('Session has no schedule anchor'), { status: 409 });
  }

  // Mark anything already expired first
  await this.backfillMissedSlots(userId);
  const fresh = await this.findById(session._id);
  if (!fresh) throw Object.assign(new Error('Session vanished'), { status: 404 });

  const intervalMs = (fresh.scheduleIntervalMin || SLOT_INTERVAL_MIN) * 60_000;
  const graceMs = GRACE_MIN * 60_000;
  const nowMs = Date.now();

  // Find the slot whose grace window contains "now"
  let cursor = new Date(fresh.scheduledStartAt!).getTime();
  let openSlot: Date | null = null;
  for (let i = 0; i < 24 * 2 * 60; i++) {
    if (cursor > nowMs) break; // future slot → stop
    const graceCloseMs = cursor + graceMs;
    if (nowMs <= graceCloseMs) {
      if (!isSlotRecorded(fresh.checkIns, cursor) && !insideAnyBreak(fresh.breaks, new Date(cursor), nowMs)) {
        openSlot = new Date(cursor);
      }
      break;
    }
    cursor += intervalMs;
  }

  if (!openSlot) {
    throw Object.assign(new Error('No slot is currently open for check-in'), { status: 409 });
  }

  fresh.checkIns.push({
    at: new Date(nowMs),
    scheduledFor: openSlot,
    status: 'done',
    type: 'regular',
  });
  fresh.checkInCount += 1;
  await fresh.save();

  return fresh;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: startBreak / endBreak
   ══════════════════════════════════════════════════════════════ */
AttendanceSessionSchema.statics.startBreak = async function (
  userId: any
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());
  const session = await this.findOne({ user: userId, date: today, isDeleted: false });
  if (!session) throw Object.assign(new Error('No active session'), { status: 404 });
  if (!session.isActive || session.endAt) {
    throw Object.assign(new Error('Session is not active'), { status: 409 });
  }
  if (session.breaks.some((b) => !b.end)) {
    throw Object.assign(new Error('Already on break'), { status: 409 });
  }
  if (session.breakUsedMin >= BREAK_LIMIT_MIN) {
    throw Object.assign(new Error('Break limit reached'), { status: 409 });
  }

  // Finalize any slots whose grace closed before the break started
  await this.backfillMissedSlots(userId);

  const fresh = await this.findById(session._id);
  if (!fresh) throw Object.assign(new Error('Session vanished'), { status: 404 });

  const now = new Date();
  fresh.breaks.push({ start: now, end: null, durationMin: 0 });
  fresh.checkIns.push({
    at: now,
    scheduledFor: now,
    status: 'done',
    type: 'break-start',
  });
  await fresh.save();
  return fresh;
};

AttendanceSessionSchema.statics.endBreak = async function (
  userId: any
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());
  const session = await this.findOne({ user: userId, date: today, isDeleted: false });
  if (!session) throw Object.assign(new Error('No active session'), { status: 404 });

  const openBreak = session.breaks.find((b) => !b.end);
  if (!openBreak) throw Object.assign(new Error('Not on break'), { status: 409 });

  const now = new Date();
  openBreak.end = now;
  openBreak.durationMin = Math.max(0, Math.round((now.getTime() - new Date(openBreak.start).getTime()) / 60_000));
  session.breakUsedMin += openBreak.durationMin;

  session.checkIns.push({
    at: now,
    scheduledFor: now,
    status: 'done',
    type: 'break-end',
  });

  await session.save();

  // Backfill any slots that fell inside the break → type:'break'
  await this.backfillMissedSlots(userId);

  return (await this.findById(session._id))!;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: endDay
   ══════════════════════════════════════════════════════════════ */
AttendanceSessionSchema.statics.endDay = async function (
  userId: any
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());
  const session = await this.findOne({ user: userId, date: today, isDeleted: false });
  if (!session) throw Object.assign(new Error('No active session'), { status: 404 });

  // Finalize expired slots so missedCount is accurate
  await this.backfillMissedSlots(userId);
  const fresh = await this.findById(session._id);
  if (!fresh) throw Object.assign(new Error('Session vanished'), { status: 404 });

  if (fresh.breaks.some((b) => !b.end)) {
    const ob = fresh.breaks.find((b) => !b.end)!;
    const now = new Date();
    ob.end = now;
    ob.durationMin = Math.max(0, Math.round((now.getTime() - new Date(ob.start).getTime()) / 60_000));
    fresh.breakUsedMin += ob.durationMin;
  }

  const now = new Date();
  fresh.endAt = now;
  fresh.isActive = false;
  if (fresh.startAt) {
    const totalMin = Math.max(0, Math.round((now.getTime() - new Date(fresh.startAt).getTime()) / 60_000));
    fresh.workedMin = Math.max(0, totalMin - fresh.breakUsedMin);
    fresh.workedHours = Math.round((fresh.workedMin / 60) * 100) / 100;
  }
  await fresh.save();
  return fresh;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: getMonthlySummary (unchanged — kept for compile)
   ══════════════════════════════════════════════════════════════ */
AttendanceSessionSchema.statics.getMonthlySummary = async function (
  userId: any,
  monthStart: Date
): Promise<any> {
  const y = monthStart.getUTCFullYear();
  const m = monthStart.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1));
  const to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));

  const days = await this.find({
    user: userId,
    date: { $gte: from, $lte: to },
    isDeleted: false,
  }).sort({ date: 1 });

  const totalWorkedMin = days.reduce((s, d) => s + (d.workedMin || 0), 0);
  const totalBreakMin = days.reduce((s, d) => s + (d.breakUsedMin || 0), 0);
  const totalMissed = days.reduce((s, d) => s + (d.missedCount || 0), 0);
  const daysPresent = days.filter((d) => d.startAt).length;

  return {
    month: `${y}-${String(m + 1).padStart(2, '0')}`,
    totalWorkedMin,
    totalWorkedHours: Math.round((totalWorkedMin / 60) * 100) / 100,
    totalBreakMin,
    daysPresent,
    totalMissed,
    days,
  };
};

AttendanceSessionSchema.statics.normalizeDate = normalizeDate;

const AttendanceSession =
  (mongoose.models.AttendanceSession as IAttendanceSessionModel) ||
  mongoose.model<IAttendanceSession, IAttendanceSessionModel>(
    'AttendanceSession',
    AttendanceSessionSchema
  );

export default AttendanceSession;