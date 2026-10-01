// model/client.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Counter from './counter';

// ─── Enums & Types ────────────────────────────────────────────────────────
export type ClientType = 'individual' | 'company' | 'government' | 'non_profit';

export type ClientStatus = 'active' | 'inactive' | 'blacklisted';

export type ClientTier = 'standard' | 'premium' | 'vip' | 'enterprise';

/** Payment terms: either the literal 'due_on_receipt' OR a numeric string of days.
 *  Examples: 'due_on_receipt', '7', '15', '30', '45', '60', '90' */
export type PaymentTerms = 'due_on_receipt' | string;

// ─── Sub-document Interfaces ──────────────────────────────────────────────
export interface IClientContact {
  name: string;
  designation?: string;
  email?: string;
  phoneNo?: string;
  isPrimary: boolean;
}

export interface IClientAddress {
  label: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  postalCode?: string;
  country: string;
  isDefault: boolean;
}

export interface IClientBankAccount {
  bankName: string;
  accountTitle: string;
  accountNumber: string;
  iban?: string;
  branch?: string;
  isPrimary: boolean;
}

// ─── Main Interface ───────────────────────────────────────────────────────
export interface IClient extends Document {
  _id: Types.ObjectId;

  clientId: string;

  // Core identity
  name: string;
  clientType: ClientType;
  displayName?: string;
  email?: string;
  phoneNo: string;
  alternatePhoneNo?: string;
  website?: string;

  // Legal / tax identifiers
  cnic?: string;
  ntn?: string;
  strn?: string;
  registrationNo?: string;

  // Categorization
  industry?: string;
  tier: ClientTier;

  // Contacts & addresses
  contacts: IClientContact[];
  addresses: IClientAddress[];

  // Financial
  creditLimit: number;
  openingBalance: number;
  currentBalance: number;
  currency: string;
  paymentTerms: PaymentTerms;          // 'due_on_receipt' OR '15' / '30' / ...
  taxExempt: boolean;

  bankAccounts: IClientBankAccount[];

  // Status
  status: ClientStatus;
  statusReason?: string;
  statusChangedAt?: Date;
  isActive: boolean;

  // Relationships
  accountManager: Types.ObjectId | null;

  // Audit
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // ─── Virtuals ───────────────────────────────────────────────────────────
  hasUserAccount: boolean;
  primaryContact: IClientContact | null;
  billingAddress: IClientAddress | null;
  shippingAddress: IClientAddress | null;
  primaryBankAccount: IClientBankAccount | null;
  availableCredit: number;
  isOverCreditLimit: boolean;
  paymentTermsDays: number;            // 0 for due_on_receipt, N for numeric
  isDueOnReceipt: boolean;
}

export interface IClientModel extends Model<IClient> {
  findByUser(userId: Types.ObjectId | string): Promise<IClient | null>;
  findActive(filter?: Record<string, any>): Promise<IClient[]>;
}

// ─── Constants ────────────────────────────────────────────────────────────
export const CLIENT_TYPES: ClientType[] = [
  'individual', 'company', 'government', 'non_profit',
];

export const CLIENT_STATUSES: ClientStatus[] = ['active', 'inactive', 'blacklisted'];

export const CLIENT_TIERS: ClientTier[] = ['standard', 'premium', 'vip', 'enterprise'];

/** The literal sentinel value for "due on receipt". */
export const DUE_ON_RECEIPT = 'due_on_receipt' as const;

/** Suggested numeric options for the dropdown (user can still type any number). */
export const SUGGESTED_PAYMENT_TERM_DAYS = ['7', '15', '30', '45', '60', '90'] as const;

/** Full dropdown list: Due on Receipt + suggested numeric values. */
export const PAYMENT_TERM_OPTIONS: PaymentTerms[] = [
  DUE_ON_RECEIPT,
  ...SUGGESTED_PAYMENT_TERM_DAYS,
];

/** Validates: either 'due_on_receipt' OR a numeric string 0–365. */
export function isValidPaymentTerms(v: string): boolean {
  if (v === DUE_ON_RECEIPT) return true;
  if (!/^\d{1,3}$/.test(v)) return false;
  const n = Number(v);
  return n >= 0 && n <= 365;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────
const clientContactSchema = new Schema<IClientContact>(
  {
    name:        { type: String, required: true, trim: true, maxlength: 120 },
    designation: { type: String, trim: true, maxlength: 120 },
    email:       { type: String, trim: true, lowercase: true },
    phoneNo:     { type: String, trim: true, maxlength: 30 },
    isPrimary:   { type: Boolean, default: false },
  },
  { _id: true }
);

const clientAddressSchema = new Schema<IClientAddress>(
  {
    label:      { type: String, required: true, trim: true, maxlength: 40 },
    line1:      { type: String, required: true, trim: true, maxlength: 200 },
    line2:      { type: String, trim: true, maxlength: 200 },
    city:       { type: String, required: true, trim: true, maxlength: 100 },
    state:      { type: String, trim: true, maxlength: 100 },
    postalCode: { type: String, trim: true, maxlength: 20 },
    country:    { type: String, required: true, trim: true, maxlength: 100, default: 'Pakistan' },
    isDefault:  { type: Boolean, default: false },
  },
  { _id: true }
);

const clientBankAccountSchema = new Schema<IClientBankAccount>(
  {
    bankName:      { type: String, required: true, trim: true, maxlength: 120 },
    accountTitle:  { type: String, required: true, trim: true, maxlength: 120 },
    accountNumber: { type: String, required: true, trim: true, maxlength: 50 },
    iban:          { type: String, trim: true, uppercase: true, maxlength: 34 },
    branch:        { type: String, trim: true, maxlength: 120 },
    isPrimary:     { type: Boolean, default: false },
  },
  { _id: true }
);

// ─── Main Client Schema ───────────────────────────────────────────────────
const clientSchema = new Schema<IClient, IClientModel>(
  {
 

    clientId: { type: String, required: true, unique: true, trim: true },

    // ── Core identity ────────────────────────────────────────────────
    name:        { type: String, required: true, trim: true, maxlength: 200 },
    clientType:  { type: String, enum: CLIENT_TYPES, required: true, default: 'company' },
    displayName: { type: String, trim: true, maxlength: 120 },
    email:       { type: String, trim: true, lowercase: true, default: undefined },
    phoneNo:     { type: String, required: true, trim: true, maxlength: 30 },
    alternatePhoneNo: { type: String, trim: true, maxlength: 30 },
    website:     { type: String, trim: true, maxlength: 200 },

    // ── Legal / tax IDs ──────────────────────────────────────────────
    cnic:           { type: String, trim: true, maxlength: 20 },
    ntn:            { type: String, trim: true, maxlength: 20 },
    strn:           { type: String, trim: true, maxlength: 20 },
    registrationNo: { type: String, trim: true, maxlength: 50 },

    // ── Categorization ───────────────────────────────────────────────
    industry: { type: String, trim: true, maxlength: 100 },
    tier:     { type: String, enum: CLIENT_TIERS, default: 'standard' },

    // ── Contacts & addresses ─────────────────────────────────────────
    contacts: {
      type: [clientContactSchema],
      default: [],
      validate: {
        validator: (arr: IClientContact[]) =>
          arr.filter((c) => c.isPrimary).length <= 1,
        message: 'Only one primary contact is allowed',
      },
    },

    addresses: {
      type: [clientAddressSchema],
      default: [],
      validate: {
        validator: (arr: IClientAddress[]) => {
          const seen = new Set<string>();
          for (const a of arr) {
            const key = a.label.trim().toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
          }
          return true;
        },
        message: 'Duplicate address label',
      },
    },

    // ── Financial ────────────────────────────────────────────────────
    creditLimit:    { type: Number, default: 0, min: 0 },
    openingBalance: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    currency:       { type: String, default: 'PKR', trim: true, uppercase: true, maxlength: 3 },

    paymentTerms: {
      type: String,
      required: true,
      default: '30',
      trim: true,
      validate: {
        validator: isValidPaymentTerms,
        message:
          "paymentTerms must be either 'due_on_receipt' or a numeric string between 0 and 365",
      },
    },

    taxExempt: { type: Boolean, default: false },

    bankAccounts: {
      type: [clientBankAccountSchema],
      default: [],
      validate: {
        validator: (arr: IClientBankAccount[]) =>
          arr.filter((b) => b.isPrimary).length <= 1,
        message: 'Only one primary bank account is allowed',
      },
    },

    // ── Status ───────────────────────────────────────────────────────
    status:          { type: String, enum: CLIENT_STATUSES, default: 'active', required: true },
    statusReason:    { type: String, trim: true, maxlength: 500 },
    statusChangedAt: { type: Date },
    isActive:        { type: Boolean, default: true },

    // ── Relationships ────────────────────────────────────────────────
    accountManager: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
      index: true,
    },

    // ── Audit / soft delete ──────────────────────────────────────────
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────
clientSchema.index({ status: 1, isDeleted: 1 });
clientSchema.index({ isActive: 1, isDeleted: 1 });
clientSchema.index({ clientType: 1, isDeleted: 1 });
clientSchema.index({ tier: 1, isDeleted: 1 });
clientSchema.index({ accountManager: 1, status: 1 });
clientSchema.index({ name: 'text', displayName: 'text', email: 'text' });



clientSchema.virtual('primaryContact').get(function () {
  if (!this.contacts?.length) return null;
  return this.contacts.find((c) => c.isPrimary) ?? this.contacts[0] ?? null;
});

clientSchema.virtual('billingAddress').get(function () {
  if (!this.addresses?.length) return null;
  return (
    this.addresses.find((a) => a.label.trim().toLowerCase() === 'billing') ??
    this.addresses.find((a) => a.isDefault) ??
    this.addresses[0] ??
    null
  );
});

clientSchema.virtual('shippingAddress').get(function () {
  if (!this.addresses?.length) return null;
  return (
    this.addresses.find((a) => a.label.trim().toLowerCase() === 'shipping') ??
    this.addresses.find((a) => a.isDefault) ??
    this.addresses[0] ??
    null
  );
});

clientSchema.virtual('primaryBankAccount').get(function () {
  if (!this.bankAccounts?.length) return null;
  return this.bankAccounts.find((b) => b.isPrimary) ?? this.bankAccounts[0] ?? null;
});

clientSchema.virtual('availableCredit').get(function () {
  const limit = this.creditLimit || 0;
  const used  = Math.max(0, this.currentBalance || 0);
  return Math.max(0, +(limit - used).toFixed(2));
});

clientSchema.virtual('isOverCreditLimit').get(function () {
  if (!this.creditLimit) return false;
  return (this.currentBalance || 0) > this.creditLimit;
});

/** true when paymentTerms === 'due_on_receipt' */
clientSchema.virtual('isDueOnReceipt').get(function () {
  return this.paymentTerms === DUE_ON_RECEIPT;
});

/** Numeric days for date math. 'due_on_receipt' → 0. */
clientSchema.virtual('paymentTermsDays').get(function () {
  if (this.paymentTerms === DUE_ON_RECEIPT) return 0;
  const n = Number(this.paymentTerms);
  return Number.isFinite(n) ? n : 0;
});

// ─── Auto-generate clientId ───────────────────────────────────────────────
clientSchema.pre('validate', async function () {
  if (this.isNew && !this.clientId) {
    const seq = await Counter.next('clientId');
    this.clientId = `CLI-${String(seq).padStart(5, '0')}`;
  }
});

// ─── Keep isActive in sync with status ────────────────────────────────────
clientSchema.pre('save', function () {
  if (this.isModified('status') || this.isNew) {
    this.isActive = this.status === 'active';
    if (!this.isNew) this.statusChangedAt = new Date();
  }
  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
});

// ─── Statics ──────────────────────────────────────────────────────────────
clientSchema.statics.findByUser = function (userId: Types.ObjectId | string) {
  return this.findOne({ user: userId, isDeleted: false });
};

clientSchema.statics.findActive = function (filter: Record<string, any> = {}) {
  return this.find({ ...filter, status: 'active', isDeleted: false });
};

// ─── Model export ─────────────────────────────────────────────────────────
const Client =
  (mongoose.models.Client as IClientModel) ||
  mongoose.model<IClient, IClientModel>('Client', clientSchema);

export default Client;