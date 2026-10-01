// model/employee.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Counter from './counter';

export type Gender = 'male' | 'female';

export type EmploymentStatus =
  | 'active' | 'on_leave' | 'suspended' | 'resigned' | 'terminated';

// ─── Leave types ──────────────────────────────────────────────────────────
export type LeaveType = string;

export const SUGGESTED_LEAVE_TYPES = [
  'Annual', 'Sick', 'Casual', 'Unpaid',
  'Maternity', 'Paternity', 'Hajj', 'Marriage',
] as const;

export interface ILeaveAllocation {
  type: LeaveType;
  year: number;
  month: number;
  days: number;
  used: number;
  carriedForward: number;
  notes?: string;
}

export interface ILeaveSchedule {
  type: LeaveType;
  daysPerMonth: number;
  startYear: number;
  startMonth: number;
  endYear?: number;   // absent = continue
  endMonth?: number;
  notes?: string;
}

export interface IProfileImage { url: string; publicId: string; }

export interface IEmployee extends Document {
  _id: Types.ObjectId;
  user: Types.ObjectId | null;
  employeeId: string;
  name: string;
  email?: string;
  phoneNo: string;
  cnic: string;
  designation: string;
  department: string;
  dateOfJoining: Date;
  gender: Gender;
  dob: Date;
  address?: string;
  profileImage?: IProfileImage | null;

  standardCheckIn: string;
  standardCheckOut: string;

  leaveSchedules: ILeaveSchedule[];
  leaveAllocations: ILeaveAllocation[];

  employmentStatus: EmploymentStatus;
  isActive: boolean;
  statusReason?: string;
  statusChangedAt?: Date;

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;

  // Virtuals
  hasUserAccount: boolean;
  standardWorkingHours: number;
  totalWorkingHours: number;
  totalWorkingHoursUpdatedAt?: Date;
  leaveSummary: {
    year: number;
    totalAllocated: number;
    totalUsed: number;
    totalRemaining: number;
  };
}

export interface IEmployeeModel extends Model<IEmployee> {
  findByUser(userId: Types.ObjectId | string): Promise<IEmployee | null>;
  recomputeTotalWorkingHours(
    employeeDocId: Types.ObjectId,
    from?: Date,
    to?: Date
  ): Promise<number>;
  extendSchedules(
    employeeDocId: Types.ObjectId,
    year?: number
  ): Promise<IEmployee | null>;
}

// ─── Constants ────────────────────────────────────────────────────────────
export const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  'active', 'on_leave', 'suspended', 'resigned', 'terminated',
];
export const ACTIVE_STATUSES: EmploymentStatus[] = ['active', 'on_leave'];
export const INACTIVE_STATUSES: EmploymentStatus[] = ['suspended', 'resigned', 'terminated'];

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// ─── Helpers ──────────────────────────────────────────────────────────────
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

export function computeStandardWorkingHours(checkIn: string, checkOut: string): number {
  if (!TIME_RE.test(checkIn) || !TIME_RE.test(checkOut)) return 0;
  const diff = timeToMinutes(checkOut) - timeToMinutes(checkIn);
  return diff > 0 ? +(diff / 60).toFixed(2) : 0;
}

// ─── Schedule → Monthly rows expansion ────────────────────────────────────
export function expandScheduleToMonths(
  schedule: ILeaveSchedule,
  fallbackEndYear: number = new Date().getFullYear()
): ILeaveAllocation[] {
  const rows: ILeaveAllocation[] = [];

  const sY = schedule.startYear;
  const sM = Math.max(1, Math.min(12, schedule.startMonth));

  const hasEnd =
    Number.isInteger(schedule.endYear) && Number.isInteger(schedule.endMonth);

  const eY = hasEnd ? (schedule.endYear as number) : fallbackEndYear;
  const eM = hasEnd ? Math.max(1, Math.min(12, schedule.endMonth as number)) : 12;

  if (eY < sY || (eY === sY && eM < sM)) return rows;

  let y = sY;
  let m = sM;
  while (y < eY || (y === eY && m <= eM)) {
    rows.push({
      type: schedule.type.trim(),
      year: y,
      month: m,
      days: +Number(schedule.daysPerMonth || 0).toFixed(2),
      used: 0,
      carriedForward: 0,
      notes: schedule.notes,
    });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return rows;
}

export function scheduleIsOpenEnded(s: ILeaveSchedule): boolean {
  return !(
    Number.isInteger(s.endYear) && Number.isInteger(s.endMonth)
  );
}

// ─── Leave schedule sub-schema ────────────────────────────────────────────
const leaveScheduleSchema = new Schema<ILeaveSchedule>(
  {
    type: { type: String, required: true, trim: true, maxlength: 40 },
    daysPerMonth: { type: Number, required: true, min: 0, max: 31, default: 0 },
    startYear: { type: Number, required: true, min: 2000, max: 2100 },
    startMonth: { type: Number, required: true, min: 1, max: 12 },
    endYear: { type: Number, min: 2000, max: 2100 },
    endMonth: { type: Number, min: 1, max: 12 },
    notes: { type: String, trim: true, maxlength: 250 },
  },
  { _id: false }
);

// ─── Leave allocation sub-schema (monthly ledger) ─────────────────────────
const leaveAllocationSchema = new Schema<ILeaveAllocation>(
  {
    type: { type: String, required: true, trim: true, maxlength: 40 },
    year: { type: Number, required: true, min: 2000, max: 2100 },
    month: { type: Number, required: true, min: 1, max: 12 },
    days: { type: Number, required: true, min: 0, max: 31, default: 0 },
    used: { type: Number, required: true, min: 0, default: 0 },
    carriedForward: { type: Number, required: true, min: 0, default: 0 },
    notes: { type: String, trim: true, maxlength: 250 },
  },
  {
    _id: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

leaveAllocationSchema.virtual('allocated').get(function () {
  return +((this.days || 0) + (this.carriedForward || 0)).toFixed(2);
});
leaveAllocationSchema.virtual('remaining').get(function () {
  const total = (this.days || 0) + (this.carriedForward || 0);
  return Math.max(0, +(total - (this.used || 0)).toFixed(2));
});

// ─── Employee schema ──────────────────────────────────────────────────────
const employeeSchema = new Schema<IEmployee, IEmployeeModel>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      unique: true,
      sparse: true,
      index: true,
    },
    employeeId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, trim: true, lowercase: true, default: undefined },
    phoneNo: { type: String, required: true, trim: true },
    cnic: { type: String, required: true, trim: true },
    designation: { type: String, required: true, trim: true },
    department: { type: String, trim: true, default: '' },
    dateOfJoining: { type: Date, required: true },
    gender: { type: String, enum: ['male', 'female'], required: true },
    dob: { type: Date, required: true },
    address: { type: String, trim: true, maxlength: 250 },
    profileImage: {
      type: {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
      },
      default: null,
    },

    standardCheckIn: {
      type: String, required: true, default: '09:00', trim: true,
      match: [TIME_RE, 'standardCheckIn must be in HH:mm (24h) format'],
    },
    standardCheckOut: {
      type: String, required: true, default: '18:00', trim: true,
      match: [TIME_RE, 'standardCheckOut must be in HH:mm (24h) format'],
    },

    leaveSchedules: {
      type: [leaveScheduleSchema],
      default: [],
      validate: {
        validator: function (arr: ILeaveSchedule[]) {
          const seen = new Set<string>();
          for (const s of arr) {
            const key = `${s.type.trim().toLowerCase()}::${s.startYear}-${s.startMonth}`;
            if (seen.has(key)) return false;
            seen.add(key);
          }
          return true;
        },
        message: 'Duplicate schedule for the same type and start month',
      },
    },

    leaveAllocations: {
      type: [leaveAllocationSchema],
      default: [],
      validate: {
        validator: function (arr: ILeaveAllocation[]) {
          const seen = new Set<string>();
          for (const a of arr) {
            const key = `${a.type.trim().toLowerCase()}::${a.year}::${a.month}`;
            if (seen.has(key)) return false;
            seen.add(key);
          }
          return true;
        },
        message: 'Duplicate leave allocation for the same type, year, and month',
      },
    },

    totalWorkingHours: { type: Number, default: 0, min: 0, select: true },
    totalWorkingHoursUpdatedAt: { type: Date, select: true },

    employmentStatus: {
      type: String, enum: EMPLOYMENT_STATUSES, default: 'active', required: true,
    },
    isActive: { type: Boolean, default: true },
    statusReason: { type: String, trim: true, maxlength: 500 },
    statusChangedAt: { type: Date },

    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────
employeeSchema.index({ employmentStatus: 1, isDeleted: 1 });
employeeSchema.index({ isActive: 1, isDeleted: 1 });
employeeSchema.index({ department: 1, isDeleted: 1 });
employeeSchema.index({ standardCheckIn: 1, standardCheckOut: 1 });
employeeSchema.index({ 'leaveAllocations.year': 1, 'leaveAllocations.month': 1 });
employeeSchema.index({ 'leaveAllocations.type': 1 });
employeeSchema.index({ 'leaveSchedules.type': 1 });

// ─── Virtuals ─────────────────────────────────────────────────────────────
employeeSchema.virtual('hasUserAccount').get(function () {
  return !!this.user;
});

employeeSchema.virtual('standardWorkingHours').get(function () {
  return computeStandardWorkingHours(this.standardCheckIn, this.standardCheckOut);
});

employeeSchema.virtual('leaveSummary').get(function () {
  const year = new Date().getFullYear();
  const current = (this.leaveAllocations ?? []).filter((a) => a.year === year);
  const totalAllocated = current.reduce(
    (s, a) => s + (a.days || 0) + (a.carriedForward || 0), 0
  );
  const totalUsed = current.reduce((s, a) => s + (a.used || 0), 0);
  return {
    year,
    totalAllocated: +totalAllocated.toFixed(2),
    totalUsed: +totalUsed.toFixed(2),
    totalRemaining: Math.max(0, +(totalAllocated - totalUsed).toFixed(2)),
  };
});

// ─── Auto-generate employeeId ─────────────────────────────────────────────
employeeSchema.pre('validate', async function () {
  if (this.isNew && !this.employeeId) {
    const seq = await Counter.next('employeeId');
    this.employeeId = `EMP-${String(seq).padStart(5, '0')}`;
  }
});

// ─── Keep isActive in sync ────────────────────────────────────────────────
employeeSchema.pre('save', function () {
  if (this.isModified('employmentStatus') || this.isNew) {
    this.isActive = ACTIVE_STATUSES.includes(this.employmentStatus);
    if (!this.isNew) this.statusChangedAt = new Date();
  }
});

// ─── Lazy extend: open-ended schedules grow to today's year ───────────────
employeeSchema.pre('save', function () {
  if (!this.leaveSchedules || this.leaveSchedules.length === 0) return;

  const now = new Date();
  const currentYear = now.getFullYear();

  for (const s of this.leaveSchedules) {
    if (!scheduleIsOpenEnded(s)) continue;
    const newRows = expandScheduleToMonths(s, currentYear);
    for (const r of newRows) {
      const exists = this.leaveAllocations.some(
        (a) =>
          a.type.trim().toLowerCase() === r.type.trim().toLowerCase() &&
          a.year === r.year &&
          a.month === r.month
      );
      if (!exists) this.leaveAllocations.push(r);
    }
  }
});

// ─── Statics ──────────────────────────────────────────────────────────────
employeeSchema.statics.findByUser = function (userId: Types.ObjectId | string) {
  return this.findOne({ user: userId, isDeleted: false });
};

/**
 * Sums worked hours across Attendance rows for this employee.
 *
 * Uses the Attendance model's denormalized `workedHours` field when
 * present, falling back to computing from arrivalAt/departureAt for
 * legacy rows. Only counts rows where both times are set.
 */
employeeSchema.statics.recomputeTotalWorkingHours = async function (
  employeeDocId: Types.ObjectId,
  from?: Date,
  to?: Date
): Promise<number> {
  let Attendance: any = null;
  try {
    Attendance = mongoose.model('Attendance');
  } catch {
    Attendance = null;
  }
  if (!Attendance) return 0;

  const match: any = {
    employee: employeeDocId,
    isDeleted: false,
    arrivalAt: { $ne: null },
    departureAt: { $ne: null },
  };
  if (from || to) {
    match.date = {};
    if (from) match.date.$gte = from;
    if (to) match.date.$lte = to;
  }

  const [result] = await Attendance.aggregate([
    { $match: match },
    {
      $project: {
        // Prefer the stored workedHours; recompute if it's zero/missing.
        hours: {
          $cond: [
            { $gt: ['$workedHours', 0] },
            '$workedHours',
            {
              $divide: [
                { $subtract: ['$departureAt', '$arrivalAt'] },
                1000 * 60 * 60,
              ],
            },
          ],
        },
      },
    },
    { $group: { _id: null, total: { $sum: '$hours' } } },
  ]);

  const total = result ? +Number(result.total).toFixed(2) : 0;
  if (!from && !to) {
    await this.updateOne(
      { _id: employeeDocId },
      { $set: { totalWorkingHours: total, totalWorkingHoursUpdatedAt: new Date() } }
    );
  }
  return total;
};

/**
 * Extend every open-ended schedule on this employee through `year`
 * (defaults to the current year). Adds missing monthly ledger rows.
 */
employeeSchema.statics.extendSchedules = async function (
  employeeDocId: Types.ObjectId,
  year?: number
): Promise<IEmployee | null> {
  const employee = await this.findById(employeeDocId);
  if (!employee) return null;

  const targetYear = year ?? new Date().getFullYear();
  let dirty = false;

  for (const s of employee.leaveSchedules ?? []) {
    if (!scheduleIsOpenEnded(s)) continue;
    const newRows = expandScheduleToMonths(s, targetYear);
    for (const r of newRows) {
      const exists = employee.leaveAllocations.some(
        (a) =>
          a.type.trim().toLowerCase() === r.type.trim().toLowerCase() &&
          a.year === r.year &&
          a.month === r.month
      );
      if (!exists) {
        employee.leaveAllocations.push(r);
        dirty = true;
      }
    }
  }

  if (dirty) {
    employee.markModified('leaveAllocations');
    await employee.save();
  }
  return employee;
};

const Employee =
  (mongoose.models.Employee as IEmployeeModel) ||
  mongoose.model<IEmployee, IEmployeeModel>('Employee', employeeSchema);

export default Employee;