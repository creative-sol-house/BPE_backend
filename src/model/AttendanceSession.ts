// model/AttendanceSession.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Attendance, { AttendanceStatus } from './attendance';

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════

export const BREAK_LIMIT_MIN = 75;        // 1h 15m total per day
export const CHECK_INTERVAL_MIN = 15;     // check-in every 15 min
export const FULL_DAY_MIN = 8 * 60;       // 8h → "present"
export const HALF_DAY_MIN = 4 * 60;       // 4h → "half_day"

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

export interface IBreakInterval {
  start: Date;
  end: Date | null;
  durationMin: number;   // computed on end
}

export interface ICheckIn {
  at: Date;
  scheduledFor: Date;    // the 15-min slot it belongs to
  status: 'done' | 'missed';
}

export interface IAttendanceSession extends Document {
  _id: Types.ObjectId;

  // ── Identity (denormalized) ─────────────────────────────────────
  employee: Types.ObjectId;       // ref Employee
  user: Types.ObjectId;           // ref User
  employeeId: string;             // "EMP-00001"
  employeeName: string;
  department: string;

  // ── The day (midnight UTC) ─────────────────────────────────────
  date: Date;

  // ── Day lifecycle ──────────────────────────────────────────────
  startAt: Date | null;
  endAt: Date | null;
  isActive: boolean;

  // ── 15-min check-ins ───────────────────────────────────────────
  checkIns: ICheckIn[];
  checkInCount: number;
  missedCount: number;

  // ── Breaks ─────────────────────────────────────────────────────
  breaks: IBreakInterval[];
  breakUsedMin: number;

  // ── Derived totals ─────────────────────────────────────────────
  workedMin: number;
  workedHours: number;

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAttendanceSessionModel extends Model<IAttendanceSession> {
  normalizeDate(d: Date | string): Date;

  // Service layer (statics)
  startDay(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  checkIn(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  startBreak(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  endBreak(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  endDay(userId: Types.ObjectId | string): Promise<IAttendanceSession>;
  markMissedCheckIns(userId: Types.ObjectId | string, now?: Date): Promise<number>;
  getMonthlySummary(userId: Types.ObjectId | string, month: Date): Promise<{
    month: string;
    totalWorkedMin: number;
    totalWorkedHours: number;
    totalBreakMin: number;
    daysPresent: number;
    totalMissed: number;
    days: IAttendanceSession[];
  }>;
}

// ═══════════════════════════════════════════════════════════════════════
// SUB-SCHEMAS
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
  },
  { _id: false }
);

// ═══════════════════════════════════════════════════════════════════════
// MAIN SCHEMA
// ═══════════════════════════════════════════════════════════════════════

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

    startAt:  { type: Date, default: null },
    endAt:    { type: Date, default: null },
    isActive: { type: Boolean, default: false, index: true },

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

// ── Indexes ─────────────────────────────────────────────────────────────
sessionSchema.index({ employee: 1, date: 1 }, { unique: true });
sessionSchema.index({ user: 1, date: 1 });
sessionSchema.index({ date: 1, isActive: 1, isDeleted: 1 });
sessionSchema.index({ department: 1, date: 1 });

// ═══════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════

sessionSchema.pre('validate', function () {
  if (this.isModified('date') && this.date) {
    const M = this.constructor as IAttendanceSessionModel;
    this.date = M.normalizeDate(this.date);
  }
});

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

const diffMin = (a: Date, b: Date): number =>
  Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

const startOfDayUTC = (d: Date | string = new Date()): Date => {
  const date = new Date(d);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
};

const startOfMonthUTC = (d: Date | string = new Date()): Date => {
  const date = new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
};

const endOfMonthUTC = (d: Date | string = new Date()): Date => {
  const date = new Date(d);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
};



// ═══════════════════════════════════════════════════════════════════════
// STATICS — SERVICE LAYER
// ═══════════════════════════════════════════════════════════════════════

sessionSchema.statics.normalizeDate = startOfDayUTC;

/**
 * Fetch (or lazily create) today's session for a user.
 * Pulls identity from User + Employee.
 */
async function getOrCreateTodaySession(
  Model: IAttendanceSessionModel,
  userId: Types.ObjectId | string
): Promise<IAttendanceSession> {
  const today = startOfDayUTC();

  // 1. Look for a live session first
  let session = await Model.findOne({ user: userId, date: today, isDeleted: false });
  if (session) return session;

  // 2. Purge any soft-deleted leftovers for today so the unique index doesn't block
  await Model.deleteMany({ user: userId, date: today, isDeleted: true });

  const User = mongoose.model('User');
  const Employee = mongoose.model('Employee');

  const userDoc: any = await User.findById(userId).lean();
  if (!userDoc) throw new Error('User not found');

  const empDoc: any = await Employee.findOne({ user: userId, isDeleted: false }).lean();

  try {
    session = await Model.create({
      employee:     empDoc?._id ?? userDoc._id,
      user:         userDoc._id,
      employeeId:   userDoc.employeeId ?? empDoc?.employeeId ?? String(userDoc._id),
      employeeName: userDoc.name,
      department:   userDoc.department ?? '',
      date:         today,
      startAt:      null,
      endAt:        null,
      isActive:     false,
      checkIns:     [],
      checkInCount: 0,
      missedCount:  0,
      breaks:       [],
      breakUsedMin: 0,
      workedMin:    0,
      workedHours:  0,
    });
    return session;
  } catch (e: any) {
    // Race condition: another request created it first
    if (e?.code === 11000) {
      const existing = await Model.findOne({ user: userId, date: today });
      if (existing) return existing;
    }
    throw e;
  }
}

// ── 1. Start Day ────────────────────────────────────────────────────────
sessionSchema.statics.startDay = async function (
  this: IAttendanceSessionModel,
  userId
) {
  const session = await getOrCreateTodaySession(this, userId);

  if (session.startAt) {
    // Idempotent — already started
    return session;
  }

  const now = new Date();
  session.startAt = now;
  session.isActive = true;

  // Seed the first check-in slot
  session.checkIns.push({
    at: now,
    scheduledFor: now,
    status: 'done',
  });
  session.checkInCount = 1;

  await session.save();
  return session;
};

// ── 2. Check-In (every 15 min) ──────────────────────────────────────────
sessionSchema.statics.checkIn = async function (
  this: IAttendanceSessionModel,
  userId
) {
  const session = await getOrCreateTodaySession(this, userId);

  if (!session.isActive) throw new Error('Day not started');
  if (session.endAt) throw new Error('Day already ended');

  const now = new Date();
  
  // Reject if on break
  const openBreak = session.breaks.find((b) => !b.end);
  if (openBreak) throw new Error('End break before checking in');

  // Find the very last action (done check-in or end-break reset)
  const lastAction = [...session.checkIns]
    .filter(c => c.status === 'done')
    .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime())[0];

  if (lastAction) {
    const nextAllowed = new Date(lastAction.scheduledFor.getTime() + CHECK_INTERVAL_MIN * 60000);
    if (now.getTime() < nextAllowed.getTime()) {
      throw new Error(`Please wait until ${nextAllowed.toLocaleTimeString()}`);
    }
  }

  session.checkIns.push({ at: now, scheduledFor: now, status: 'done' });
  session.checkInCount = session.checkIns.filter((c) => c.status === 'done').length;

  await session.save();
  return session;
};

// ── 3. Start Break ──────────────────────────────────────────────────────
sessionSchema.statics.startBreak = async function (
  this: IAttendanceSessionModel,
  userId
) {
  const session = await getOrCreateTodaySession(this, userId);

  if (!session.isActive) throw new Error('Day not started');
  if (session.endAt) throw new Error('Day already ended');

  if (session.breaks.some((b) => !b.end)) {
    throw new Error('Break already in progress');
  }

  if (session.breakUsedMin >= BREAK_LIMIT_MIN) {
    throw new Error(`Break limit reached (${BREAK_LIMIT_MIN} min)`);
  }

  session.breaks.push({
    start: new Date(),
    end: null,
    durationMin: 0,
  });

  await session.save();
  return session;
};

// ── 4. End Break ────────────────────────────────────────────────────────
sessionSchema.statics.endBreak = async function (
  this: IAttendanceSessionModel,
  userId
) {
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

  // 🔥 RESET 15-MIN TIMER ON BREAK END
  const nextSlotTime = new Date(now.getTime() + CHECK_INTERVAL_MIN * 60000);
  session.checkIns.push({
    at: now,
    scheduledFor: nextSlotTime,
    status: 'done',
  });
  session.checkInCount = session.checkIns.filter((c) => c.status === 'done').length;

  await session.save();
  return session;
};

// ── 5. End Day ──────────────────────────────────────────────────────────
sessionSchema.statics.endDay = async function (
  this: IAttendanceSessionModel,
  userId
) {
  const session = await getOrCreateTodaySession(this, userId);

  if (!session.isActive) throw new Error('Day not started');
  if (session.endAt) return session; // idempotent

  const now = new Date();

  // Auto-close any open break
  const open = session.breaks.find((b) => !b.end);
  if (open) {
    open.end = now;
    open.durationMin = diffMin(open.start, now);
    const total = session.breaks.reduce((s, b) => s + (b.durationMin || 0), 0);
    session.breakUsedMin = Math.min(total, BREAK_LIMIT_MIN);
  }

  // Any slots between last check-in and endAt that were missed?
  await (this as IAttendanceSessionModel).markMissedCheckIns(userId, now);

  session.endAt = now;
  session.isActive = false;

  const totalMin = diffMin(session.startAt!, now);
  session.workedMin = Math.max(0, totalMin - session.breakUsedMin);
  session.workedHours = Math.round((session.workedMin / 60) * 100) / 100;

  await session.save();

  // ── Sync to existing Attendance model (HR view) ──────────────────
  const status: AttendanceStatus =
    session.workedMin >= FULL_DAY_MIN
      ? 'present'
      : session.workedMin >= HALF_DAY_MIN
      ? 'half_day'
      : 'absent';

  await Attendance.findOneAndUpdate(
    { employee: session.employee, date: session.date },
    {
      $set: {
        employeeId:   session.employeeId,
        employeeName: session.employeeName,
        department:   session.department,
        user:         session.user,
        arrivalAt:    session.startAt,
        departureAt:  session.endAt,
        workedHours:  session.workedHours,
        status,
        source:       'auto',
      },
    },
    { upsert: true }
  );

  return session;
};

// ── 6. Mark Missed Check-Ins (Called by Cron) ───────────────────────────
sessionSchema.statics.markMissedCheckIns = async function (
  this: IAttendanceSessionModel,
  userId,
  now: Date = new Date()
) {
  const session = await getOrCreateTodaySession(this, userId);

  if (!session.startAt) return 0;
  if (session.endAt) return 0; // Day is over

  // 🛑 If currently on a break, do NOT mark missed
  const openBreak = session.breaks.find((b) => !b.end);
  if (openBreak) return 0;

  // Find the last action (done check-in or break-end reset)
  const lastAction = [...session.checkIns]
    .filter(c => c.status === 'done')
    .sort((a, b) => b.scheduledFor.getTime() - a.scheduledFor.getTime())[0];

  const lastTime = lastAction ? lastAction.scheduledFor.getTime() : session.startAt.getTime();
  const nextExpectedSlot = new Date(lastTime + CHECK_INTERVAL_MIN * 60000);

  let added = 0;

  // If current time has passed the next expected slot
  if (now.getTime() >= nextExpectedSlot.getTime()) {
    const alreadyExists = session.checkIns.some(
      (c) => c.scheduledFor.getTime() === nextExpectedSlot.getTime()
    );

    if (!alreadyExists) {
      session.checkIns.push({
        at: now,
        scheduledFor: nextExpectedSlot,
        status: 'missed',
      });
      session.missedCount = session.checkIns.filter((c) => c.status === 'missed').length;
      await session.save();
      added = 1;
    }
  }

  return added;
};

// ── 7. Monthly Summary ──────────────────────────────────────────────────
sessionSchema.statics.getMonthlySummary = async function (
  this: IAttendanceSessionModel,
  userId,
  month: Date
) {
  const from = startOfMonthUTC(month);
  const to   = endOfMonthUTC(month);

  const days = await this.find({
    user: userId,
    isDeleted: false,
    date: { $gte: from, $lt: to },
  }).sort({ date: 1 });

  const totalWorkedMin = days.reduce((s, d) => s + (d.workedMin || 0), 0);
  const totalBreakMin  = days.reduce((s, d) => s + (d.breakUsedMin || 0), 0);
  const totalMissed    = days.reduce((s, d) => s + (d.missedCount || 0), 0);
  const daysPresent    = days.filter((d) => d.startAt && d.workedMin > 0).length;

  return {
    month: from.toISOString().slice(0, 7), // "YYYY-MM"
    totalWorkedMin,
    totalWorkedHours: Math.round((totalWorkedMin / 60) * 100) / 100,
    totalBreakMin,
    daysPresent,
    totalMissed,
    days,
  };
};

// ═══════════════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════════════

const AttendanceSession =
  (mongoose.models.AttendanceSession as IAttendanceSessionModel) ||
  mongoose.model<IAttendanceSession, IAttendanceSessionModel>(
    'AttendanceSession',
    sessionSchema
  );

export default AttendanceSession;