// model/AttendanceSession.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Attendance, { AttendanceStatus } from './attendance';

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

export const SLOT_INTERVAL_MIN = 30;      // check-in slot every 30 min
export const GRACE_MIN        = 10;       // 10-min window to mark a slot
export const BREAK_LIMIT_MIN  = 75;       // 1h 15m total per day
export const FULL_DAY_MIN     = 8 * 60;   // 8h → "present"
export const HALF_DAY_MIN     = 4 * 60;   // 4h → "half_day"
export const DEFAULT_CHECKIN_HOUR = 9;    // fallback check-in time = 09:00
export const DEFAULT_CHECKIN_MIN  = 0;

const NON_WORKING_STATUSES: AttendanceStatus[] = ['leave', 'holiday', 'weekend', 'absent'];

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface IBreakInterval {
  start: Date;
  end: Date | null;
  durationMin: number;
}

export type CheckInType = 'regular' | 'missed' | 'break-start' | 'break-end';

export interface ICheckIn {
  at: Date;
  scheduledFor: Date;      // The exact clock-time slot (e.g., 13:00)
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
  date: Date;                       // midnight UTC
  scheduledStartAt: Date | null;    // e.g., 09:00 today
  scheduleIntervalMin: number;      // 30
  startAt: Date | null;             // actual start
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
  startDay(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  checkIn(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  startBreak(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  endBreak(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  endDay(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  markMissedCheckIns(userId: Types.ObjectId | string, now?: Date): Promise<number>;
  getMonthlySummary(userId: Types.ObjectId | string, month: Date): Promise<any>;
}

// ═══════════════════════════════════════════════════════════════════════
// SUB-SCHEMAS & MAIN SCHEMA
// ═══════════════════════════════════════════════════════════════════════

const breakIntervalSchema = new Schema<IBreakInterval>(
  {
    start:       { type: Date, required: true },
    end:         { type: Date, default: null },
    durationMin: { type: Number, default: 0, min: 0, max: BREAK_LIMIT_MIN },
  },
  { _id: false }
);

const checkInSchema = new Schema<ICheckIn>(
  {
    at:           { type: Date, required: true },
    scheduledFor: { type: Date, required: true },
    status:       { type: String, enum: ['done', 'missed'], default: 'done' },
    type:         { type: String, enum: ['regular', 'missed', 'break-start', 'break-end'], default: 'regular' },
  },
  { _id: false }
);

const sessionSchema = new Schema<IAttendanceSession, IAttendanceSessionModel>(
  {
    employee:     { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    user:         { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    employeeId:   { type: String, required: true, trim: true, index: true },
    employeeName: { type: String, required: true, trim: true },
    department:   { type: String, trim: true, default: '' },

    date: {
      type: Date,
      required: true,
      index: true,
      validate: {
        validator: (v: Date) =>
          v instanceof Date &&
          !Number.isNaN(v.getTime()) &&
          v.getUTCHours() === 0 &&
          v.getUTCMinutes() === 0 &&
          v.getUTCSeconds() === 0 &&
          v.getUTCMilliseconds() === 0,
        message: 'date must be midnight UTC',
      },
    },

    scheduledStartAt:    { type: Date, default: null },
    scheduleIntervalMin: { type: Number, default: SLOT_INTERVAL_MIN, min: 1 },

    startAt:  { type: Date, default: null },
    endAt:    { type: Date, default: null },
    isActive: { type: Boolean, default: false, index: true },

    isWorkingDay: { type: Boolean, default: true, index: true },

    checkIns:     { type: [checkInSchema], default: [] },
    checkInCount: { type: Number, default: 0, min: 0 },
    missedCount:  { type: Number, default: 0, min: 0 },

    breaks:       { type: [breakIntervalSchema], default: [] },
    breakUsedMin: { type: Number, default: 0, min: 0, max: BREAK_LIMIT_MIN },

    workedMin:   { type: Number, default: 0, min: 0 },
    workedHours: { type: Number, default: 0, min: 0 },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

sessionSchema.index({ employee: 1, date: 1 }, { unique: true });
sessionSchema.index({ user: 1, date: 1 });
sessionSchema.index({ date: 1, isActive: 1, isDeleted: 1 });

sessionSchema.pre('validate', function () {
  if (this.isModified('date') && this.date) {
    this.date = startOfDayUTC(this.date);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

const diffMin = (a: Date, b: Date): number => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

const startOfDayUTC = (d: Date | string = new Date()): Date => {
  const date = new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
};

const startOfMonthUTC = (d: Date | string = new Date()): Date => {
  const date = new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
};

const endOfMonthUTC = (d: Date | string = new Date()): Date => {
  const date = new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
};

function parseCheckInTime(raw: any): { hour: number; minute: number } {
  if (typeof raw === 'string') {
    const m = raw.trim().match(/^(\d{1,2}):(\d{2})/);
    if (m) return { hour: Math.min(23, Math.max(0, parseInt(m[1], 10))), minute: Math.min(59, Math.max(0, parseInt(m[2], 10))) };
  }
  if (raw && typeof raw === 'object' && typeof raw.hour === 'number') {
    return { hour: Math.min(23, Math.max(0, raw.hour | 0)), minute: Math.min(59, Math.max(0, (raw.minute | 0) || 0)) };
  }
  return { hour: DEFAULT_CHECKIN_HOUR, minute: DEFAULT_CHECKIN_MIN };
}

function buildScheduledStart(dateMidnightUTC: Date, hour: number, minute: number): Date {
  const y = dateMidnightUTC.getUTCFullYear();
  const mo = dateMidnightUTC.getUTCMonth();
  const da = dateMidnightUTC.getUTCDate();
  // Keep it in the local timezone context so 09:00 means 9 AM local time.
  return new Date(y, mo, da, hour, minute, 0, 0);
}

/** Is `t` inside any break interval? */
function isInsideBreak(session: IAttendanceSession, t: Date): boolean {
  for (const b of session.breaks) {
    const s = b.start.getTime();
    const e = (b.end ?? new Date()).getTime();
    if (t.getTime() > s && t.getTime() < e) return true;
  }
  return false;
}

/**
 * Walk the rigid clock grid (09:00, 09:30, 10:00...). 
 * - If the slot is inside a break -> skip (protected).
 * - If slot + grace < now -> mark missed.
 */
function pushMissedSlots(session: IAttendanceSession, now: Date): number {
  if (!session.isWorkingDay || session.endAt || !session.startAt || !session.scheduledStartAt) return 0;

  const intervalMs = (session.scheduleIntervalMin || SLOT_INTERVAL_MIN) * 60_000;
  const graceMs = GRACE_MIN * 60_000;

  const recorded = new Set(
    session.checkIns
      .filter((c) => c.type === 'regular' || c.type === 'missed')
      .map((c) => c.scheduledFor.getTime())
  );

  let added = 0;
  let cursor = session.scheduledStartAt.getTime();

  for (let i = 0; i < 24 * 60; i++) {
    const slotTs = cursor;
    const slotDate = new Date(slotTs);

    // Stop once we reach a slot whose grace window hasn't closed
    if (slotTs + graceMs >= now.getTime()) break;

    // Skip slots inside breaks
    if (isInsideBreak(session, slotDate)) {
      cursor += intervalMs;
      continue;
    }

    // Skip if already recorded
    if (recorded.has(slotTs)) {
      cursor += intervalMs;
      continue;
    }

    // Mark as missed
    session.checkIns.push({
      at: new Date(slotTs + graceMs), // Expired at slot+10m
      scheduledFor: slotDate,
      status: 'missed',
      type: 'missed',
    });
    recorded.add(slotTs);
    added++;
    cursor += intervalMs;
  }

  if (added > 0) {
    session.missedCount = session.checkIns.filter((c) => c.status === 'missed').length;
  }
  return added;
}

/**
 * Find the FIRST unrecorded, non-break slot on the grid.
 * (The `_now` parameter is kept to maintain the function signature, but isn't 
 * needed for the logic since we just look for the next available slot).
 */
function getNextExpectedSlot(session: IAttendanceSession, _now?: Date): Date | null {
  if (!session.scheduledStartAt) return null;
  const intervalMs = (session.scheduleIntervalMin || SLOT_INTERVAL_MIN) * 60_000;
  
  const recorded = new Set(
    session.checkIns
      .filter((c) => c.type === 'regular' || c.type === 'missed')
      .map((c) => c.scheduledFor.getTime())
  );

  let cursor = session.scheduledStartAt.getTime();
  for (let i = 0; i < 24 * 60; i++) {
    const slotDate = new Date(cursor);
    if (!recorded.has(cursor) && !isInsideBreak(session, slotDate)) {
      return slotDate;
    }
    cursor += intervalMs;
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════
// GET-OR-CREATE
// ═══════════════════════════════════════════════════════════════════════

async function getOrCreateTodaySession(Model: IAttendanceSessionModel, userId: Types.ObjectId | string): Promise<IAttendanceSession> {
  const today = startOfDayUTC();
  let session = await Model.findOne({ user: userId, date: today, isDeleted: false });
  if (session) return session;

  await Model.deleteMany({ user: userId, date: today, isDeleted: true });

  const User = mongoose.model('User');
  const Employee = mongoose.model('Employee');
  const AttendanceM = mongoose.model('Attendance');

  const userDoc: any = await User.findById(userId).lean();
  if (!userDoc) throw new Error('User not found');
  const empDoc: any = await Employee.findOne({ user: userId, isDeleted: false }).lean();

  const attRow: any = await AttendanceM.findOne({ employee: empDoc?._id ?? userDoc._id, date: today, isDeleted: false }).lean();
  const isWorkingDay = !(attRow && NON_WORKING_STATUSES.includes(attRow.status as AttendanceStatus));

  const raw = empDoc?.checkInTime ?? userDoc?.checkInTime;
  const { hour, minute } = parseCheckInTime(raw);
  const scheduledStartAt = buildScheduledStart(today, hour, minute);

  try {
    session = await Model.create({
      employee: empDoc?._id ?? userDoc._id,
      user: userDoc._id,
      employeeId: userDoc.employeeId ?? empDoc?.employeeId ?? String(userDoc._id),
      employeeName: userDoc.name ?? empDoc?.name ?? '',
      department: userDoc.department ?? empDoc?.department ?? '',
      date: today,
      scheduledStartAt,
      scheduleIntervalMin: SLOT_INTERVAL_MIN,
      startAt: null,
      endAt: null,
      isActive: false,
      isWorkingDay,
      checkIns: [],
      checkInCount: 0,
      missedCount: 0,
      breaks: [],
      breakUsedMin: 0,
      workedMin: 0,
      workedHours: 0,
    });
    return session;
  } catch (e: any) {
    if (e?.code === 11000) {
      const existing = await Model.findOne({ user: userId, date: today });
      if (existing) return existing;
    }
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STATICS
// ═══════════════════════════════════════════════════════════════════════

sessionSchema.statics.normalizeDate = startOfDayUTC;

// ── Start Day ───────────────────────────────────────────────────────────
sessionSchema.statics.startDay = async function (this: IAttendanceSessionModel, userId) {
  const session = await getOrCreateTodaySession(this, userId);
  if (session.startAt) return session;

  const now = new Date();
  session.startAt = now;
  session.isActive = true;

  if (session.isWorkingDay) {
    // 1) Mark all past grid slots as missed (e.g., 9:00, 9:30, ..., 12:30 are missed)
    pushMissedSlots(session, now);

    // 2) Find the upcoming slot (e.g., 13:00). Record "now" as the check-in for that slot.
    const nextSlot = getNextExpectedSlot(session, now);
    if (nextSlot && now.getTime() <= nextSlot.getTime() + GRACE_MIN * 60_000) {
      session.checkIns.push({
        at: now,
        scheduledFor: nextSlot,
        status: 'done',
        type: 'regular',
      });
    }

    session.checkInCount = session.checkIns.filter(c => c.status === 'done' && c.type === 'regular').length;
    session.missedCount = session.checkIns.filter(c => c.status === 'missed').length;
  }

  await session.save();
  return session;
};

// ── Check-In ────────────────────────────────────────────────────────────
sessionSchema.statics.checkIn = async function (this: IAttendanceSessionModel, userId) {
  const session = await getOrCreateTodaySession(this, userId);

  if (!session.isWorkingDay) throw new Error('Not a working day');
  if (!session.isActive) throw new Error('Day not started');
  if (session.endAt) throw new Error('Day already ended');
  if (session.breaks.some((b) => !b.end)) throw new Error('End break before checking in');

  const now = new Date();

  // Catch up any expired slots
  pushMissedSlots(session, now);

  // Find the next slot they are allowed to mark
  const nextSlot = getNextExpectedSlot(session, now);
  if (!nextSlot) throw new Error('No further slots available');

  if (now.getTime() > nextSlot.getTime() + GRACE_MIN * 60_000) {
    throw new Error(`Slot expired. The next slot will open soon.`);
  }

  session.checkIns.push({
    at: now,
    scheduledFor: nextSlot,
    status: 'done',
    type: 'regular',
  });
  
  session.checkInCount = session.checkIns.filter(c => c.status === 'done' && c.type === 'regular').length;
  session.missedCount = session.checkIns.filter(c => c.status === 'missed').length;

  await session.save();
  return session;
};

// ── Start Break ─────────────────────────────────────────────────────────
sessionSchema.statics.startBreak = async function (this: IAttendanceSessionModel, userId) {
  const session = await getOrCreateTodaySession(this, userId);

  if (!session.isWorkingDay) throw new Error('Not a working day');
  if (!session.isActive) throw new Error('Day not started');
  if (session.endAt) throw new Error('Day already ended');
  if (session.breaks.some((b) => !b.end)) throw new Error('Break already in progress');
  if (session.breakUsedMin >= BREAK_LIMIT_MIN) throw new Error(`Break limit reached (${BREAK_LIMIT_MIN} min)`);

  const now = new Date();

  // Mark anything expired up to the exact minute they clicked "Break"
  pushMissedSlots(session, now);

  session.breaks.push({ start: now, end: null, durationMin: 0 });
  session.checkIns.push({ at: now, scheduledFor: now, status: 'done', type: 'break-start' });

  await session.save();
  return session;
};

// ── End Break ───────────────────────────────────────────────────────────
sessionSchema.statics.endBreak = async function (this: IAttendanceSessionModel, userId) {
  const session = await getOrCreateTodaySession(this, userId);

  if (!session.isActive) throw new Error('Day not started');
  if (session.endAt) throw new Error('Day already ended');

  const open = session.breaks.find((b) => !b.end);
  if (!open) throw new Error('No active break');

  const now = new Date();
  open.end = now;
  open.durationMin = diffMin(open.start, now);

  const total = session.breaks.reduce((s, b) => s + (b.durationMin || 0), 0);
  session.breakUsedMin = Math.min(total, BREAK_LIMIT_MIN);

  session.checkIns.push({ at: now, scheduledFor: now, status: 'done', type: 'break-end' });

  // The schedule remains strictly on the clock. The next slot is simply the next grid time.
  session.checkInCount = session.checkIns.filter(c => c.status === 'done' && c.type === 'regular').length;
  session.missedCount = session.checkIns.filter(c => c.status === 'missed').length;

  await session.save();
  return session;
};

// ── End Day ─────────────────────────────────────────────────────────────
sessionSchema.statics.endDay = async function (this: IAttendanceSessionModel, userId) {
  const session = await getOrCreateTodaySession(this, userId);
  if (!session.isActive) throw new Error('Day not started');
  if (session.endAt) return session;

  const now = new Date();

  const open = session.breaks.find((b) => !b.end);
  if (open) {
    open.end = now;
    open.durationMin = diffMin(open.start, now);
    session.breakUsedMin = Math.min(session.breaks.reduce((s, b) => s + (b.durationMin || 0), 0), BREAK_LIMIT_MIN);
    session.checkIns.push({ at: now, scheduledFor: now, status: 'done', type: 'break-end' });
  }

  pushMissedSlots(session, now);

  session.endAt = now;
  session.isActive = false;

  if (session.isWorkingDay && session.startAt) {
    const totalMin = diffMin(session.startAt, now);
    const missedDiscount = (session.missedCount || 0) * (session.scheduleIntervalMin || SLOT_INTERVAL_MIN);
    session.workedMin = Math.max(0, totalMin - session.breakUsedMin - missedDiscount);
    session.workedHours = Math.round((session.workedMin / 60) * 100) / 100;
  } else {
    session.workedMin = 0;
    session.workedHours = 0;
  }

  await session.save();

  const existing: any = await Attendance.findOne({ employee: session.employee, date: session.date }).lean();
  let status: AttendanceStatus = 'absent';
  if (!session.isWorkingDay) {
    status = (existing?.status as AttendanceStatus) ?? 'absent';
  } else if (existing?.source === 'manual' && ['leave', 'holiday', 'weekend', 'half_day', 'wfh'].includes(existing.status)) {
    status = existing.status;
  } else {
    status = session.workedMin >= FULL_DAY_MIN ? 'present' : session.workedMin >= HALF_DAY_MIN ? 'half_day' : 'absent';
  }

  await Attendance.findOneAndUpdate(
    { employee: session.employee, date: session.date },
    {
      $set: {
        employeeId: session.employeeId,
        employeeName: session.employeeName,
        department: session.department,
        user: session.user,
        arrivalAt: session.startAt,
        departureAt: session.endAt,
        workedHours: session.workedHours,
        status,
        ...(existing?.source === 'manual' ? {} : { source: 'auto' }),
      },
    },
    { upsert: true, new: true }
  );

  return session;
};

// ── Mark Missed (Cron) ──────────────────────────────────────────────────
sessionSchema.statics.markMissedCheckIns = async function (this: IAttendanceSessionModel, userId, now: Date = new Date()) {
  const session = await getOrCreateTodaySession(this, userId);
  const added = pushMissedSlots(session, now);
  if (added > 0) await session.save();
  return added;
};

// ── Monthly Summary ─────────────────────────────────────────────────────
sessionSchema.statics.getMonthlySummary = async function (this: IAttendanceSessionModel, userId, month: Date) {
  const from = startOfMonthUTC(month);
  const to = endOfMonthUTC(month);
  const days = await this.find({ user: userId, isDeleted: false, date: { $gte: from, $lt: to } }).sort({ date: 1 });
  const totalWorkedMin = days.reduce((s, d) => s + (d.workedMin || 0), 0);
  return {
    month: from.toISOString().slice(0, 7),
    totalWorkedMin,
    totalWorkedHours: Math.round((totalWorkedMin / 60) * 100) / 100,
    totalBreakMin: days.reduce((s, d) => s + (d.breakUsedMin || 0), 0),
    daysPresent: days.filter((d) => d.isWorkingDay && d.startAt && d.workedMin > 0).length,
    totalMissed: days.reduce((s, d) => s + (d.missedCount || 0), 0),
    days,
  };
};

// ═══════════════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════════════

const AttendanceSession =
  (mongoose.models.AttendanceSession as IAttendanceSessionModel) ||
  mongoose.model<IAttendanceSession, IAttendanceSessionModel>('AttendanceSession', sessionSchema);

export default AttendanceSession;