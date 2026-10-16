// model/ProviderExpense.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';

// ═══════════════════════════════════════════════════════════════════════════
// ENUMS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type ExpensePeriodType = 'one_off' | 'weekly' | 'monthly';

export const EXPENSE_PERIOD_TYPES: ExpensePeriodType[] = [
  'one_off', 'weekly', 'monthly',
];

export type ExpenseStatus = 'pending' | 'paid' | 'cancelled';

export const EXPENSE_STATUSES: ExpenseStatus[] = [
  'pending', 'paid', 'cancelled',
];

export type PaymentMethod =
  | 'cash'
  | 'bank_transfer'
  | 'cheque'
  | 'card'
  | 'online'
  | 'other';

export const PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'bank_transfer', 'cheque', 'card', 'online', 'other',
];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  card: 'Card',
  online: 'Online',
  other: 'Other',
};

// ── AP: Payable type discriminator ────────────────────────────────────────
export type PayableType = 'provider_bill' | 'adhoc';

export const PAYABLE_TYPES: PayableType[] = ['provider_bill', 'adhoc'];

// ═══════════════════════════════════════════════════════════════════════════
// SUB-INTERFACES
// ═══════════════════════════════════════════════════════════════════════════

export interface IExpensePeriod {
  type: ExpensePeriodType;
  year?: number;
  month?: number;
  weekStart?: Date;
  weekEnd?: Date;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

export interface IProviderExpense extends Document {
  _id: Types.ObjectId;

  // ── Discriminator ────────────────────────────────────────────────────
  payableType: PayableType;

  // ── Provider (only for provider_bill) ────────────────────────────────
  provider: Types.ObjectId | null;

  // ── Ad-hoc payee (only for adhoc) ────────────────────────────────────
  payeeName?: string;
  payeeContact?: string;
  payeeEmail?: string;
  payeePhone?: string;

  // ── Amount & dates ───────────────────────────────────────────────────
  amount: number;
  currency: string;
  expenseDate: Date;

  // ── Classification ───────────────────────────────────────────────────
  category: string; // free text — snapshot from provider or user-entered for adhoc
  period: IExpensePeriod;

  // ── Status & payment ─────────────────────────────────────────────────
  status: ExpenseStatus;
  invoiceNo?: string;
  description?: string;
  notes?: string;

  paidAt?: Date | null;
  paidBy?: Types.ObjectId | null;
  paymentMethod?: PaymentMethod;

  // ── Audit ────────────────────────────────────────────────────────────
  createdBy: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;

  // ── Virtuals ─────────────────────────────────────────────────────────
  /** Display name for AP lists — provider name or ad-hoc payee name. */
  payeeDisplayName?: string;
}

export interface IProviderExpenseModel extends Model<IProviderExpense> {}

// ═══════════════════════════════════════════════════════════════════════════
// SUB-SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const periodSchema = new Schema<IExpensePeriod>(
  {
    type: {
      type: String,
      enum: EXPENSE_PERIOD_TYPES,
      required: true,
    },
    year: { type: Number, min: 2000, max: 2100 },
    month: { type: Number, min: 1, max: 12 },
    weekStart: { type: Date },
    weekEnd: { type: Date },
  },
  { _id: false }
);

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const providerExpenseSchema = new Schema<
  IProviderExpense,
  IProviderExpenseModel
>(
  {
    // ── Discriminator ──────────────────────────────────────────────────
    payableType: {
      type: String,
      enum: PAYABLE_TYPES,
      default: 'provider_bill',
      index: true,
    },

    // ── Provider (optional now — required only when payableType === 'provider_bill') ──
    provider: {
      type: Schema.Types.ObjectId,
      ref: 'Provider',
      default: null,
      index: true,
    },

    // ── Ad-hoc payee fields ────────────────────────────────────────────
    payeeName: { type: String, trim: true, maxlength: 200 },
    payeeContact: { type: String, trim: true, maxlength: 200 },
    payeeEmail: { type: String, trim: true, lowercase: true, maxlength: 200 },
    payeePhone: { type: String, trim: true, maxlength: 30 },

    // ── Amount & dates ─────────────────────────────────────────────────
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Amount must be greater than 0'],
    },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      default: 'PKR',
      maxlength: 5,
    },
    expenseDate: { type: Date, required: true, index: true },

    // ── Classification ─────────────────────────────────────────────────
    category: {
      type: String,
      trim: true,
      maxlength: 80,
      required: false,
      default: '',
      index: true,
    },

    period: { type: periodSchema, required: true },

    // ── Status & payment ───────────────────────────────────────────────
    status: {
      type: String,
      enum: EXPENSE_STATUSES,
      default: 'pending',
      index: true,
    },
    invoiceNo: { type: String, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300 },
    notes: { type: String, trim: true, maxlength: 1000 },

    paidAt: { type: Date, default: null },
    paidBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHODS,
      default: undefined,
    },

    // ── Audit ──────────────────────────────────────────────────────────
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

providerExpenseSchema.index({ provider: 1, expenseDate: -1 });
providerExpenseSchema.index({ payeeName: 1, expenseDate: -1 });
providerExpenseSchema.index({ payableType: 1, status: 1, expenseDate: -1 });
providerExpenseSchema.index({ status: 1, expenseDate: -1 });
providerExpenseSchema.index({ 'period.year': 1, 'period.month': 1 });
providerExpenseSchema.index({ 'period.weekStart': 1, 'period.weekEnd': 1 });

// ═══════════════════════════════════════════════════════════════════════════
// VIRTUALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Display name for AP lists.
 * - provider_bill → snapshot from provider (caller populates `provider`)
 * - adhoc → uses payeeName
 */
providerExpenseSchema.virtual('payeeDisplayName').get(function (
  this: IProviderExpense
) {
  if (this.payableType === 'adhoc') {
    return this.payeeName || '(no payee name)';
  }
  // If provider was populated, use its name; otherwise fall back
  const prov: any = this.provider;
  if (prov && typeof prov === 'object' && prov.name) return prov.name;
  return this.payeeName || '(unknown provider)';
});

// ═══════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════

providerExpenseSchema.pre('validate', function () {
  // ── Provider / Payee validation ─────────────────────────────────────
  if (this.payableType === 'provider_bill') {
    if (!this.provider) {
      throw new Error('provider is required for provider_bill payables');
    }
  } else if (this.payableType === 'adhoc') {
    if (!this.payeeName || !String(this.payeeName).trim()) {
      throw new Error('payeeName is required for adhoc payables');
    }
    // Ad-hoc payables never link to a provider
    this.provider = null;
  }

  // ── Period validation ───────────────────────────────────────────────
  const p = this.period;
  if (!p) return;

  if (p.type === 'monthly') {
    if (!Number.isInteger(p.year) || !Number.isInteger(p.month)) {
      throw new Error('Monthly expenses require year and month (1-12)');
    }
  } else if (p.type === 'weekly') {
    if (!p.weekStart || !p.weekEnd) {
      throw new Error('Weekly expenses require weekStart and weekEnd');
    }
    if (p.weekStart > p.weekEnd) {
      throw new Error('weekStart must be before weekEnd');
    }
  }
});

providerExpenseSchema.pre('save', function () {
  if (
    this.isModified('status') &&
    this.status === 'paid' &&
    !this.paidAt
  ) {
    this.paidAt = new Date();
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MODEL
// ═══════════════════════════════════════════════════════════════════════════

const ProviderExpense =
  (mongoose.models.ProviderExpense as IProviderExpenseModel) ||
  mongoose.model<IProviderExpense, IProviderExpenseModel>(
    'ProviderExpense',
    providerExpenseSchema
  );

export default ProviderExpense;