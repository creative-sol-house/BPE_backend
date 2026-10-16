// model/accounting.ts
// ═══════════════════════════════════════════════════════════════════════════
// COMPLETE ACCOUNTING SYSTEM
// Includes: COA, GL, VL, CB, BB, JE, AP, AR, Invoices, Payments,
//           Bank Accounts, Bank Transactions, Fiscal Periods
// All methods are dynamic — no hardcoded business logic.
// ═══════════════════════════════════════════════════════════════════════════
// DEV-ONLY: force re-registration of all accounting models on hot-reload


import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Counter from './counter';
import ProviderExpense from './ProviderExpense';

if (process.env.NODE_ENV !== 'production') {
  const modelsToDrop = [
    'Account',
    'BankAccount',
    'FiscalPeriod',
    'JournalEntry',
    'Invoice',
    'Payment',
    'BankTransaction',
    'BankReconciliation',
    'LedgerEntry',
    'BookEntry',
    'AccountBalance',
  ];
  for (const name of modelsToDrop) {
    if (mongoose.models[name]) {
      try {
        mongoose.deleteModel(name);
      } catch (e) {
        // ignore — some models may not support deleteModel
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function toDecimal(n: number): number {
  return round2(Number(n) || 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// ENUMS & TYPES
// ═══════════════════════════════════════════════════════════════════════════

export type AccountType =
  | 'asset'
  | 'liability'
  | 'equity'
  | 'revenue'
  | 'expense';

export type AccountSubType =
  | 'current_asset' | 'fixed_asset' | 'cash' | 'bank'
  | 'accounts_receivable' | 'inventory' | 'prepaid_expense'
  | 'current_liability' | 'long_term_liability' | 'accounts_payable'
  | 'accrued_liability' | 'tax_payable' | 'loan_payable'
  | 'capital' | 'retained_earnings' | 'drawings'
  | 'operating_revenue' | 'other_income'
  | 'operating_expense' | 'cost_of_goods_sold'
  | 'payroll_expense' | 'other_expense';

export type NormalBalance = 'debit' | 'credit';

export type JournalEntryStatus = 'draft' | 'posted' | 'reversed';

export type JournalEntrySource =
  | 'manual' | 'proposal' | 'invoice' | 'payment'
  | 'provider_expense' | 'loan' | 'payroll' | 'depreciation'
  | 'opening_balance' | 'adjustment' | 'closing' | 'other';

export type ReferenceType =
  | 'Proposal' | 'Client' | 'Provider' | 'ProviderExpense'
  | 'Loan' | 'Employee' | 'Invoice' | 'Payment' | 'Payroll'
  | 'BankTransaction' | 'Manual';

export type InvoiceStatus =
  | 'draft' | 'sent' | 'viewed' | 'partial'
  | 'paid' | 'overdue' | 'cancelled' | 'written_off';

export type PaymentStatus =
  | 'pending' | 'cleared' | 'bounced' | 'cancelled' | 'reversed';

export type PaymentMethod =
  | 'cash' | 'bank_transfer' | 'cheque' | 'card'
  | 'online' | 'adjustment' | 'other';

export type PaymentDirection = 'inbound' | 'outbound';

export type BankAccountType =
  | 'checking' | 'savings' | 'current' | 'credit_card' | 'other';

export type BankTransactionType =
  | 'deposit' | 'withdrawal' | 'transfer_in' | 'transfer_out'
  | 'fee' | 'interest' | 'adjustment';

export type BankTransactionStatus =
  | 'unreconciled' | 'reconciled' | 'void';

export type FiscalPeriodStatus = 'open' | 'closed' | 'locked';

export type AgingBucket =
  | 'current' | '1_30' | '31_60' | '61_90' | '91_120' | 'over_120';

export type CBBookType = 'cash_book' | 'bank_book';

export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
export const ACCOUNT_SUBTYPES: AccountSubType[] = [
  'current_asset', 'fixed_asset', 'cash', 'bank',
  'accounts_receivable', 'inventory', 'prepaid_expense',
  'current_liability', 'long_term_liability', 'accounts_payable',
  'accrued_liability', 'tax_payable', 'loan_payable',
  'capital', 'retained_earnings', 'drawings',
  'operating_revenue', 'other_income',
  'operating_expense', 'cost_of_goods_sold',
  'payroll_expense', 'other_expense',
];
export const NORMAL_BALANCES: NormalBalance[] = ['debit', 'credit'];
export const JOURNAL_ENTRY_STATUSES: JournalEntryStatus[] = ['draft', 'posted', 'reversed'];
export const JOURNAL_ENTRY_SOURCES: JournalEntrySource[] = [
  'manual', 'proposal', 'invoice', 'payment', 'provider_expense',
  'loan', 'payroll', 'depreciation', 'opening_balance',
  'adjustment', 'closing', 'other',
];
export const INVOICE_STATUSES: InvoiceStatus[] = [
  'draft', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'cancelled', 'written_off',
];
export const PAYMENT_STATUSES: PaymentStatus[] = [
  'pending', 'cleared', 'bounced', 'cancelled', 'reversed',
];
export const PAYMENT_METHODS: PaymentMethod[] = [
  'cash', 'bank_transfer', 'cheque', 'card', 'online', 'adjustment', 'other',
];
export const PAYMENT_DIRECTIONS: PaymentDirection[] = ['inbound', 'outbound'];
export const BANK_ACCOUNT_TYPES: BankAccountType[] = [
  'checking', 'savings', 'current', 'credit_card', 'other',
];
export const BANK_TRANSACTION_TYPES: BankTransactionType[] = [
  'deposit', 'withdrawal', 'transfer_in', 'transfer_out', 'fee', 'interest', 'adjustment',
];
export const BANK_TRANSACTION_STATUSES: BankTransactionStatus[] = [
  'unreconciled', 'reconciled', 'void',
];
export const FISCAL_PERIOD_STATUSES: FiscalPeriodStatus[] = ['open', 'closed', 'locked'];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  cheque: 'Cheque',
  card: 'Card',
  online: 'Online',
  adjustment: 'Adjustment',
  other: 'Other',
};

// ═══════════════════════════════════════════════════════════════════════════
// DYNAMIC CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

export interface IAccountingConfig {
  defaultCurrency: string;
  fiscalYearStartMonth: number;
  defaultPaymentTermsDays: number;
  defaultTaxRate: number;
  defaultTaxLabel: string;
  enableAutoPosting: boolean;
  requireBalancedEntries: boolean;
  allowBackdatedEntries: boolean;
  backdateDaysLimit: number;
  invoiceNumberPrefix: string;
  paymentNumberPrefix: string;
  journalNumberPrefix: string;
  bankTransactionPrefix: string;
  bankAccountPrefix: string;
  invoicePrefix: string;
}

export const DEFAULT_ACCOUNTING_CONFIG: IAccountingConfig = {
  defaultCurrency: 'PKR',
  fiscalYearStartMonth: 1,
  defaultPaymentTermsDays: 30,
  defaultTaxRate: 0,
  defaultTaxLabel: 'Tax',
  enableAutoPosting: false,
  requireBalancedEntries: true,
  allowBackdatedEntries: false,
  backdateDaysLimit: 0,
  invoiceNumberPrefix: 'INV',
  paymentNumberPrefix: 'PAY',
  journalNumberPrefix: 'JE',
  bankTransactionPrefix: 'BTX',
  bankAccountPrefix: 'BA',
  invoicePrefix: 'INV',
};

let _runtimeConfig: IAccountingConfig = { ...DEFAULT_ACCOUNTING_CONFIG };

export function setAccountingConfig(partial: Partial<IAccountingConfig>): void {
  _runtimeConfig = { ..._runtimeConfig, ...partial };
}

export function getAccountingConfig(): IAccountingConfig {
  return { ..._runtimeConfig };
}

// ═══════════════════════════════════════════════════════════════════════════
// POSTING RULES (dynamic)
// ═══════════════════════════════════════════════════════════════════════════

export interface IPostingRule {
  source: JournalEntrySource;
  event: string;
  debitAccount: string;
  creditAccount: string;
  descriptionTemplate?: string;
}

let _postingRules: IPostingRule[] = [];

export function registerPostingRule(rule: IPostingRule): void {
  _postingRules = _postingRules.filter(
    (r) => !(r.source === rule.source && r.event === rule.event)
  );
  _postingRules.push(rule);
}

export function registerPostingRules(rules: IPostingRule[]): void {
  for (const r of rules) registerPostingRule(r);
}

export function getPostingRule(source: JournalEntrySource, event: string): IPostingRule | undefined {
  return _postingRules.find((r) => r.source === source && r.event === event);
}

export function getPostingRules(): IPostingRule[] {
  return [..._postingRules];
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. ACCOUNT (COA)
// ═══════════════════════════════════════════════════════════════════════════

export interface IAccount extends Document {
  _id: Types.ObjectId;
  accountId: string;
  name: string;
  description?: string;

  type: AccountType;
  subType: AccountSubType;
  normalBalance: NormalBalance;

  parentAccountId?: Types.ObjectId | null;
  parentAccountCode?: string | null;
  level: number;
  isGroup: boolean;

  openingBalance: number;
  currentBalance: number;
  currency: string;

  isBankAccount: boolean;
  isCashAccount: boolean;
  isReceivable: boolean;
  isPayable: boolean;
  isTaxAccount: boolean;
  isControlAccount: boolean;

  linkedBankAccountId?: Types.ObjectId | null;
  linkedClientId?: Types.ObjectId | null;
  linkedProviderId?: Types.ObjectId | null;

  isActive: boolean;
  isLocked: boolean;
  isDeleted: boolean;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;

  fullPath: string;
  isDebitAccount: boolean;
  isCreditAccount: boolean;
}

export interface IAccountModel extends Model<IAccount> {
  findByCode(code: string): Promise<IAccount | null>;
  findByType(type: AccountType): Promise<IAccount[]>;
  findActive(): Promise<IAccount[]>;
  getTree(): Promise<IAccount[]>;
  seedDefaults(seed: Array<Partial<IAccount>>): Promise<number>;
}

const accountSchema = new Schema<IAccount, IAccountModel>(
  {
    accountId: { type: String, required: true, unique: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 500 },

    type: { type: String, enum: ACCOUNT_TYPES, required: true, index: true },
    subType: { type: String, enum: ACCOUNT_SUBTYPES, required: true, index: true },
    normalBalance: { type: String, enum: NORMAL_BALANCES, required: true },

    parentAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null, index: true },
    parentAccountCode: { type: String, trim: true, default: null },
    level: { type: Number, default: 1, min: 1, max: 10 },
    isGroup: { type: Boolean, default: false },

    openingBalance: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'PKR' },

    isBankAccount: { type: Boolean, default: false, index: true },
    isCashAccount: { type: Boolean, default: false, index: true },
    isReceivable: { type: Boolean, default: false, index: true },
    isPayable: { type: Boolean, default: false, index: true },
    isTaxAccount: { type: Boolean, default: false, index: true },
    isControlAccount: { type: Boolean, default: false },

    linkedBankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', default: null },
    linkedClientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    linkedProviderId: { type: Schema.Types.ObjectId, ref: 'Provider', default: null },

    isActive: { type: Boolean, default: true, index: true },
    isLocked: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

accountSchema.index({ type: 1, subType: 1, isDeleted: 1 });
accountSchema.index({ parentAccountId: 1, isDeleted: 1 });
accountSchema.index({ name: 'text', accountId: 'text' });

accountSchema.virtual('fullPath').get(function (this: IAccount) {
  return this.parentAccountCode
    ? `${this.parentAccountCode} > ${this.accountId}`
    : this.accountId;
});
accountSchema.virtual('isDebitAccount').get(function (this: IAccount) {
  return this.normalBalance === 'debit';
});
accountSchema.virtual('isCreditAccount').get(function (this: IAccount) {
  return this.normalBalance === 'credit';
});

accountSchema.statics.findByCode = function (code: string) {
  return this.findOne({ accountId: code, isDeleted: false });
};
accountSchema.statics.findByType = function (type: AccountType) {
  return this.find({ type, isDeleted: false }).sort({ accountId: 1 });
};
accountSchema.statics.findActive = function () {
  return this.find({ isActive: true, isDeleted: false }).sort({ accountId: 1 });
};
accountSchema.statics.getTree = function () {
  return this.find({ isDeleted: false }).sort({ accountId: 1 });
};
accountSchema.statics.seedDefaults = async function (
  seed: Array<Partial<IAccount>>
): Promise<number> {
  if (!Array.isArray(seed) || seed.length === 0) return 0;
  const ops = seed.map((acc) => ({
    updateOne: {
      filter: { accountId: acc.accountId },
      update: { $setOnInsert: acc },
      upsert: true,
    },
  }));
  const res = await this.bulkWrite(ops);
  return res.upsertedCount ?? 0;
};

export const Account =
  (mongoose.models.Account as IAccountModel) ||
  mongoose.model<IAccount, IAccountModel>('Account', accountSchema);

// ═══════════════════════════════════════════════════════════════════════════
// 2. BANK ACCOUNT
// ═══════════════════════════════════════════════════════════════════════════

export interface IBankAccount extends Document {
  _id: Types.ObjectId;
  accountId: string;

  accountName: string;
  accountNumber: string;
  accountType: BankAccountType;
  bankName: string;
  branchName?: string;
  branchCode?: string;
  iban?: string;
  swiftCode?: string;
  routingNumber?: string;

  currency: string;
  openingBalance: number;
  currentBalance: number;
  availableBalance: number;

  glAccountId: Types.ObjectId;

  isActive: boolean;
  isDefault: boolean;
  isDeleted: boolean;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBankAccountModel extends Model<IBankAccount> {
  findActive(): Promise<IBankAccount[]>;
}

const bankAccountSchema = new Schema<IBankAccount, IBankAccountModel>(
  {
    accountId: { type: String, required: true, unique: true, trim: true, index: true },
    accountName: { type: String, required: true, trim: true, maxlength: 200 },
    accountNumber: { type: String, required: true, trim: true, maxlength: 60, index: true },
    accountType: { type: String, enum: BANK_ACCOUNT_TYPES, default: 'current' },
    bankName: { type: String, required: true, trim: true, maxlength: 200 },
    branchName: { type: String, trim: true, maxlength: 200 },
    branchCode: { type: String, trim: true, maxlength: 40 },
    iban: { type: String, trim: true, uppercase: true, maxlength: 34 },
    swiftCode: { type: String, trim: true, uppercase: true, maxlength: 20 },
    routingNumber: { type: String, trim: true, maxlength: 40 },

    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'PKR' },
    openingBalance: { type: Number, default: 0 },
    currentBalance: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },

    glAccountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },

    isActive: { type: Boolean, default: true, index: true },
    isDefault: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

bankAccountSchema.index({ bankName: 1, accountNumber: 1 }, { unique: true });

bankAccountSchema.pre('validate', async function () {
  if (this.isNew && !this.accountId) {
    const cfg = getAccountingConfig();
    const seq = await Counter.next('bankAccountId');
    this.accountId = `${cfg.bankAccountPrefix}-${String(seq).padStart(5, '0')}`;
  }
});

bankAccountSchema.statics.findActive = function () {
  return this.find({ isActive: true, isDeleted: false }).sort({ isDefault: -1, bankName: 1 });
};

export const BankAccount =
  (mongoose.models.BankAccount as IBankAccountModel) ||
  mongoose.model<IBankAccount, IBankAccountModel>('BankAccount', bankAccountSchema);

// ═══════════════════════════════════════════════════════════════════════════
// 3. FISCAL PERIOD
// ═══════════════════════════════════════════════════════════════════════════

export interface IFiscalPeriod extends Document {
  _id: Types.ObjectId;
  fiscalYear: number;
  period: number;
  periodName: string;
  startDate: Date;
  endDate: Date;

  status: FiscalPeriodStatus;
  closedAt?: Date;
  closedBy?: Types.ObjectId | null;
  lockedAt?: Date;
  lockedBy?: Types.ObjectId | null;
  notes?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface IFiscalPeriodModel extends Model<IFiscalPeriod> {
  findOpen(): Promise<IFiscalPeriod[]>;
  findByDate(date: Date): Promise<IFiscalPeriod | null>;
  generateYear(fiscalYear: number): Promise<IFiscalPeriod[]>;
}

const fiscalPeriodSchema = new Schema<IFiscalPeriod, IFiscalPeriodModel>(
  {
    fiscalYear: { type: Number, required: true, index: true },
    period: { type: Number, required: true, min: 1, max: 12, index: true },
    periodName: { type: String, required: true, trim: true, maxlength: 40 },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    status: { type: String, enum: FISCAL_PERIOD_STATUSES, default: 'open', index: true },
    closedAt: { type: Date },
    closedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lockedAt: { type: Date },
    lockedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } }
);

fiscalPeriodSchema.index({ fiscalYear: 1, period: 1 }, { unique: true });

fiscalPeriodSchema.statics.findOpen = function () {
  return this.find({ status: 'open' }).sort({ fiscalYear: -1, period: -1 });
};
fiscalPeriodSchema.statics.findByDate = function (date: Date) {
  return this.findOne({ startDate: { $lte: date }, endDate: { $gte: date } });
};

fiscalPeriodSchema.statics.generateYear = async function (
  fiscalYear: number
): Promise<IFiscalPeriod[]> {
  const cfg = getAccountingConfig();
  const startMonth = cfg.fiscalYearStartMonth;
  const monthNames = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  const created: IFiscalPeriod[] = [];
  for (let i = 0; i < 12; i++) {
    const monthIdx = (startMonth - 1 + i) % 12;
    const yearOffset = Math.floor((startMonth - 1 + i) / 12);
    const year = fiscalYear + yearOffset;

    const start = new Date(Date.UTC(year, monthIdx, 1, 0, 0, 0));
    const end = new Date(Date.UTC(year, monthIdx + 1, 0, 23, 59, 59));

    const doc = await this.findOneAndUpdate(
      { fiscalYear, period: i + 1 },
      {
        $setOnInsert: {
          fiscalYear,
          period: i + 1,
          periodName: `${monthNames[monthIdx]} ${year}`,
          startDate: start,
          endDate: end,
          status: 'open',
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (doc) created.push(doc);
  }
  return created;
};

export const FiscalPeriod =
  (mongoose.models.FiscalPeriod as IFiscalPeriodModel) ||
  mongoose.model<IFiscalPeriod, IFiscalPeriodModel>('FiscalPeriod', fiscalPeriodSchema);

// ═══════════════════════════════════════════════════════════════════════════
// 4. JOURNAL ENTRY (JE)
// ═══════════════════════════════════════════════════════════════════════════

export interface IJournalLine {
  _id?: Types.ObjectId;
  accountId: Types.ObjectId;
  accountCode: string;
  accountName: string;
  description?: string;

  debit: number;
  credit: number;

  clientId?: Types.ObjectId | null;
  providerId?: Types.ObjectId | null;
  employeeId?: Types.ObjectId | null;
  invoiceId?: Types.ObjectId | null;
  paymentId?: Types.ObjectId | null;

  taxType?: string;
  taxRate?: number;

  costCenter?: string;
  projectId?: Types.ObjectId | null;
  department?: string;

  sequence: number;
  notes?: string;
}

export interface IJournalEntry extends Document {
  _id: Types.ObjectId;
  entryId: string;

  entryDate: Date;
  postingDate?: Date;
  reference?: string;
  description: string;

  lines: IJournalLine[];

  totalDebit: number;
  totalCredit: number;
  difference: number;

  status: JournalEntryStatus;
  source: JournalEntrySource;

  referenceType?: ReferenceType;
  referenceId?: Types.ObjectId | null;
  referenceModel?: string;

  reversedBy?: Types.ObjectId | null;
  reversalOf?: Types.ObjectId | null;
  reversalReason?: string;

  attachments?: { name: string; url: string }[];

  postedBy?: Types.ObjectId | null;
  postedAt?: Date;
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;

  currency: string;
  exchangeRate: number;

  fiscalYear: number;
  fiscalPeriod: number;

  isLocked: boolean;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  isBalanced: boolean;
  lineCount: number;
}

export interface IJournalEntryModel extends Model<IJournalEntry> {
  findPosted(filter?: Record<string, any>): Promise<IJournalEntry[]>;
  findByReference(refType: string, refId: Types.ObjectId | string): Promise<IJournalEntry[]>;
  findByDateRange(from: Date, to: Date): Promise<IJournalEntry[]>;
  findByAccount(accountId: Types.ObjectId | string): Promise<IJournalEntry[]>;
}

const journalLineSchema = new Schema<IJournalLine>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    accountCode: { type: String, required: true, trim: true, index: true },
    accountName: { type: String, required: true, trim: true },
    description: { type: String, trim: true, maxlength: 500 },

    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },

    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'Provider', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },

    taxType: { type: String, trim: true },
    taxRate: { type: Number, min: 0 },

    costCenter: { type: String, trim: true, maxlength: 80 },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },
    department: { type: String, trim: true, maxlength: 80 },

    sequence: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

const journalEntrySchema = new Schema<IJournalEntry, IJournalEntryModel>(
  {
    entryId: { type: String, required: true, unique: true, trim: true, index: true },
    entryDate: { type: Date, required: true, index: true },
    postingDate: { type: Date, index: true },
    reference: { type: String, trim: true, maxlength: 100 },
    description: { type: String, required: true, trim: true, maxlength: 1000 },

    lines: {
      type: [journalLineSchema],
      default: [],
      validate: {
        validator: (lines: IJournalLine[]) => lines.length >= 2,
        message: 'A journal entry must have at least 2 lines',
      },
    },

    totalDebit: { type: Number, default: 0, min: 0 },
    totalCredit: { type: Number, default: 0, min: 0 },
    difference: { type: Number, default: 0 },

    status: { type: String, enum: JOURNAL_ENTRY_STATUSES, default: 'draft', index: true },
    source: { type: String, enum: JOURNAL_ENTRY_SOURCES, default: 'manual', index: true },

    referenceType: {
      type: String,
      enum: ['Proposal', 'Client', 'Provider', 'ProviderExpense', 'Loan', 'Employee', 'Invoice', 'Payment', 'Payroll', 'BankTransaction', 'Manual'],
      default: 'Manual',
    },
    referenceId: { type: Schema.Types.ObjectId, default: null, index: true },
    referenceModel: { type: String, trim: true },

    reversedBy: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    reversalReason: { type: String, trim: true, maxlength: 500 },

    attachments: {
      type: [new Schema({ name: String, url: String }, { _id: false })],
      default: [],
    },

    postedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    postedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'PKR' },
    exchangeRate: { type: Number, default: 1, min: 0 },

    fiscalYear: { type: Number, required: true, index: true },
    fiscalPeriod: { type: Number, required: true, min: 1, max: 12, index: true },

    isLocked: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

journalEntrySchema.index({ entryDate: -1, status: 1 });
journalEntrySchema.index({ referenceType: 1, referenceId: 1 });
journalEntrySchema.index({ fiscalYear: 1, fiscalPeriod: 1, status: 1 });
journalEntrySchema.index({ description: 'text', reference: 'text' });

journalEntrySchema.virtual('isBalanced').get(function (this: IJournalEntry) {
  return Math.abs(this.totalDebit - this.totalCredit) < 0.01;
});
journalEntrySchema.virtual('lineCount').get(function (this: IJournalEntry) {
  return this.lines?.length ?? 0;
});

// ── Hook 1: Assign entryId + sequence (runs BEFORE validators) ──
journalEntrySchema.pre('validate', async function () {
  // Assign entryId
  if (this.isNew && !this.entryId) {
    const cfg = getAccountingConfig();
    const seq = await Counter.next('journalEntryId');
    this.entryId = `${cfg.journalNumberPrefix}-${String(seq).padStart(6, '0')}`;
  }

  // Assign line sequences — MUST happen before `required: true` validators run
  if (Array.isArray(this.lines)) {
    this.lines.forEach((line: any, idx: number) => {
      if (!line.sequence || line.sequence < 1) {
        line.sequence = idx + 1;
      }
    });
  }
});

// ── Hook 2: Compute totals + business rules (runs AFTER validation) ──
journalEntrySchema.pre('save', function () {
  const cfg = getAccountingConfig();

  let totalDebit = 0;
  let totalCredit = 0;

  this.lines.forEach((line, idx) => {
    line.sequence = idx + 1; // final safety net
    totalDebit += line.debit || 0;
    totalCredit += line.credit || 0;
  });

  this.totalDebit = round2(totalDebit);
  this.totalCredit = round2(totalCredit);
  this.difference = round2(Math.abs(this.totalDebit - this.totalCredit));

  if (cfg.requireBalancedEntries && this.status === 'posted' && this.difference > 0.01) {
    throw new Error(
      `Journal entry is not balanced: Debit=${this.totalDebit}, Credit=${this.totalCredit}, Diff=${this.difference}`
    );
  }

  for (const line of this.lines) {
    if (line.debit > 0 && line.credit > 0) {
      throw new Error(`Line ${line.sequence}: cannot have both debit and credit`);
    }
  }

  if (this.status === 'posted' && !this.postingDate) {
    this.postingDate = new Date();
  }

  if (this.isModified('entryDate') || this.isNew) {
    const d = new Date(this.entryDate);
    this.fiscalYear = d.getFullYear();
    this.fiscalPeriod = d.getMonth() + 1;
  }

  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
});

journalEntrySchema.statics.findPosted = function (filter: Record<string, any> = {}) {
  return this.find({ ...filter, status: 'posted', isDeleted: false }).sort({ entryDate: -1 });
};
journalEntrySchema.statics.findByReference = function (
  refType: ReferenceType,
  refId: Types.ObjectId | string
) {
  return this.find({
    referenceType: refType,
    referenceId: refId,
    isDeleted: false,
  }).sort({ entryDate: -1 });
};
journalEntrySchema.statics.findByDateRange = function (from: Date, to: Date) {
  return this.find({
    entryDate: { $gte: from, $lte: to },
    status: 'posted',
    isDeleted: false,
  }).sort({ entryDate: 1 });
};
journalEntrySchema.statics.findByAccount = function (accountId: Types.ObjectId | string) {
  return this.find({
    'lines.accountId': accountId,
    status: 'posted',
    isDeleted: false,
  }).sort({ entryDate: -1 });
};

export const JournalEntry =
  (mongoose.models.JournalEntry as IJournalEntryModel) ||
  mongoose.model<IJournalEntry, IJournalEntryModel>('JournalEntry', journalEntrySchema);

// ═══════════════════════════════════════════════════════════════════════════
// 5. INVOICE (AR)
// ═══════════════════════════════════════════════════════════════════════════

export interface IInvoiceLine {
  _id?: Types.ObjectId;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;

  taxRate: number;
  taxAmount: number;

  accountId?: Types.ObjectId | null;
  accountCode?: string;
  projectId?: Types.ObjectId | null;

  sequence: number;
}

export interface IInvoice extends Document {
  _id: Types.ObjectId;
  invoiceId: string;
  invoiceNumber: string;

  clientId: Types.ObjectId;
  proposalId?: Types.ObjectId | null;
  projectId?: Types.ObjectId | null;

  issueDate: Date;
  dueDate: Date;

  lines: IInvoiceLine[];

  subTotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  balanceDue: number;

  currency: string;
  exchangeRate: number;

  status: InvoiceStatus;
  paidAt?: Date;

  journalEntryId?: Types.ObjectId | null;

  notes?: string;
  terms?: string;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  isFullyPaid: boolean;
  isOverdue: boolean;
  daysOverdue: number;
  agingBucket: AgingBucket;
  lineCount: number;
}

export interface IInvoiceModel extends Model<IInvoice> {
  findUnpaid(): Promise<IInvoice[]>;
  findOverdue(): Promise<IInvoice[]>;
  findByClient(clientId: Types.ObjectId | string): Promise<IInvoice[]>;
  nextInvoiceNumber(): Promise<string>;
}

const invoiceLineSchema = new Schema<IInvoiceLine>(
  {
    description: { type: String, required: true, trim: true, maxlength: 500 },
    quantity: { type: Number, required: true, min: 0, default: 1 },
    unitPrice: { type: Number, required: true, min: 0, default: 0 },
    amount: { type: Number, required: true, min: 0, default: 0 },

    taxRate: { type: Number, min: 0, max: 100, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },

    accountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    accountCode: { type: String, trim: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },

    sequence: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const invoiceSchema = new Schema<IInvoice, IInvoiceModel>(
  {
    invoiceId: { type: String, required: true, unique: true, trim: true, index: true },
    invoiceNumber: { type: String, required: true, trim: true, unique: true, index: true },

    clientId: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    proposalId: { type: Schema.Types.ObjectId, ref: 'Proposal', default: null, index: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null, index: true },

    issueDate: { type: Date, required: true, default: () => new Date() },
    dueDate: { type: Date, required: true, index: true },

    lines: { type: [invoiceLineSchema], default: [] },

    subTotal: { type: Number, required: true, min: 0, default: 0 },
    discountAmount: { type: Number, min: 0, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0, default: 0 },
    paidAmount: { type: Number, min: 0, default: 0 },
    balanceDue: { type: Number, required: true, min: 0, default: 0 },

    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'PKR' },
    exchangeRate: { type: Number, default: 1, min: 0 },

    status: { type: String, enum: INVOICE_STATUSES, default: 'draft', index: true },
    paidAt: { type: Date },

    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },

    notes: { type: String, trim: true, maxlength: 2000 },
    terms: { type: String, trim: true, maxlength: 2000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

invoiceSchema.index({ clientId: 1, status: 1 });
invoiceSchema.index({ dueDate: 1, status: 1 });
invoiceSchema.index({ issueDate: -1 });

invoiceSchema.virtual('isFullyPaid').get(function (this: IInvoice) {
  return this.balanceDue <= 0.01;
});
invoiceSchema.virtual('isOverdue').get(function (this: IInvoice) {
  if (this.status === 'paid' || this.status === 'cancelled' || this.status === 'written_off') return false;
  return this.dueDate.getTime() < Date.now() && this.balanceDue > 0.01;
});
invoiceSchema.virtual('daysOverdue').get(function (this: IInvoice) {
  if (!this.isOverdue) return 0;
  return Math.floor((Date.now() - this.dueDate.getTime()) / 86_400_000);
});
invoiceSchema.virtual('agingBucket').get(function (this: IInvoice): AgingBucket {
  if (!this.isOverdue) return 'current';
  const days = this.daysOverdue;
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  if (days <= 120) return '91_120';
  return 'over_120';
});
invoiceSchema.virtual('lineCount').get(function (this: IInvoice) {
  return this.lines?.length ?? 0;
});

// ── Hook 1: Assign invoiceId + sequence (runs BEFORE validators) ──
invoiceSchema.pre('validate', async function () {
  if (this.isNew && !this.invoiceId) {
    const seq = await Counter.next('invoiceId');
    this.invoiceId = `INV-${String(seq).padStart(6, '0')}`;
  }

  // Assign line sequences BEFORE validators
  if (Array.isArray(this.lines)) {
    this.lines.forEach((line: any, idx: number) => {
      if (!line.sequence || line.sequence < 1) {
        line.sequence = idx + 1;
      }
    });
  }
});

// ── Hook 2: Compute totals ──
invoiceSchema.pre('save', function () {
  let subTotal = 0;
  let taxAmount = 0;

  this.lines.forEach((line, idx) => {
    line.sequence = idx + 1;
    line.amount = round2((line.quantity || 0) * (line.unitPrice || 0));
    line.taxAmount = round2(line.amount * ((line.taxRate || 0) / 100));
    subTotal += line.amount;
    taxAmount += line.taxAmount;
  });

  this.subTotal = round2(subTotal);
  this.taxAmount = round2(taxAmount);
  this.totalAmount = round2(this.subTotal - (this.discountAmount || 0) + this.taxAmount);
  this.balanceDue = round2(this.totalAmount - (this.paidAmount || 0));

  if (this.balanceDue <= 0.01 && this.status !== 'cancelled' && this.status !== 'written_off') {
    this.status = 'paid';
    if (!this.paidAt) this.paidAt = new Date();
  } else if (this.paidAmount > 0 && this.balanceDue > 0.01) {
    this.status = 'partial';
  } else if (this.isOverdue) {
    this.status = 'overdue';
  }

  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
});

invoiceSchema.statics.findUnpaid = function () {
  return this.find({
    status: { $in: ['sent', 'viewed', 'partial', 'overdue'] },
    balanceDue: { $gt: 0 },
    isDeleted: false,
  }).sort({ dueDate: 1 });
};
invoiceSchema.statics.findOverdue = function () {
  return this.find({
    status: { $in: ['sent', 'viewed', 'partial', 'overdue'] },
    dueDate: { $lt: new Date() },
    balanceDue: { $gt: 0 },
    isDeleted: false,
  }).sort({ dueDate: 1 });
};
invoiceSchema.statics.findByClient = function (clientId: Types.ObjectId | string) {
  return this.find({ clientId, isDeleted: false }).sort({ issueDate: -1 });
};
invoiceSchema.statics.nextInvoiceNumber = async function () {
  const cfg = getAccountingConfig();
  const seq = await Counter.next('invoiceNumber');
  return `${cfg.invoiceNumberPrefix}-${new Date().getFullYear()}-${String(seq).padStart(5, '0')}`;
};

export const Invoice =
  (mongoose.models.Invoice as IInvoiceModel) ||
  mongoose.model<IInvoice, IInvoiceModel>('Invoice', invoiceSchema);

// ═══════════════════════════════════════════════════════════════════════════
// 6. PAYMENT
// ═══════════════════════════════════════════════════════════════════════════

export interface IPaymentAllocation {
  _id?: Types.ObjectId;
  invoiceId?: Types.ObjectId | null;
  providerExpenseId?: Types.ObjectId | null;
  amount: number;
  allocatedAt: Date;
  notes?: string;
}

export interface IPayment extends Document {
  _id: Types.ObjectId;
  paymentId: string;
  paymentNumber: string;

  direction: PaymentDirection;
  method: PaymentMethod;

  clientId?: Types.ObjectId | null;
  providerId?: Types.ObjectId | null;

  amount: number;
  currency: string;
  exchangeRate: number;

  paymentDate: Date;
  valueDate?: Date;

  bankAccountId?: Types.ObjectId | null;
  cashAccountId?: Types.ObjectId | null;

  reference?: string;
  chequeNumber?: string;
  transactionId?: string;

  allocations: IPaymentAllocation[];
  allocatedAmount: number;
  unallocatedAmount: number;

  status: PaymentStatus;

  journalEntryId?: Types.ObjectId | null;

  notes?: string;

  reversedBy?: Types.ObjectId | null;
  reversalOf?: Types.ObjectId | null;
  reversalReason?: string;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPaymentModel extends Model<IPayment> {
  findByClient(clientId: Types.ObjectId | string): Promise<IPayment[]>;
  findByProvider(providerId: Types.ObjectId | string): Promise<IPayment[]>;
  findUnallocated(): Promise<IPayment[]>;
}

const paymentAllocationSchema = new Schema<IPaymentAllocation>(
  {
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    providerExpenseId: { type: Schema.Types.ObjectId, ref: 'ProviderExpense', default: null, index: true },
    amount: { type: Number, required: true, min: 0 },
    allocatedAt: { type: Date, default: () => new Date() },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

const paymentSchema = new Schema<IPayment, IPaymentModel>(
  {
    paymentId: { type: String, required: true, unique: true, trim: true, index: true },
    paymentNumber: { type: String, required: true, unique: true, trim: true, index: true },

    direction: { type: String, enum: PAYMENT_DIRECTIONS, required: true, index: true },
    method: { type: String, enum: PAYMENT_METHODS, required: true },

    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'Provider', default: null, index: true },

    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'PKR' },
    exchangeRate: { type: Number, default: 1, min: 0 },

    paymentDate: { type: Date, required: true, default: () => new Date(), index: true },
    valueDate: { type: Date },

    bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', default: null },
    cashAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },

    reference: { type: String, trim: true, maxlength: 100 },
    chequeNumber: { type: String, trim: true, maxlength: 60 },
    transactionId: { type: String, trim: true, maxlength: 100 },

    allocations: { type: [paymentAllocationSchema], default: [] },
    allocatedAmount: { type: Number, default: 0, min: 0 },
    unallocatedAmount: { type: Number, default: 0, min: 0 },

    status: { type: String, enum: PAYMENT_STATUSES, default: 'cleared', index: true },

    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },

    notes: { type: String, trim: true, maxlength: 2000 },

    reversedBy: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    reversalOf: { type: Schema.Types.ObjectId, ref: 'Payment', default: null },
    reversalReason: { type: String, trim: true, maxlength: 500 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

paymentSchema.index({ clientId: 1, paymentDate: -1 });
paymentSchema.index({ providerId: 1, paymentDate: -1 });
paymentSchema.index({ direction: 1, status: 1, paymentDate: -1 });

paymentSchema.pre('validate', async function () {
  if (this.isNew && !this.paymentId) {
    const cfg = getAccountingConfig();
    const seq = await Counter.next('paymentId');
    this.paymentId = `${cfg.paymentNumberPrefix}-${String(seq).padStart(6, '0')}`;
  }
});

paymentSchema.pre('save', function () {
  const allocated = (this.allocations ?? []).reduce(
    (s, a) => s + (a.amount || 0),
    0
  );
  this.allocatedAmount = round2(allocated);
  this.unallocatedAmount = round2(Math.max(0, (this.amount || 0) - this.allocatedAmount));

  if (this.allocatedAmount > this.amount + 0.01) {
    throw new Error('Allocated amount cannot exceed payment amount');
  }

  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
});

paymentSchema.statics.findByClient = function (clientId: Types.ObjectId | string) {
  return this.find({ clientId, direction: 'inbound', isDeleted: false }).sort({ paymentDate: -1 });
};
paymentSchema.statics.findByProvider = function (providerId: Types.ObjectId | string) {
  return this.find({ providerId, direction: 'outbound', isDeleted: false }).sort({ paymentDate: -1 });
};
paymentSchema.statics.findUnallocated = function () {
  return this.find({
    unallocatedAmount: { $gt: 0 },
    status: 'cleared',
    isDeleted: false,
  }).sort({ paymentDate: 1 });
};

export const Payment =
  (mongoose.models.Payment as IPaymentModel) ||
  mongoose.model<IPayment, IPaymentModel>('Payment', paymentSchema);

// ═══════════════════════════════════════════════════════════════════════════
// 7. BANK TRANSACTION
// ═══════════════════════════════════════════════════════════════════════════

export interface IBankTransaction extends Document {
  _id: Types.ObjectId;
  transactionId: string;

  bankAccountId: Types.ObjectId;
  transactionType: BankTransactionType;

  transactionDate: Date;
  valueDate?: Date;

  amount: number;
  signedAmount: number;
  runningBalance: number;

  currency: string;

  description: string;
  reference?: string;
  chequeNumber?: string;

  counterpartyName?: string;
  counterpartyAccount?: string;

  status: BankTransactionStatus;

  glJournalEntryId?: Types.ObjectId | null;
  paymentId?: Types.ObjectId | null;

  reconciliationId?: Types.ObjectId | null;
  reconciledAt?: Date;
  reconciledBy?: Types.ObjectId | null;

  transferPairId?: Types.ObjectId | null;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBankTransactionModel extends Model<IBankTransaction> {
  findByBankAccount(bankAccountId: Types.ObjectId | string): Promise<IBankTransaction[]>;
  findUnreconciled(bankAccountId?: Types.ObjectId | string): Promise<IBankTransaction[]>;
}

const bankTransactionSchema = new Schema<IBankTransaction, IBankTransactionModel>(
  {
    transactionId: { type: String, required: true, unique: true, trim: true, index: true },

    bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true, index: true },
    transactionType: { type: String, enum: BANK_TRANSACTION_TYPES, required: true, index: true },

    transactionDate: { type: Date, required: true, default: () => new Date(), index: true },
    valueDate: { type: Date },

    amount: { type: Number, required: true, min: 0 },
    signedAmount: { type: Number, required: true },
    runningBalance: { type: Number, default: 0 },

    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'PKR' },

    description: { type: String, required: true, trim: true, maxlength: 500 },
    reference: { type: String, trim: true, maxlength: 100 },
    chequeNumber: { type: String, trim: true, maxlength: 60 },

    counterpartyName: { type: String, trim: true, maxlength: 200 },
    counterpartyAccount: { type: String, trim: true, maxlength: 60 },

    status: { type: String, enum: BANK_TRANSACTION_STATUSES, default: 'unreconciled', index: true },

    glJournalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },

    reconciliationId: { type: Schema.Types.ObjectId, ref: 'BankReconciliation', default: null },
    reconciledAt: { type: Date },
    reconciledBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    transferPairId: { type: Schema.Types.ObjectId, ref: 'BankTransaction', default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

bankTransactionSchema.index({ bankAccountId: 1, transactionDate: -1 });
bankTransactionSchema.index({ bankAccountId: 1, status: 1 });

bankTransactionSchema.pre('validate', async function () {
  if (this.isNew && !this.transactionId) {
    const cfg = getAccountingConfig();
    const seq = await Counter.next('bankTransactionId');
    this.transactionId = `${cfg.bankTransactionPrefix}-${String(seq).padStart(6, '0')}`;
  }
});

bankTransactionSchema.pre('save', function () {
  const isCredit = ['deposit', 'transfer_in', 'interest'].includes(this.transactionType);
  this.signedAmount = isCredit ? this.amount : -this.amount;
});

bankTransactionSchema.statics.findByBankAccount = function (bankAccountId: Types.ObjectId | string) {
  return this.find({ bankAccountId, isDeleted: false }).sort({ transactionDate: -1 });
};
bankTransactionSchema.statics.findUnreconciled = function (bankAccountId?: Types.ObjectId | string) {
  const filter: Record<string, any> = { status: 'unreconciled', isDeleted: false };
  if (bankAccountId) filter.bankAccountId = bankAccountId;
  return this.find(filter).sort({ transactionDate: 1 });
};

export const BankTransaction =
  (mongoose.models.BankTransaction as IBankTransactionModel) ||
  mongoose.model<IBankTransaction, IBankTransactionModel>('BankTransaction', bankTransactionSchema);

// ═══════════════════════════════════════════════════════════════════════════
// 8. BANK RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════════

export interface IBankReconciliation extends Document {
  _id: Types.ObjectId;
  reconciliationId: string;

  bankAccountId: Types.ObjectId;
  statementDate: Date;
  statementStartDate: Date;

  openingBalance: number;
  closingBalance: number;
  bookBalance: number;
  clearedBalance: number;
  difference: number;

  transactionIds: Types.ObjectId[];

  status: 'in_progress' | 'completed' | 'void';

  completedAt?: Date;
  completedBy?: Types.ObjectId | null;

  notes?: string;

  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBankReconciliationModel extends Model<IBankReconciliation> {}

const bankReconciliationSchema = new Schema<IBankReconciliation, IBankReconciliationModel>(
  {
    reconciliationId: { type: String, required: true, unique: true, trim: true, index: true },
    bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', required: true, index: true },
    statementDate: { type: Date, required: true },
    statementStartDate: { type: Date, required: true },

    openingBalance: { type: Number, default: 0 },
    closingBalance: { type: Number, default: 0 },
    bookBalance: { type: Number, default: 0 },
    clearedBalance: { type: Number, default: 0 },
    difference: { type: Number, default: 0 },

    transactionIds: { type: [Schema.Types.ObjectId], ref: 'BankTransaction', default: [] },

    status: { type: String, enum: ['in_progress', 'completed', 'void'], default: 'in_progress', index: true },

    completedAt: { type: Date },
    completedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    notes: { type: String, trim: true, maxlength: 2000 },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } }
);

bankReconciliationSchema.pre('validate', async function () {
  if (this.isNew && !this.reconciliationId) {
    const seq = await Counter.next('bankReconciliationId');
    this.reconciliationId = `REC-${String(seq).padStart(6, '0')}`;
  }
});

export const BankReconciliation =
  (mongoose.models.BankReconciliation as IBankReconciliationModel) ||
  mongoose.model<IBankReconciliation, IBankReconciliationModel>('BankReconciliation', bankReconciliationSchema);

// ═══════════════════════════════════════════════════════════════════════════
// 9. LEDGER ENTRY (VL — AR/AP Sub-ledger)
// ═══════════════════════════════════════════════════════════════════════════

export interface ILedgerEntry extends Document {
  _id: Types.ObjectId;

  accountId: Types.ObjectId;
  accountCode: string;
  accountName: string;

  partyType: 'client' | 'provider' | 'employee' | 'other';
  clientId?: Types.ObjectId | null;
  providerId?: Types.ObjectId | null;
  employeeId?: Types.ObjectId | null;

  journalEntryId: Types.ObjectId;
  entryDate: Date;

  description: string;
  reference?: string;
  referenceType?: ReferenceType;
  referenceId?: Types.ObjectId | null;

  debit: number;
  credit: number;

  runningBalance: number;
  balanceType: 'DR' | 'CR';

  dueDate?: Date;
  isSettled: boolean;
  settledAt?: Date;

  invoiceId?: Types.ObjectId | null;
  paymentId?: Types.ObjectId | null;
  providerExpenseId?: Types.ObjectId | null;

  fiscalYear: number;
  fiscalPeriod: number;

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ILedgerEntryModel extends Model<ILedgerEntry> {
  findForClient(clientId: Types.ObjectId | string): Promise<ILedgerEntry[]>;
  findForProvider(providerId: Types.ObjectId | string): Promise<ILedgerEntry[]>;
  findUnsettled(partyType: string, partyId: Types.ObjectId | string): Promise<ILedgerEntry[]>;
}

const ledgerEntrySchema = new Schema<ILedgerEntry, ILedgerEntryModel>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    accountCode: { type: String, required: true, trim: true, index: true },
    accountName: { type: String, required: true, trim: true },

    partyType: { type: String, enum: ['client', 'provider', 'employee', 'other'], required: true, index: true },
    clientId: { type: Schema.Types.ObjectId, ref: 'Client', default: null, index: true },
    providerId: { type: Schema.Types.ObjectId, ref: 'Provider', default: null, index: true },
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },

    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', required: true, index: true },
    entryDate: { type: Date, required: true, index: true },

    description: { type: String, required: true, trim: true, maxlength: 500 },
    reference: { type: String, trim: true, maxlength: 100 },
    referenceType: { type: String, default: null },
    referenceId: { type: Schema.Types.ObjectId, default: null },

    debit: { type: Number, default: 0, min: 0 },
    credit: { type: Number, default: 0, min: 0 },

    runningBalance: { type: Number, default: 0 },
    balanceType: { type: String, enum: ['DR', 'CR'], default: 'DR' },

    dueDate: { type: Date, index: true },
    isSettled: { type: Boolean, default: false, index: true },
    settledAt: { type: Date },

    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', default: null, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
    providerExpenseId: { type: Schema.Types.ObjectId, ref: 'ProviderExpense', default: null, index: true },

    fiscalYear: { type: Number, required: true, index: true },
    fiscalPeriod: { type: Number, required: true, min: 1, max: 12, index: true },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } }
);

ledgerEntrySchema.index({ clientId: 1, entryDate: -1 });
ledgerEntrySchema.index({ providerId: 1, entryDate: -1 });
ledgerEntrySchema.index({ partyType: 1, isSettled: 1, dueDate: 1 });

ledgerEntrySchema.statics.findForClient = function (clientId: Types.ObjectId | string) {
  return this.find({ clientId, isDeleted: false }).sort({ entryDate: 1 });
};
ledgerEntrySchema.statics.findForProvider = function (providerId: Types.ObjectId | string) {
  return this.find({ providerId, isDeleted: false }).sort({ entryDate: 1 });
};
ledgerEntrySchema.statics.findUnsettled = function (partyType: string, partyId: Types.ObjectId | string) {
  const filter: Record<string, any> = { partyType, isSettled: false, isDeleted: false };
  if (partyType === 'client') filter.clientId = partyId;
  if (partyType === 'provider') filter.providerId = partyId;
  if (partyType === 'employee') filter.employeeId = partyId;
  return this.find(filter).sort({ entryDate: 1 });
};

export const LedgerEntry =
  (mongoose.models.LedgerEntry as ILedgerEntryModel) ||
  mongoose.model<ILedgerEntry, ILedgerEntryModel>('LedgerEntry', ledgerEntrySchema);

// ═══════════════════════════════════════════════════════════════════════════
// 10. BOOK ENTRY (CB / BB — Cash Book / Bank Book)
// ═══════════════════════════════════════════════════════════════════════════

export interface IBookEntry extends Document {
  _id: Types.ObjectId;

  bookType: CBBookType;
  bookId: string;

  accountId: Types.ObjectId;
  accountCode: string;
  bankAccountId?: Types.ObjectId | null;

  entryDate: Date;
  description: string;
  reference?: string;

  receiptAmount: number;
  paymentAmount: number;

  runningBalance: number;
  balanceType: 'DR' | 'CR';

  contraAccountId?: Types.ObjectId | null;
  contraAccountCode?: string;
  contraAccountName?: string;

 journalEntryId?: string | null;
paymentId?: string | null;
bankTransactionId?: string | null;   // ← add

fiscalYear: number;
  fiscalPeriod: number;

  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IBookEntryModel extends Model<IBookEntry> {
  findForBook(bookType: CBBookType, accountId: Types.ObjectId | string): Promise<IBookEntry[]>;
}

const bookEntrySchema = new Schema<IBookEntry, IBookEntryModel>(
  {
    bookType: { type: String, enum: ['cash_book', 'bank_book'], required: true, index: true },
    bookId: { type: String, required: true, trim: true, index: true },

    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    accountCode: { type: String, required: true, trim: true },
    bankAccountId: { type: Schema.Types.ObjectId, ref: 'BankAccount', default: null, index: true },

    entryDate: { type: Date, required: true, index: true },
    description: { type: String, required: true, trim: true, maxlength: 500 },
    reference: { type: String, trim: true, maxlength: 100 },

    receiptAmount: { type: Number, default: 0, min: 0 },
    paymentAmount: { type: Number, default: 0, min: 0 },

    runningBalance: { type: Number, default: 0 },
    balanceType: { type: String, enum: ['DR', 'CR'], default: 'DR' },

    contraAccountId: { type: Schema.Types.ObjectId, ref: 'Account', default: null },
    contraAccountCode: { type: String, trim: true },
    contraAccountName: { type: String, trim: true },

    journalEntryId: { type: Schema.Types.ObjectId, ref: 'JournalEntry', default: null, index: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', default: null, index: true },
    bankTransactionId: { type: Schema.Types.ObjectId, ref: 'BankTransaction', default: null, index: true },

    fiscalYear: { type: Number, required: true, index: true },
    fiscalPeriod: { type: Number, required: true, min: 1, max: 12, index: true },

    isDeleted: { type: Boolean, default: false, index: true },
  },
  { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } }
);

bookEntrySchema.index({ bookType: 1, accountId: 1, entryDate: -1 });
bookEntrySchema.index({ bookType: 1, bankAccountId: 1, entryDate: -1 });

bookEntrySchema.statics.findForBook = function (bookType: CBBookType, accountId: Types.ObjectId | string) {
  return this.find({ bookType, accountId, isDeleted: false }).sort({ entryDate: 1 });
};

export const BookEntry =
  (mongoose.models.BookEntry as IBookEntryModel) ||
  mongoose.model<IBookEntry, IBookEntryModel>('BookEntry', bookEntrySchema);

// ═══════════════════════════════════════════════════════════════════════════
// 11. ACCOUNT BALANCE SNAPSHOT
// ═══════════════════════════════════════════════════════════════════════════

export interface IAccountBalance extends Document {
  _id: Types.ObjectId;

  accountId: Types.ObjectId;
  accountCode: string;

  fiscalYear: number;
  fiscalPeriod: number;

  openingDebit: number;
  openingCredit: number;
  periodDebit: number;
  periodCredit: number;
  closingDebit: number;
  closingCredit: number;

  currency: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface IAccountBalanceModel extends Model<IAccountBalance> {
  findByPeriod(fiscalYear: number, fiscalPeriod: number): Promise<IAccountBalance[]>;
}

const accountBalanceSchema = new Schema<IAccountBalance, IAccountBalanceModel>(
  {
    accountId: { type: Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
    accountCode: { type: String, required: true, trim: true, index: true },

    fiscalYear: { type: Number, required: true, index: true },
    fiscalPeriod: { type: Number, required: true, min: 1, max: 12, index: true },

    openingDebit: { type: Number, default: 0 },
    openingCredit: { type: Number, default: 0 },
    periodDebit: { type: Number, default: 0 },
    periodCredit: { type: Number, default: 0 },
    closingDebit: { type: Number, default: 0 },
    closingCredit: { type: Number, default: 0 },

    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'PKR' },
  },
  { timestamps: true, toJSON: { versionKey: false }, toObject: { versionKey: false } }
);

accountBalanceSchema.index({ accountId: 1, fiscalYear: 1, fiscalPeriod: 1 }, { unique: true });

accountBalanceSchema.statics.findByPeriod = function (fiscalYear: number, fiscalPeriod: number) {
  return this.find({ fiscalYear, fiscalPeriod });
};

export const AccountBalance =
  (mongoose.models.AccountBalance as IAccountBalanceModel) ||
  mongoose.model<IAccountBalance, IAccountBalanceModel>('AccountBalance', accountBalanceSchema);

// ═══════════════════════════════════════════════════════════════════════════
// 12. UTILITY: Build & Post Journal Entries
// ═══════════════════════════════════════════════════════════════════════════

export interface IBuildJournalInput {
  entryDate: Date;
  description: string;
  source: JournalEntrySource;
  referenceType?: ReferenceType;
  referenceId?: Types.ObjectId | null;
  currency?: string;
  lines: Array<{
    accountCode: string;
    debit?: number;
    credit?: number;
    description?: string;
    clientId?: Types.ObjectId | null;
    providerId?: Types.ObjectId | null;
    employeeId?: Types.ObjectId | null;
    invoiceId?: Types.ObjectId | null;
    paymentId?: Types.ObjectId | null;
  }>;
  createdBy?: Types.ObjectId | null;
}

export async function buildJournalEntry(input: IBuildJournalInput) {
  const accountCodes = Array.from(new Set(input.lines.map((l) => l.accountCode)));
  const accounts = await Account.find({
    accountId: { $in: accountCodes },
    isDeleted: false,
  }).lean();

  const accountMap = new Map(accounts.map((a) => [a.accountId, a]));

  const lines = input.lines.map((l, idx) => {
    const acc = accountMap.get(l.accountCode);
    if (!acc) throw new Error(`Account not found: ${l.accountCode}`);

    return {
      accountId: acc._id,
      accountCode: acc.accountId,
      accountName: acc.name,
      description: l.description ?? input.description,
      debit: round2(l.debit ?? 0),
      credit: round2(l.credit ?? 0),
      clientId: l.clientId ?? null,
      providerId: l.providerId ?? null,
      employeeId: l.employeeId ?? null,
      invoiceId: l.invoiceId ?? null,
      paymentId: l.paymentId ?? null,
      sequence: idx + 1,
    };
  });

  // ── Derive fiscal year/period from entryDate ──
  const entryDate = new Date(input.entryDate);
  const fiscalYear = entryDate.getFullYear();
  const fiscalPeriod = entryDate.getMonth() + 1;

  return {
    entryDate: input.entryDate,
    description: input.description,
    source: input.source,
    referenceType: input.referenceType,
    referenceId: input.referenceId ?? null,
    currency: input.currency ?? getAccountingConfig().defaultCurrency,
    lines,
    status: 'draft' as JournalEntryStatus,
    createdBy: input.createdBy ?? null,
    fiscalYear,
    fiscalPeriod,
  };
}

export async function postJournalEntry(
  input: IBuildJournalInput
): Promise<IJournalEntry> {
  const cfg = getAccountingConfig();

  const period = await FiscalPeriod.findByDate(input.entryDate);
  if (period && period.status !== 'open') {
    throw new Error(
      `Fiscal period ${period.periodName} is ${period.status}; cannot post`
    );
  }

  if (!cfg.allowBackdatedEntries) {
    const today = new Date();
    const daysDiff = Math.floor(
      (today.getTime() - new Date(input.entryDate).getTime()) / 86_400_000
    );
    if (daysDiff > cfg.backdateDaysLimit) {
      throw new Error(
        `Backdated entries not allowed beyond ${cfg.backdateDaysLimit} days`
      );
    }
  }

  const built = await buildJournalEntry(input);

  const doc = new JournalEntry(built);
  doc.status = 'posted';
  doc.postedAt = new Date();
  await doc.save();

  await updateAccountBalances(doc);

  return doc;
}

export async function reverseJournalEntry(
  entryId: Types.ObjectId | string,
  reason: string,
  reversedBy?: Types.ObjectId | null
): Promise<IJournalEntry> {
  const original = await JournalEntry.findById(entryId);
  if (!original) throw new Error('Journal entry not found');
  if (original.status !== 'posted') throw new Error('Only posted entries can be reversed');
  if (original.reversedBy) throw new Error('Entry already reversed');

  const reversalLines = original.lines.map((l) => ({
    accountCode: l.accountCode,
    debit: l.credit,
    credit: l.debit,
    description: `Reversal: ${l.description ?? ''}`,
    clientId: l.clientId ?? null,
    providerId: l.providerId ?? null,
    employeeId: l.employeeId ?? null,
    invoiceId: l.invoiceId ?? null,
    paymentId: l.paymentId ?? null,
  }));

  const reversal = await postJournalEntry({
    entryDate: new Date(),
    description: `Reversal of ${original.entryId} — ${reason}`,
    source: original.source,
    referenceType: original.referenceType,
    referenceId: original.referenceId,
    currency: original.currency,
    lines: reversalLines,
    createdBy: reversedBy ?? null,
  });

  reversal.reversalOf = original._id;
  reversal.reversalReason = reason;
  await reversal.save();

  original.reversedBy = reversal._id;
  original.status = 'reversed';
  await original.save();

  return reversal;
}

export async function updateAccountBalances(entry: IJournalEntry): Promise<void> {
  const updates = entry.lines.map((line) => ({
    updateOne: {
      filter: { _id: line.accountId },
      update: {
        $inc: {
          currentBalance: line.debit > 0 ? line.debit : -line.credit,
        },
      },
    },
  }));
  if (updates.length) await Account.bulkWrite(updates);
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. LEDGER & BOOK POSTING
// ═══════════════════════════════════════════════════════════════════════════

export interface IPostLedgerInput {
  accountCode: string;
  partyType: 'client' | 'provider' | 'employee' | 'other';
  clientId?: Types.ObjectId | null;
  providerId?: Types.ObjectId | null;
  employeeId?: Types.ObjectId | null;

  journalEntryId: Types.ObjectId;
  entryDate: Date;
  description: string;
  reference?: string;
  referenceType?: ReferenceType;
  referenceId?: Types.ObjectId | null;

  debit?: number;
  credit?: number;

  dueDate?: Date;
  invoiceId?: Types.ObjectId | null;
  paymentId?: Types.ObjectId | null;
  providerExpenseId?: Types.ObjectId | null;
}

export async function postLedgerEntry(input: IPostLedgerInput): Promise<ILedgerEntry> {
  const account = await Account.findByCode(input.accountCode);
  if (!account) throw new Error(`Account not found: ${input.accountCode}`);

  const partyFilter: Record<string, any> = {
    accountId: account._id,
    partyType: input.partyType,
    isDeleted: false,
  };
  if (input.partyType === 'client') partyFilter.clientId = input.clientId;
  if (input.partyType === 'provider') partyFilter.providerId = input.providerId;
  if (input.partyType === 'employee') partyFilter.employeeId = input.employeeId;

  const last = await LedgerEntry.findOne(partyFilter).sort({ entryDate: -1, createdAt: -1 });

  const prevBalance = last?.runningBalance ?? 0;
  const delta = (input.debit ?? 0) - (input.credit ?? 0);
  const newBalance = round2(prevBalance + delta);

  const ledger = new LedgerEntry({
    accountId: account._id,
    accountCode: account.accountId,
    accountName: account.name,

    partyType: input.partyType,
    clientId: input.clientId ?? null,
    providerId: input.providerId ?? null,
    employeeId: input.employeeId ?? null,

    journalEntryId: input.journalEntryId,
    entryDate: input.entryDate,
    description: input.description,
    reference: input.reference,
    referenceType: input.referenceType,
    referenceId: input.referenceId ?? null,

    debit: round2(input.debit ?? 0),
    credit: round2(input.credit ?? 0),

    runningBalance: newBalance,
    balanceType: newBalance >= 0 ? 'DR' : 'CR',

    dueDate: input.dueDate,
    isSettled: false,

    invoiceId: input.invoiceId ?? null,
    paymentId: input.paymentId ?? null,
    providerExpenseId: input.providerExpenseId ?? null,

    fiscalYear: new Date(input.entryDate).getFullYear(),
    fiscalPeriod: new Date(input.entryDate).getMonth() + 1,
  });

  await ledger.save();
  return ledger;
}

export interface IPostBookEntryInput {
  bookType: CBBookType;
  accountCode: string;
  bankAccountId?: Types.ObjectId | null;
  entryDate: Date;
  description: string;
  reference?: string;
  receiptAmount?: number;
  paymentAmount?: number;
  contraAccountCode?: string;
  journalEntryId?: Types.ObjectId | null;
  paymentId?: Types.ObjectId | null;
  bankTransactionId?: Types.ObjectId | null;   // ← add
}

export async function postBookEntry(input: IPostBookEntryInput): Promise<IBookEntry> {
  const account = await Account.findByCode(input.accountCode);
  if (!account) throw new Error(`Account not found: ${input.accountCode}`);

  let contra: any = null;
  if (input.contraAccountCode) {
    contra = await Account.findByCode(input.contraAccountCode);
  }

  const last = await BookEntry.findOne({
    bookType: input.bookType,
    accountId: account._id,
    isDeleted: false,
  }).sort({ entryDate: -1, createdAt: -1 });

  const prevBalance = last?.runningBalance ?? account.openingBalance ?? 0;
  const delta = (input.receiptAmount ?? 0) - (input.paymentAmount ?? 0);
  const newBalance = round2(prevBalance + delta);

  const bookId = `${input.bookType === 'cash_book' ? 'CB' : 'BB'}-${input.accountCode}-${new Date(input.entryDate).getFullYear()}-${String(new Date(input.entryDate).getMonth() + 1).padStart(2, '0')}`;

const entry = new BookEntry({
  bookType: input.bookType,
  bookId,
  accountId: account._id,
  accountCode: account.accountId,
  bankAccountId: input.bankAccountId ?? null,
  entryDate: input.entryDate,
  description: input.description,
  reference: input.reference,
  receiptAmount: round2(input.receiptAmount ?? 0),
  paymentAmount: round2(input.paymentAmount ?? 0),
  runningBalance: newBalance,
  balanceType: newBalance >= 0 ? 'DR' : 'CR',
  contraAccountId: contra?._id ?? null,
  contraAccountCode: contra?.accountId,
  contraAccountName: contra?.name,
  journalEntryId: input.journalEntryId ?? null,
  paymentId: input.paymentId ?? null,
  bankTransactionId: input.bankTransactionId ?? null,   // ← add
  fiscalYear: new Date(input.entryDate).getFullYear(),
  fiscalPeriod: new Date(input.entryDate).getMonth() + 1,
});

  await entry.save();
  return entry;
}

// ═══════════════════════════════════════════════════════════════════════════
// 14. AGGREGATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export interface ITrialBalanceRow {
  accountId: Types.ObjectId;
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debit: number;
  credit: number;
}

export async function getTrialBalance(
  fiscalYear: number,
  fiscalPeriod: number
): Promise<{ rows: ITrialBalanceRow[]; totalDebit: number; totalCredit: number }> {
  const result = await JournalEntry.aggregate([
    {
      $match: {
        status: 'posted',
        isDeleted: false,
        fiscalYear,
        fiscalPeriod,
      },
    },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountId',
        accountCode: { $first: '$lines.accountCode' },
        accountName: { $first: '$lines.accountName' },
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);

  const accountIds = result.map((r: any) => r._id);
  const accounts = await Account.find({ _id: { $in: accountIds } }).lean();
  const accMap = new Map(accounts.map((a) => [String(a._id), a]));

  let totalDebit = 0;
  let totalCredit = 0;
  const rows: ITrialBalanceRow[] = result.map((r: any) => {
    const acc = accMap.get(String(r._id));
    totalDebit += r.debit;
    totalCredit += r.credit;
    return {
      accountId: r._id,
      accountCode: r.accountCode,
      accountName: r.accountName,
      accountType: (acc?.type ?? 'asset') as AccountType,
      debit: round2(r.debit),
      credit: round2(r.credit),
    };
  });

  return {
    rows,
    totalDebit: round2(totalDebit),
    totalCredit: round2(totalCredit),
  };
}

export interface IAgingRow {
  partyId: Types.ObjectId;
  partyType?: 'client' | 'provider' | 'adhoc';
  partyName?: string;
  category?: string;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d91_120: number;
  over120: number;
  total: number;
}

export async function getReceivablesAging(): Promise<IAgingRow[]> {
  const invoices = await Invoice.find({
    status: { $in: ['sent', 'viewed', 'partial', 'overdue'] },
    balanceDue: { $gt: 0 },
    isDeleted: false,
  }).lean();

  const byClient = new Map<string, IAgingRow>();

  for (const inv of invoices) {
    const key = String(inv.clientId);
    if (!byClient.has(key)) {
      byClient.set(key, {
        partyId: inv.clientId,
        partyType: 'client',
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d91_120: 0,
        over120: 0,
        total: 0,
      });
    }
    const row = byClient.get(key)!;
    const days = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / 86_400_000);

    if (days <= 0) row.current += inv.balanceDue;
    else if (days <= 30) row.d1_30 += inv.balanceDue;
    else if (days <= 60) row.d31_60 += inv.balanceDue;
    else if (days <= 90) row.d61_90 += inv.balanceDue;
    else if (days <= 120) row.d91_120 += inv.balanceDue;
    else row.over120 += inv.balanceDue;
    row.total += inv.balanceDue;
  }

  return Array.from(byClient.values()).map((r) => ({
    ...r,
    current: round2(r.current),
    d1_30: round2(r.d1_30),
    d31_60: round2(r.d31_60),
    d61_90: round2(r.d61_90),
    d91_120: round2(r.d91_120),
    over120: round2(r.over120),
    total: round2(r.total),
  }));
}

export async function getPayablesAging(): Promise<IAgingRow[]> {
  const expenses = await ProviderExpense.find({
    status: 'pending',
    isDeleted: false,
  }).lean();

  const byParty = new Map<string, IAgingRow>();

  for (const exp of expenses) {
    // Use providerId if it exists, otherwise use _id (for ad-hoc)
    const partyId = exp.provider ? String(exp.provider) : String(exp._id);
    const partyType = exp.provider ? 'provider' : 'adhoc';

    if (!byParty.has(partyId)) {
      byParty.set(partyId, {
        partyId: (exp.provider || exp._id) as Types.ObjectId,
        partyType,
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d91_120: 0,
        over120: 0,
        total: 0,
      });
    }

    const row = byParty.get(partyId)!;
    const due = exp.expenseDate;
    const days = Math.floor((Date.now() - new Date(due).getTime()) / 86_400_000);
    const amt = exp.amount;

    if (days <= 0) row.current += amt;
    else if (days <= 30) row.d1_30 += amt;
    else if (days <= 60) row.d31_60 += amt;
    else if (days <= 90) row.d61_90 += amt;
    else if (days <= 120) row.d91_120 += amt;
    else row.over120 += amt;
    row.total += amt;
  }

  return Array.from(byParty.values()).map((r) => ({
    ...r,
    current: round2(r.current),
    d1_30: round2(r.d1_30),
    d31_60: round2(r.d31_60),
    d61_90: round2(r.d61_90),
    d91_120: round2(r.d91_120),
    over120: round2(r.over120),
    total: round2(r.total),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  Account,
  BankAccount,
  FiscalPeriod,
  JournalEntry,
  Invoice,
  Payment,
  BankTransaction,
  BankReconciliation,
  LedgerEntry,
  BookEntry,
  AccountBalance,
  round2,
  toDecimal,
  getAccountingConfig,
  setAccountingConfig,
  registerPostingRule,
  registerPostingRules,
  getPostingRule,
  getPostingRules,
  buildJournalEntry,
  postJournalEntry,
  reverseJournalEntry,
  postLedgerEntry,
  postBookEntry,
  updateAccountBalances,
  getTrialBalance,
  getReceivablesAging,
  getPayablesAging,
};