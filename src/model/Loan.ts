// model/Loan.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export type LoanStatus =
  | 'active'      // schedule generated, installments being paid
  | 'settled'     // all installments paid
  | 'defaulted'   // HR manually marked defaulted (e.g. employee left mid-loan)
  | 'cancelled';  // cancelled by HR before any installment was paid

export const LOAN_STATUSES: LoanStatus[] = [
  'active',
  'settled',
  'defaulted',
  'cancelled',
];

export type InstallmentStatus = 'pending' | 'paid' | 'skipped';

export interface ILoanInstallment {
  /** 1-indexed sequence number, e.g. 1, 2, 3 … */
  seq: number;
  /** Which month (UTC midnight, day=1) this installment is due. */
  dueDate: Date;
  amount: number;
  status: InstallmentStatus;
  paidAt?: Date | null;
  paidAmount?: number;
  /** Set by payroll when the payslip that paid this installment is generated. */
  payrollId?: Types.ObjectId | null;
  notes?: string;
}

export interface ILoan extends Document {
  _id: Types.ObjectId;

  // Link back to the original request (audit).
  request: Types.ObjectId;              // ref EmployeeRequest

  // Who owes.
  employee: Types.ObjectId;             // ref Employee
  user: Types.ObjectId | null;          // ref User (nullable)
  employeeId: string;                   // "EMP-00001" — snapshot
  employeeName: string;                 // snapshot
  department: string;                   // snapshot

  // Money.
  principal: number;                    // total borrowed
  currency: string;                     // "PKR"
  installmentsCount: number;            // total planned installments
  installmentAmount: number;            // per-installment amount (uniform)
  outstandingAmount: number;            // recomputed on every payment
  totalPaid: number;                    // cumulative

  // Timeline.
  startDate: Date;                      // first installment due month
  approvedAt: Date;
  approvedBy: Types.ObjectId;           // ref User
  approvedByName: string;

  // Schedule.
  installments: ILoanInstallment[];

  // Status.
  status: LoanStatus;
  settledAt?: Date | null;
  cancelledAt?: Date | null;
  cancelledBy?: Types.ObjectId | null;
  cancellationReason?: string;

  // Type / purpose (free-form; driven by request)
  reason?: string;

  // Payroll integration hook — last payroll run that touched this loan.
  lastPayrollId?: Types.ObjectId | null;

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILoanModel extends Model<ILoan> {
  /** Recompute outstandingAmount + totalPaid + status from installments. */
  recomputeTotals(loanId: Types.ObjectId): Promise<ILoan | null>;

  /** Total outstanding across all active loans for an employee. */
  outstandingFor(employeeId: Types.ObjectId): Promise<number>;
}

// ─── Sub-schema ──────────────────────────────────────────────────────────

const installmentSchema = new Schema<ILoanInstallment>(
  {
    seq: { type: Number, required: true, min: 1 },
    dueDate: { type: Date, required: true },
    amount: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ['pending', 'paid', 'skipped'],
      default: 'pending',
      required: true,
    },
    paidAt: { type: Date, default: null },
    paidAmount: { type: Number, min: 0 },
    payrollId: { type: Schema.Types.ObjectId, ref: 'Payroll', default: null },
    notes: { type: String, trim: true, maxlength: 300 },
  },
  { _id: true }
);

// ─── Main schema ─────────────────────────────────────────────────────────

const loanSchema = new Schema<ILoan, ILoanModel>(
  {
    request: {
      type: Schema.Types.ObjectId,
      ref: 'EmployeeRequest',
      required: true,
      unique: true,
      index: true,
    },

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

    principal: { type: Number, required: true, min: 1 },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 5,
      default: 'PKR',
    },
    installmentsCount: { type: Number, required: true, min: 1, max: 120 },
    installmentAmount: { type: Number, required: true, min: 0 },
    outstandingAmount: { type: Number, required: true, min: 0 },
    totalPaid: { type: Number, default: 0, min: 0 },

    startDate: { type: Date, required: true },
    approvedAt: { type: Date, required: true },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    approvedByName: { type: String, trim: true, default: '' },

    installments: {
      type: [installmentSchema],
      default: [],
      validate: {
        validator: (arr: ILoanInstallment[]) => {
          const seqs = arr.map((i) => i.seq);
          return new Set(seqs).size === seqs.length;
        },
        message: 'Installment sequence numbers must be unique',
      },
    },

    status: {
      type: String,
      enum: LOAN_STATUSES,
      default: 'active',
      required: true,
      index: true,
    },
    settledAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelledBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    cancellationReason: { type: String, trim: true, maxlength: 500 },

    reason: { type: String, trim: true, maxlength: 1000 },

    lastPayrollId: {
      type: Schema.Types.ObjectId,
      ref: 'Payroll',
      default: null,
    },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ─── Indexes ─────────────────────────────────────────────────────────────

loanSchema.index({ employee: 1, status: 1, createdAt: -1 });
loanSchema.index({ status: 1, isDeleted: 1 });
loanSchema.index({ 'installments.dueDate': 1, 'installments.status': 1 });

// ─── Virtuals ────────────────────────────────────────────────────────────

loanSchema.virtual('progress').get(function () {
  const total = this.installmentsCount || 0;
  const paid = (this.installments ?? []).filter((i) => i.status === 'paid').length;
  return {
    paid,
    total,
    percent: total === 0 ? 0 : +((paid / total) * 100).toFixed(2),
  };
});

// ─── Statics ─────────────────────────────────────────────────────────────

loanSchema.statics.recomputeTotals = async function (
  loanId: Types.ObjectId
): Promise<ILoan | null> {
  const loan = await this.findById(loanId);
  if (!loan) return null;

  let totalPaid = 0;
  for (const inst of loan.installments) {
    if (inst.status === 'paid') {
      totalPaid += inst.paidAmount ?? inst.amount;
    }
  }

  loan.totalPaid = +totalPaid.toFixed(2);
  loan.outstandingAmount = +Math.max(0, loan.principal - totalPaid).toFixed(2);

  const allPaid =
    loan.installments.length > 0 &&
    loan.installments.every((i) => i.status === 'paid' || i.status === 'skipped');

  if (allPaid && loan.status === 'active') {
    loan.status = 'settled';
    loan.settledAt = new Date();
  } else if (!allPaid && loan.status === 'settled') {
    // Unsettle if an installment was rolled back
    loan.status = 'active';
    loan.settledAt = null;
  }

  await loan.save();
  return loan;
};

loanSchema.statics.outstandingFor = async function (
  employeeId: Types.ObjectId
): Promise<number> {
  const result = await this.aggregate([
    {
      $match: {
        employee: employeeId,
        status: 'active',
        isDeleted: false,
      },
    },
    { $group: { _id: null, total: { $sum: '$outstandingAmount' } } },
  ]);
  return result[0]?.total ?? 0;
};

const Loan =
  (mongoose.models.Loan as ILoanModel) ||
  mongoose.model<ILoan, ILoanModel>('Loan', loanSchema);

export default Loan;