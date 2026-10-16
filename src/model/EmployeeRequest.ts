// model/EmployeeRequest.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';

// ─── Request types ────────────────────────────────────────────────────────
export type RequestType =
  | 'leave'
  | 'attendance_correction'
  | 'salary_certificate'
  | 'advance'
  | 'loan'
  | 'asset'
  | 'experience_letter'
  | 'permission'
  | 'wfh'
  | 'overtime';                    // ← NEW

export const REQUEST_TYPES: RequestType[] = [
  'leave',
  'attendance_correction',
  'salary_certificate',
  'advance',
  'loan',
  'asset',
  'experience_letter',
  'permission',
  'wfh',
  'overtime',                      // ← NEW
];

export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export const REQUEST_STATUSES: RequestStatus[] = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
];

// How the request entered the system
export type RequestSource =
  | 'self'          // employee submitted it themselves
  | 'on_behalf'     // HR/admin submitted it for the employee
  | 'direct_hr';    // HR directly assigned (e.g. leave) — auto-approved

// ─── Comments ─────────────────────────────────────────────────────────────
export interface IRequestComment {
  author: Types.ObjectId;      // ref User
  authorName: string;          // snapshot, so it survives user deletion
  message: string;
  createdAt: Date;
}

// ─── Type-specific payload ────────────────────────────────────────────────
export interface IRequestTypeData {
  // ── leave ──
  leaveType?: string;
  fromDate?: Date;
  toDate?: Date;
  days?: number;
  halfDay?: 'first' | 'second' | null;
  reason?: string;

  // ── wfh ──
  // reuses fromDate, toDate, days, reason

  // ── permission ──
  permissionDate?: Date;
  fromTime?: string;
  toTime?: string;
  hours?: number;

  // ── attendance_correction ──
  correctionDate?: Date;
  claimedCheckIn?: string;
  claimedCheckOut?: string;
  correctionNote?: string;

  // ── salary_certificate / experience_letter ──
  addressedTo?: string;
  purpose?: string;
  language?: string;

  // ── advance / loan ──
  amount?: number;
  currency?: string;
  installments?: number;
  repaymentStartDate?: Date;

  // ── asset ──
  assetType?: string;
  assetDetails?: string;
  quantity?: number;

  // ── overtime (NEW) ─────────────────────────────────────────────────────
  overtimeDate?: Date;            // the day the overtime was worked
  overtimeFromTime?: string;      // "18:00"
  overtimeToTime?: string;        // "21:00"
  overtimeHours?: number;         // computed on submit; approver can adjust
  overtimeRatePerHour?: number;   // snapshot of employee.overtimePerHourAmount
  overtimeAmount?: number;        // hours * rate (snapshot)
  overtimeNote?: string;          // short description of the work

  // Set on APPROVAL by the approver (may differ from submission values)
  approvedOvertimeHours?: number;
  approvedOvertimeRatePerHour?: number;
  approvedOvertimeAmount?: number;
}

// ─── Main document ────────────────────────────────────────────────────────
export interface IEmployeeRequest extends Document {
  _id: Types.ObjectId;

  employee: Types.ObjectId;    // ref Employee — required
  user: Types.ObjectId | null; // ref User — convenience, null for standalone employees

  type: RequestType;
  status: RequestStatus;
  source: RequestSource;

  subject: string;
  data: IRequestTypeData;

  decidedBy: Types.ObjectId | null;
  decidedByName: string;
  decidedAt: Date | null;
  decisionNote: string;

  cancelledBy: Types.ObjectId | null;
  cancelledAt: Date | null;

  comments: IRequestComment[];

  appliedEffects?: {
    attendanceRowsCreated?: number;
    attendanceRowsUpdated?: number;
    leaveAllocationRowsTouched?: number;
    appliedAt?: Date;
    notes?: string;
  } | null;

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Model statics ────────────────────────────────────────────────────────
export interface IEmployeeRequestModel extends Model<IEmployeeRequest> {
  findPending(employeeId?: Types.ObjectId | string): Promise<IEmployeeRequest[]>;
  hasOverlap(
    employeeId: Types.ObjectId,
    type: RequestType,
    from: Date,
    to: Date,
    excludeId?: Types.ObjectId
  ): Promise<boolean>;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────
const commentSchema = new Schema<IRequestComment>(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    authorName: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true, maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const typeDataSchema = new Schema<IRequestTypeData>(
  {
    // leave / wfh
    leaveType: { type: String, trim: true, maxlength: 40 },
    fromDate: { type: Date },
    toDate: { type: Date },
    days: { type: Number, min: 0, max: 365 },
    halfDay: {
      type: String,
      enum: ['first', 'second', null],
      default: null,
    },
    reason: { type: String, trim: true, maxlength: 1000 },

    // permission
    permissionDate: { type: Date },
    fromTime: {
      type: String,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'fromTime must be HH:mm'],
    },
    toTime: {
      type: String,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'toTime must be HH:mm'],
    },
    hours: { type: Number, min: 0, max: 24 },

    // attendance correction
    correctionDate: { type: Date },
    claimedCheckIn: {
      type: String,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'claimedCheckIn must be HH:mm'],
    },
    claimedCheckOut: {
      type: String,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'claimedCheckOut must be HH:mm'],
    },
    correctionNote: { type: String, trim: true, maxlength: 500 },

    // letters
    addressedTo: { type: String, trim: true, maxlength: 200 },
    purpose: { type: String, trim: true, maxlength: 500 },
    language: { type: String, trim: true, maxlength: 10 },

    // advance / loan
    amount: { type: Number, min: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 5, default: 'PKR' },
    installments: { type: Number, min: 1, max: 60 },
    repaymentStartDate: { type: Date },

    // asset
    assetType: { type: String, trim: true, maxlength: 50 },
    assetDetails: { type: String, trim: true, maxlength: 500 },
    quantity: { type: Number, min: 1, max: 100 },

    // ── overtime (NEW) ───────────────────────────────────────────────────
    overtimeDate: { type: Date },
    overtimeFromTime: {
      type: String,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'overtimeFromTime must be HH:mm'],
    },
    overtimeToTime: {
      type: String,
      match: [/^([01]\d|2[0-3]):([0-5]\d)$/, 'overtimeToTime must be HH:mm'],
    },
    overtimeHours: { type: Number, min: 0, max: 24 },
    overtimeRatePerHour: { type: Number, min: 0 },
    overtimeAmount: { type: Number, min: 0 },
    overtimeNote: { type: String, trim: true, maxlength: 500 },

    approvedOvertimeHours: { type: Number, min: 0, max: 24 },
    approvedOvertimeRatePerHour: { type: Number, min: 0 },
    approvedOvertimeAmount: { type: Number, min: 0 },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────
const employeeRequestSchema = new Schema<
  IEmployeeRequest,
  IEmployeeRequestModel
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
      default: null,
      index: true,
    },

    type: {
      type: String,
      enum: REQUEST_TYPES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: 'pending',
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ['self', 'on_behalf', 'direct_hr'],
      default: 'self',
      required: true,
    },

    subject: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    data: { type: typeDataSchema, default: {} },

    decidedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    decidedByName: { type: String, trim: true, default: '' },
    decidedAt: { type: Date, default: null },
    decisionNote: { type: String, trim: true, maxlength: 1000, default: '' },

    cancelledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    cancelledAt: { type: Date, default: null },

    comments: { type: [commentSchema], default: [] },

    appliedEffects: {
      type: {
        attendanceRowsCreated: { type: Number, default: 0 },
        attendanceRowsUpdated: { type: Number, default: 0 },
        leaveAllocationRowsTouched: { type: Number, default: 0 },
        appliedAt: { type: Date },
        notes: { type: String, trim: true, maxlength: 500 },
      },
      default: null,
    },

    isDeleted: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────
employeeRequestSchema.index({ employee: 1, status: 1, createdAt: -1 });
employeeRequestSchema.index({ type: 1, status: 1, createdAt: -1 });
employeeRequestSchema.index({ 'data.fromDate': 1, 'data.toDate': 1 });
employeeRequestSchema.index({ 'data.overtimeDate': 1 });      // ← NEW
employeeRequestSchema.index({ isDeleted: 1, createdAt: -1 });

// ─── Validation: type-specific required fields ────────────────────────────
employeeRequestSchema.pre('validate', function () {
  const d = this.data || {};

  const check = (cond: boolean, msg: string) => {
    if (cond) throw new Error(msg);
  };

  switch (this.type) {
    case 'leave':
      check(!d.leaveType, 'leave: leaveType is required');
      check(!d.fromDate, 'leave: fromDate is required');
      check(!d.toDate, 'leave: toDate is required');
      check(d.fromDate! > d.toDate!, 'leave: fromDate cannot be after toDate');
      break;

    case 'wfh':
      check(!d.fromDate, 'wfh: fromDate is required');
      check(!d.toDate, 'wfh: toDate is required');
      check(d.fromDate! > d.toDate!, 'wfh: fromDate cannot be after toDate');
      break;

    case 'permission':
      check(!d.permissionDate, 'permission: permissionDate is required');
      check(!d.fromTime, 'permission: fromTime is required');
      check(!d.toTime, 'permission: toTime is required');
      break;

    case 'attendance_correction':
      check(!d.correctionDate, 'attendance_correction: correctionDate is required');
      check(
        !d.claimedCheckIn && !d.claimedCheckOut,
        'attendance_correction: at least one of claimedCheckIn / claimedCheckOut is required'
      );
      break;

    case 'advance':
    case 'loan':
      check(!d.amount || d.amount <= 0, `${this.type}: amount must be > 0`);
      break;

    case 'asset':
      check(!d.assetType, 'asset: assetType is required');
      break;

    case 'overtime':                                              // ← NEW
      check(!d.overtimeDate, 'overtime: overtimeDate is required');
      check(!d.overtimeFromTime, 'overtime: overtimeFromTime is required');
      check(!d.overtimeToTime, 'overtime: overtimeToTime is required');
      break;

    default:
      break;
  }
});

// ─── Statics ──────────────────────────────────────────────────────────────
employeeRequestSchema.statics.findPending = function (
  employeeId?: Types.ObjectId | string
) {
  const filter: any = { status: 'pending', isDeleted: false };
  if (employeeId) filter.employee = employeeId;
  return this.find(filter).sort({ createdAt: -1 });
};

employeeRequestSchema.statics.hasOverlap = async function (
  employeeId: Types.ObjectId,
  type: RequestType,
  from: Date,
  to: Date,
  excludeId?: Types.ObjectId
): Promise<boolean> {
  const filter: any = {
    employee: employeeId,
    type,
    status: { $in: ['pending', 'approved'] },
    isDeleted: false,
    'data.fromDate': { $lte: to },
    'data.toDate': { $gte: from },
  };
  if (excludeId) filter._id = { $ne: excludeId };

  const found = await this.findOne(filter).select('_id').lean();
  return !!found;
};

const EmployeeRequest =
  (mongoose.models.EmployeeRequest as IEmployeeRequestModel) ||
  mongoose.model<IEmployeeRequest, IEmployeeRequestModel>(
    'EmployeeRequest',
    employeeRequestSchema
  );

export default EmployeeRequest;