// model/attendance.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export type AttendanceStatus =
  | 'present'
  | 'absent'
  | 'late'
  | 'half_day'
  | 'leave'
  | 'holiday'
  | 'weekend';

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  'present',
  'absent',
  'late',
  'half_day',
  'leave',
  'holiday',
  'weekend',
];

/** Statuses that count as "the employee was at work". */
export const ATTENDED_STATUSES: AttendanceStatus[] = [
  'present',
  'late',
  'half_day',
];

export interface IAttendance extends Document {
  _id: Types.ObjectId;

  // ── Identity (denormalized for fast listing) ─────────────────────
  employee: Types.ObjectId;          // ref Employee
  user: Types.ObjectId | null;       // ref User (nullable — not every employee has login)
  employeeId: string;                // "EMP-00001"
  employeeName: string;
  department: string;

  // ── The day (always midnight UTC) ────────────────────────────────
  date: Date;

  // ── Times ────────────────────────────────────────────────────────
  arrivalAt?: Date | null;
  departureAt?: Date | null;
  workedHours: number;               // computed, stored for stats

  // ── Derived status ───────────────────────────────────────────────
  status: AttendanceStatus;

  // ── Provenance ───────────────────────────────────────────────────
  source: 'auto' | 'manual';
  markedBy?: Types.ObjectId | null;  // only set for manual rows
  notes?: string;

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAttendanceModel extends Model<IAttendance> {
  normalizeDate(d: Date | string): Date;
}

const attendanceSchema = new Schema<IAttendance, IAttendanceModel>(
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
      default: null,
      index: true,
    },
    employeeId: { type: String, required: true, trim: true, index: true },
    employeeName: { type: String, required: true, trim: true },
    department: { type: String, trim: true, default: '' },

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

    arrivalAt: { type: Date, default: null },
    departureAt: { type: Date, default: null },
    workedHours: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ATTENDANCE_STATUSES,
      default: 'absent',
      required: true,
      index: true,
    },

    source: {
      type: String,
      enum: ['auto', 'manual'],
      default: 'auto',
      required: true,
    },
    markedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    notes: { type: String, trim: true, maxlength: 500 },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// One row per employee per day
attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1, isDeleted: 1 });
attendanceSchema.index({ department: 1, date: 1 });

attendanceSchema.statics.normalizeDate = function (d: Date | string): Date {
  const date = new Date(d);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
};

attendanceSchema.pre('validate', function () {
  if (this.isModified('date') && this.date) {
    const M = this.constructor as IAttendanceModel;
    this.date = M.normalizeDate(this.date);
  }
});

const Attendance =
  (mongoose.models.Attendance as IAttendanceModel) ||
  mongoose.model<IAttendance, IAttendanceModel>('Attendance', attendanceSchema);

export default Attendance;