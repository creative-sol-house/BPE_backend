// model/AttendanceSession.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Employee from './employee';
import Holiday from './holiday';

/* ══════════════════════════════════════════════════════════════
   Constants (mirrored on the client in attendanceSessionApi.ts)
   ══════════════════════════════════════════════════════════════ */

export const SLOT_INTERVAL_MIN = 30;   // one check-in slot every 30 min
export const GRACE_MIN = 5;            // 5-min window to mark each slot
export const BREAK_LIMIT_MIN = 75;     // 1 h 15 m total per day

/* ══════════════════════════════════════════════════════════════
   Types
   ══════════════════════════════════════════════════════════════ */

export type CheckInType =
  | 'regular'
  | 'missed'
  | 'break-start'
  | 'break-end'
  | 'break';                            // slot fell inside a break

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
  _id: Types.ObjectId;

  employee: Types.ObjectId;
  user: Types.ObjectId;
  employeeId: string;
  employeeName: string;
  department: string;

  date: Date;

  // Schedule grid
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

export interface SessionMonthlySummary {
  month: string;
  totalWorkedMin: number;
  totalWorkedHours: number;
  totalBreakMin: number;
  daysPresent: number;
  totalMissed: number;
  days: IAttendanceSession[];
}

export interface IAttendanceSessionModel extends Model<IAttendanceSession> {
  normalizeDate(d: Date | string): Date;
  startDay(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  checkIn(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  startBreak(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  endBreak(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  endDay(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  /** @deprecated use backfillMissedSlots — kept for backward compatibility */
  markMissedCheckIns(userId: Types.ObjectId | string): Promise<void>;
  backfillMissedSlots(userId: Types.ObjectId | string): Promise<void>;
  getMonthlySummary(
    userId: Types.ObjectId | string,
    monthStart: Date
  ): Promise<SessionMonthlySummary>;
}

/* ══════════════════════════════════════════════════════════════
   Helpers (pure)
   ══════════════════════════════════════════════════════════════ */

function normalizeDate(d: Date | string): Date {
  const dt = new Date(d);
  return new Date(
    Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate())
  );
}

function isWeekend(d: Date): boolean {
  const dow = d.getUTCDay();
  return dow === 0 || dow === 6;
}

/** Build "today at HH:mm" as a UTC midnight-anchored Date. */
function atTimeOnDate(dateUtcMidnight: Date, hhmm: string): Date {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm || '');
  const hour = m ? Number(m[1]) : 9;
  const min = m ? Number(m[2]) : 0;
  return new Date(
    Date.UTC(
      dateUtcMidnight.getUTCFullYear(),
      dateUtcMidnight.getUTCMonth(),
      dateUtcMidnight.getUTCDate(),
      hour,
      min,
      0,
      0
    )
  );
}



/** Is `t` strictly inside any break interval? (open breaks use `nowMs`) */
function insideAnyBreak(breaks: IBreakInterval[], t: Date, nowMs: number): boolean {
  const ms = t.getTime();
  for (const b of breaks) {
    const s = new Date(b.start).getTime();
    const e = b.end ? new Date(b.end).getTime() : nowMs;
    if (ms > s && ms < e) return true;
  }
  return false;
}

/** Has the slot been recorded as regular / missed / break already? */
function isSlotRecorded(checkIns: ICheckIn[], slotMs: number): boolean {
  for (const c of checkIns) {
    if (
      (c.type === 'regular' || c.type === 'missed' || c.type === 'break') &&
      new Date(c.scheduledFor).getTime() === slotMs
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve the employee's assigned check-in time ("HH:mm").
 *
 * Employee model fields used:
 *   • standardCheckIn  — primary source ("09:00" / "12:00")
 *   • standardCheckOut — fallback if check-in is malformed
 * If neither parses, falls back to 09:00.
 */
function resolveShiftStart(emp: any): string {
  const ci = typeof emp?.standardCheckIn === 'string' ? emp.standardCheckIn.trim() : '';
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(ci)) return ci;

  const co = typeof emp?.standardCheckOut === 'string' ? emp.standardCheckOut.trim() : '';
  if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(co)) return co; // last resort — still better than 9:00

  return '09:00';
}

/* ══════════════════════════════════════════════════════════════
   Sub-schemas
   ══════════════════════════════════════════════════════════════ */

const BreakIntervalSchema = new Schema<IBreakInterval>(
  {
    start: { type: Date, required: true },
    end: { type: Date, default: null },
    durationMin: { type: Number, default: 0, min: 0 },
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

/* ══════════════════════════════════════════════════════════════
   Session schema
   ══════════════════════════════════════════════════════════════ */

const AttendanceSessionSchema = new Schema<
  IAttendanceSession,
  IAttendanceSessionModel
>(
  {
    employee: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    employeeId: { type: String, required: true, trim: true },
    employeeName: { type: String, required: true, trim: true },
    department: { type: String, default: '', trim: true },

    date: { type: Date, required: true, index: true },

    // Schedule grid
    scheduledStartAt: { type: Date, default: null },
    scheduleIntervalMin: { type: Number, default: SLOT_INTERVAL_MIN, min: 1 },

    startAt: { type: Date, default: null },
    endAt: { type: Date, default: null },
    isActive: { type: Boolean, default: false },
    isWorkingDay: { type: Boolean, default: true },

    checkIns: { type: [CheckInSchema], default: [] },
    checkInCount: { type: Number, default: 0, min: 0 },
    missedCount: { type: Number, default: 0, min: 0 },

    breaks: { type: [BreakIntervalSchema], default: [] },
    breakUsedMin: { type: Number, default: 0, min: 0 },

    workedMin: { type: Number, default: 0, min: 0 },
    workedHours: { type: Number, default: 0, min: 0 },

    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

/* ── Indexes ──────────────────────────────────────────────────── */
AttendanceSessionSchema.index({ user: 1, date: 1 }, { unique: true });
AttendanceSessionSchema.index({ employee: 1, date: 1 });
AttendanceSessionSchema.index({ date: -1, isActive: 1 });
AttendanceSessionSchema.index({ employeeId: 1, date: -1 });

/* ══════════════════════════════════════════════════════════════
   STATIC: backfillMissedSlots

   Walks the schedule grid from scheduledStartAt → (now − graceMs).
   For each slot not yet recorded:
     • inside a break   → push { type:'break',  status:'done'  }
     • grace has closed → push { type:'missed', status:'missed' } + missedCount++
   Idempotent. Also closes any open break whose end was never set
   when a new day rolls over (defensive, harmless on same day).
   ══════════════════════════════════════════════════════════════ */

AttendanceSessionSchema.statics.backfillMissedSlots = async function (
  userId: Types.ObjectId | string
): Promise<void> {
  const today = normalizeDate(new Date());

  const session = await this.findOne({
    user: userId,
    date: today,
    isDeleted: false,
  });
  if (!session) return;
  if (!session.isWorkingDay) return;
  if (!session.scheduledStartAt) return;

  const intervalMs =
    (session.scheduleIntervalMin || SLOT_INTERVAL_MIN) * 60_000;
  const graceMs = GRACE_MIN * 60_000;
  const nowMs = Date.now();

  // Never auto-mark beyond the end of the day if the user ended it
  const cutoffMs = session.endAt
    ? Math.min(nowMs, new Date(session.endAt).getTime())
    : nowMs;

  let cursor = new Date(session.scheduledStartAt).getTime();
  let dirty = false;

  // Safety: cap at 24 h worth of slots (48 slots at 30 min)
  const maxSlots = Math.ceil((24 * 60) / (session.scheduleIntervalMin || SLOT_INTERVAL_MIN));

  for (let i = 0; i < maxSlots; i++) {
    const slotMs = cursor;
    const graceCloseMs = slotMs + graceMs;

    // Stop as soon as we reach a slot whose grace hasn't closed yet
    if (graceCloseMs > cutoffMs) break;

    if (!isSlotRecorded(session.checkIns, slotMs)) {
      const slotDate = new Date(slotMs);

      if (insideAnyBreak(session.breaks, slotDate, cutoffMs)) {
        // Slot fell inside a break → record as break + work, not a miss
        session.checkIns.push({
          at: new Date(slotMs),
          scheduledFor: slotDate,
          status: 'done',
          type: 'break',
        });
      } else {
        session.checkIns.push({
          at: new Date(graceCloseMs),
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

  if (dirty) {
    session.markModified('checkIns');
    await session.save();
  }
};

/** Alias kept for backward compatibility. */
AttendanceSessionSchema.statics.markMissedCheckIns = async function (
  userId: Types.ObjectId | string
): Promise<void> {
  return this.backfillMissedSlots(userId);
};

/* ══════════════════════════════════════════════════════════════
   STATIC: startDay

   • Anchors the grid to employee.standardCheckIn ("HH:mm")
   • Idempotent: if today's session already started, returns it
   • Immediately backfills expired slots so the client's
     meta.nextSlotAt is accurate on first paint
   ══════════════════════════════════════════════════════════════ */

AttendanceSessionSchema.statics.startDay = async function (
  userId: Types.ObjectId | string
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());

  const emp = await Employee.findOne({ user: userId, isDeleted: false });
  if (!emp) {
    throw Object.assign(new Error('No employee record linked'), { status: 404 });
  }

  const scheduledStartAt = atTimeOnDate(today, resolveShiftStart(emp));

  const holidays = await Holiday.forDate(today);
  const isWorkingDay = !isWeekend(today) && holidays.length === 0;

  let session = await this.findOne({
    user: userId,
    date: today,
    isDeleted: false,
  });

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
    // Only fill missing fields; never re-anchor an existing grid
    session.startAt = session.startAt ?? new Date();
    session.isActive = true;
    session.isWorkingDay = isWorkingDay;
    if (!session.scheduledStartAt) session.scheduledStartAt = scheduledStartAt;
    if (!session.scheduleIntervalMin) session.scheduleIntervalMin = SLOT_INTERVAL_MIN;
  }

  await session.save();

  // Backfill already-expired slots (e.g. 12:00, 12:30, 13:00 when
  // the employee starts at 13:12 with a 12:00 shift)
  await this.backfillMissedSlots(userId);

  return (await this.findById(session._id))!;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: checkIn

   Records at = now, scheduledFor = the currently-open slot.
   Timestamp logic unchanged — only slots whose grace window
   contains "now" are eligible.
   ══════════════════════════════════════════════════════════════ */

AttendanceSessionSchema.statics.checkIn = async function (
  userId: Types.ObjectId | string
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());

  const session = await this.findOne({
    user: userId,
    date: today,
    isDeleted: false,
  });
  if (!session) {
    throw Object.assign(new Error('No active session'), { status: 404 });
  }
  if (!session.isActive || session.endAt) {
    throw Object.assign(new Error('Session is not active'), { status: 409 });
  }
  if (!session.scheduledStartAt) {
    throw Object.assign(new Error('Session has no schedule anchor'), { status: 409 });
  }

  // Finalize anything already expired first
  await this.backfillMissedSlots(userId);
const fresh = await this.findById(session._id);
if (!fresh) {
  throw Object.assign(new Error('Session vanished'), { status: 404 });
}
// Narrow the nullable anchor — TS needs this even though `session`
// was already checked, because `findById` re-types it as `Date | null`.
if (!fresh.scheduledStartAt) {
  throw Object.assign(new Error('Session has no schedule anchor'), {
    status: 409,
  });
}
const anchorMs = new Date(fresh.scheduledStartAt).getTime();

const intervalMs =
  (fresh.scheduleIntervalMin || SLOT_INTERVAL_MIN) * 60_000;
const graceMs = GRACE_MIN * 60_000;
const nowMs = Date.now();

// Find the slot whose grace window contains "now"
let cursor = anchorMs;
  let openSlot: Date | null = null;
  const maxSlots = Math.ceil(
    (24 * 60) / (fresh.scheduleIntervalMin || SLOT_INTERVAL_MIN)
  );

  for (let i = 0; i < maxSlots; i++) {
    if (cursor > nowMs) break; // future → stop
    const graceCloseMs = cursor + graceMs;

    if (nowMs <= graceCloseMs) {
      const slotDate = new Date(cursor);
      const recorded = isSlotRecorded(fresh.checkIns, cursor);
      const onBreak = insideAnyBreak(fresh.breaks, slotDate, nowMs);
      if (!recorded && !onBreak) openSlot = slotDate;
      break; // only the first slot at/after now matters
    }
    cursor += intervalMs;
  }

  if (!openSlot) {
    throw Object.assign(
      new Error('No slot is currently open for check-in'),
      { status: 409 }
    );
  }

  fresh.checkIns.push({
    at: new Date(nowMs),
    scheduledFor: openSlot,
    status: 'done',
    type: 'regular',
  });
  fresh.checkInCount += 1;
  fresh.markModified('checkIns');
  await fresh.save();

  return fresh;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: startBreak
   ══════════════════════════════════════════════════════════════ */

AttendanceSessionSchema.statics.startBreak = async function (
  userId: Types.ObjectId | string
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());

  const session = await this.findOne({
    user: userId,
    date: today,
    isDeleted: false,
  });
  if (!session) {
    throw Object.assign(new Error('No active session'), { status: 404 });
  }
  if (!session.isActive || session.endAt) {
    throw Object.assign(new Error('Session is not active'), { status: 409 });
  }
  if (session.breaks.some((b) => !b.end)) {
    throw Object.assign(new Error('Already on break'), { status: 409 });
  }
  if (session.breakUsedMin >= BREAK_LIMIT_MIN) {
    throw Object.assign(new Error('Break limit reached'), { status: 409 });
  }

  // Finalize any slot whose grace closed before this break
  await this.backfillMissedSlots(userId);

  const fresh = await this.findById(session._id);
  if (!fresh) {
    throw Object.assign(new Error('Session vanished'), { status: 404 });
  }

  const now = new Date();
  fresh.breaks.push({ start: now, end: null, durationMin: 0 });
  fresh.checkIns.push({
    at: now,
    scheduledFor: now,
    status: 'done',
    type: 'break-start',
  });
  fresh.markModified('breaks');
  fresh.markModified('checkIns');
  await fresh.save();

  return fresh;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: endBreak
   ══════════════════════════════════════════════════════════════ */

AttendanceSessionSchema.statics.endBreak = async function (
  userId: Types.ObjectId | string
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());

  const session = await this.findOne({
    user: userId,
    date: today,
    isDeleted: false,
  });
  if (!session) {
    throw Object.assign(new Error('No active session'), { status: 404 });
  }

  const openBreak = session.breaks.find((b) => !b.end);
  if (!openBreak) {
    throw Object.assign(new Error('Not on break'), { status: 409 });
  }

  const now = new Date();
  openBreak.end = now;
  openBreak.durationMin = Math.max(
    0,
    Math.round((now.getTime() - new Date(openBreak.start).getTime()) / 60_000)
  );
  session.breakUsedMin = Math.min(
    BREAK_LIMIT_MIN,
    session.breakUsedMin + openBreak.durationMin
  );

  session.checkIns.push({
    at: now,
    scheduledFor: now,
    status: 'done',
    type: 'break-end',
  });

  session.markModified('breaks');
  session.markModified('checkIns');
  await session.save();

  // Auto-mark any slot that fell inside the break as type:'break'
  await this.backfillMissedSlots(userId);

  return (await this.findById(session._id))!;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: endDay
   ══════════════════════════════════════════════════════════════ */

AttendanceSessionSchema.statics.endDay = async function (
  userId: Types.ObjectId | string
): Promise<IAttendanceSession> {
  const today = normalizeDate(new Date());

  const session = await this.findOne({
    user: userId,
    date: today,
    isDeleted: false,
  });
  if (!session) {
    throw Object.assign(new Error('No active session'), { status: 404 });
  }

  // Finalize expired slots so missedCount is accurate at end of day
  await this.backfillMissedSlots(userId);

  const fresh = await this.findById(session._id);
  if (!fresh) {
    throw Object.assign(new Error('Session vanished'), { status: 404 });
  }

  // Close any open break
  const openBreak = fresh.breaks.find((b) => !b.end);
  if (openBreak) {
    const now = new Date();
    openBreak.end = now;
    openBreak.durationMin = Math.max(
      0,
      Math.round((now.getTime() - new Date(openBreak.start).getTime()) / 60_000)
    );
    fresh.breakUsedMin = Math.min(
      BREAK_LIMIT_MIN,
      fresh.breakUsedMin + openBreak.durationMin
    );
    fresh.markModified('breaks');
  }

  const now = new Date();
  fresh.endAt = now;
  fresh.isActive = false;

  if (fresh.startAt) {
    const totalMin = Math.max(
      0,
      Math.round(
        (now.getTime() - new Date(fresh.startAt).getTime()) / 60_000
      )
    );
    fresh.workedMin = Math.max(0, totalMin - fresh.breakUsedMin);
    fresh.workedHours = Math.round((fresh.workedMin / 60) * 100) / 100;
  }

  await fresh.save();
  return fresh;
};

/* ══════════════════════════════════════════════════════════════
   STATIC: getMonthlySummary
   ══════════════════════════════════════════════════════════════ */

AttendanceSessionSchema.statics.getMonthlySummary = async function (
  userId: Types.ObjectId | string,
  monthStart: Date
): Promise<SessionMonthlySummary> {
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
  const daysPresent = days.filter((d) => !!d.startAt).length;

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

/* ══════════════════════════════════════════════════════════════
   Export
   ══════════════════════════════════════════════════════════════ */

const AttendanceSession =
  (mongoose.models.AttendanceSession as IAttendanceSessionModel) ||
  mongoose.model<IAttendanceSession, IAttendanceSessionModel>(
    'AttendanceSession',
    AttendanceSessionSchema
  );

export default AttendanceSession;