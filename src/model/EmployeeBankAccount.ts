// model/EmployeeBankAccount.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';

export type EmployeeBankAccountType =
  | 'savings'
  | 'current'
  | 'salary'
  | 'other';

export type EmployeeBankAccountStatus =
  | 'pending'
  | 'verified'
  | 'rejected'
  | 'inactive';

export const EMPLOYEE_BANK_ACCOUNT_TYPES: EmployeeBankAccountType[] = [
  'savings',
  'current',
  'salary',
  'other',
];

export const EMPLOYEE_BANK_ACCOUNT_STATUSES: EmployeeBankAccountStatus[] = [
  'pending',
  'verified',
  'rejected',
  'inactive',
];

export interface IEmployeeBankAccount extends Document {
  _id: Types.ObjectId;

  /** The employee this account belongs to */
  employee: Types.ObjectId;

  /** Optional shortcut to the user (if employee is linked to a user) */
  user?: Types.ObjectId | null;

  // ── Bank identity ─────────────────────────────────────────────
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  accountType: EmployeeBankAccountType;

  // ── Branch & location ────────────────────────────────────────
  branchName?: string;
  branchCode?: string;
  branchAddress?: string;

  // ── International identifiers ────────────────────────────────
  iban?: string;
  swiftCode?: string;
  routingNumber?: string;

  currency: string;

  // ── Flags ─────────────────────────────────────────────────────
  isPrimary: boolean;
  status: EmployeeBankAccountStatus;

  // ── Verification ─────────────────────────────────────────────
  verifiedAt?: Date | null;
  verifiedBy?: Types.ObjectId | null;
  rejectionReason?: string;

  // ── Notes ─────────────────────────────────────────────────────
  notes?: string;

  // ── Meta ──────────────────────────────────────────────────────
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IEmployeeBankAccountModel
  extends Model<IEmployeeBankAccount> {
  findByEmployee(employeeId: Types.ObjectId | string): Promise<IEmployeeBankAccount[]>;
  getPrimary(employeeId: Types.ObjectId | string): Promise<IEmployeeBankAccount | null>;
  clearPrimary(employeeId: Types.ObjectId | string, exceptId?: Types.ObjectId): Promise<void>;
}

const employeeBankAccountSchema = new Schema<
  IEmployeeBankAccount,
  IEmployeeBankAccountModel
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

    bankName: {
      type: String,
      required: [true, 'Bank name is required'],
      trim: true,
      maxlength: 200,
    },
    accountTitle: {
      type: String,
      required: [true, 'Account title is required'],
      trim: true,
      maxlength: 200,
    },
    accountNumber: {
      type: String,
      required: [true, 'Account number is required'],
      trim: true,
      maxlength: 60,
      index: true,
    },
    accountType: {
      type: String,
      enum: EMPLOYEE_BANK_ACCOUNT_TYPES,
      default: 'savings',
      required: true,
    },

    branchName: { type: String, trim: true, maxlength: 200 },
    branchCode: { type: String, trim: true, maxlength: 40 },
    branchAddress: { type: String, trim: true, maxlength: 500 },

    iban: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 34,
    },
    swiftCode: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 20,
    },
    routingNumber: { type: String, trim: true, maxlength: 40 },

    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 3,
      default: 'PKR',
    },

    isPrimary: { type: Boolean, default: false, index: true },
    status: {
      type: String,
      enum: EMPLOYEE_BANK_ACCOUNT_STATUSES,
      default: 'pending',
      index: true,
    },

    verifiedAt: { type: Date, default: null },
    verifiedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    rejectionReason: { type: String, trim: true, maxlength: 500 },

    notes: { type: String, trim: true, maxlength: 1000 },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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

// ── Indexes ─────────────────────────────────────────────────────
employeeBankAccountSchema.index({ employee: 1, isDeleted: 1 });
employeeBankAccountSchema.index({ employee: 1, isPrimary: 1 });
employeeBankAccountSchema.index({ employee: 1, status: 1 });
employeeBankAccountSchema.index(
  { employee: 1, accountNumber: 1, bankName: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

// ── Hooks ───────────────────────────────────────────────────────
employeeBankAccountSchema.pre('save', async function () {
  // Only one primary account per employee
  if (this.isPrimary && (this.isNew || this.isModified('isPrimary'))) {
    await (this.constructor as IEmployeeBankAccountModel).updateMany(
      { employee: this.employee, _id: { $ne: this._id }, isDeleted: false },
      { $set: { isPrimary: false } }
    );
  }
});

employeeBankAccountSchema.post('init', function () {
  // no-op for now
});

// ── Statics ─────────────────────────────────────────────────────
employeeBankAccountSchema.statics.findByEmployee = function (
  employeeId: Types.ObjectId | string
) {
  return this.find({ employee: employeeId, isDeleted: false }).sort({
    isPrimary: -1,
    createdAt: -1,
  });
};

employeeBankAccountSchema.statics.getPrimary = function (
  employeeId: Types.ObjectId | string
) {
  return this.findOne({
    employee: employeeId,
    isPrimary: true,
    isDeleted: false,
  });
};

employeeBankAccountSchema.statics.clearPrimary = async function (
  employeeId: Types.ObjectId | string,
  exceptId?: Types.ObjectId
) {
  const filter: any = { employee: employeeId, isDeleted: false };
  if (exceptId) filter._id = { $ne: exceptId };
  await this.updateMany(filter, { $set: { isPrimary: false } });
};

// ── Export ──────────────────────────────────────────────────────
const EmployeeBankAccount =
  (mongoose.models.EmployeeBankAccount as IEmployeeBankAccountModel) ||
  mongoose.model<IEmployeeBankAccount, IEmployeeBankAccountModel>(
    'EmployeeBankAccount',
    employeeBankAccountSchema
  );

export default EmployeeBankAccount;