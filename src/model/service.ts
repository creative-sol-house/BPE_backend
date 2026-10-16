// model/service.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Counter from './counter';

// ─── Enums & Types ────────────────────────────────────────────────────────
export type ServiceStatus = 'active' | 'inactive' | 'archived';

export type ServiceBillingType =
  | 'one_time'      // one-off delivery
  | 'hourly'        // billed per hour
  | 'daily'         // billed per day
  | 'monthly'       // recurring monthly
  | 'yearly'        // recurring yearly
  | 'milestone'     // billed on milestones
  | 'retainer';     // ongoing retainer

// ─── Sub-document Interfaces ──────────────────────────────────────────────
export interface IServicePricingTier {
  label: string;             // "Basic", "Pro", "Enterprise"
  description?: string;
  price: number;
  currency: string;
  billingType: ServiceBillingType;
  minQuantity?: number;
  maxQuantity?: number;
  isDefault: boolean;
}

// ─── Main Interface ───────────────────────────────────────────────────────
export interface IService extends Document {
  _id: Types.ObjectId;

  serviceId: string;         // e.g. "SVC-00001"

  // ── Identity ─────────────────────────────────────────────────────
  name: string;
  code?: string;             // short code, e.g. "ERP-BASIC"
  description?: string;
  category?: string;
  tags: string[];

  // ── Pricing ──────────────────────────────────────────────────────
  basePrice: number;
  currency: string;
  billingType: ServiceBillingType;
  taxRate?: number;          // percent, 0–100
  pricingTiers: IServicePricingTier[];

  // ── Delivery ─────────────────────────────────────────────────────
  estimatedDurationDays?: number;
  deliveryNotes?: string;

  // ── Status ───────────────────────────────────────────────────────
  status: ServiceStatus;
  isActive: boolean;

  // ── Audit ────────────────────────────────────────────────────────
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // ── Virtuals ─────────────────────────────────────────────────────
  displayName: string;
  defaultTier: IServicePricingTier | null;
  isRecurring: boolean;
  isOneTime: boolean;
}

export interface IServiceModel extends Model<IService> {
  findActive(filter?: Record<string, any>): Promise<IService[]>;
}

// ─── Constants ────────────────────────────────────────────────────────────
export const SERVICE_STATUSES: ServiceStatus[] = ['active', 'inactive', 'archived'];

export const SERVICE_BILLING_TYPES: ServiceBillingType[] = [
  'one_time', 'hourly', 'daily', 'monthly', 'yearly', 'milestone', 'retainer',
];

/** Billing types that imply a recurring charge. */
export const RECURRING_BILLING_TYPES: ServiceBillingType[] = [
  'monthly', 'yearly', 'retainer',
];

// ─── Sub-schemas ──────────────────────────────────────────────────────────
const servicePricingTierSchema = new Schema<IServicePricingTier>(
  {
    label:       { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500 },
    price:       { type: Number, required: true, min: 0 },
    currency: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 3,
      default: 'PKR',
    },
    billingType: {
      type: String,
      enum: SERVICE_BILLING_TYPES,
      required: true,
    },
    minQuantity: { type: Number, min: 0 },
    maxQuantity: { type: Number, min: 0 },
    isDefault:   { type: Boolean, default: false },
  },
  { _id: true }
);

// ─── Main Service Schema ──────────────────────────────────────────────────
const serviceSchema = new Schema<IService, IServiceModel>(
  {
    serviceId: { type: String, required: true, unique: true, trim: true },

    // ── Identity ────────────────────────────────────────────────────
    name:        { type: String, required: true, trim: true, maxlength: 200 },
    code:        { type: String, trim: true, uppercase: true, maxlength: 40 },
    description: { type: String, trim: true, maxlength: 2000 },
    category:    { type: String, trim: true, maxlength: 100, index: true },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.length <= 20,
        message: 'A service can have at most 20 tags',
      },
    },

    // ── Pricing ─────────────────────────────────────────────────────
    basePrice:   { type: Number, default: 0, min: 0 },
    currency: {
      type: String,
      default: 'PKR',
      trim: true,
      uppercase: true,
      maxlength: 3,
    },
    billingType: {
      type: String,
      enum: SERVICE_BILLING_TYPES,
      default: 'one_time',
      required: true,
      index: true,
    },
    taxRate: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    pricingTiers: {
      type: [servicePricingTierSchema],
      default: [],
      validate: {
        validator: (arr: IServicePricingTier[]) =>
          arr.filter((t) => t.isDefault).length <= 1,
        message: 'Only one default pricing tier is allowed',
      },
    },

    // ── Delivery ────────────────────────────────────────────────────
    estimatedDurationDays: { type: Number, min: 0 },
    deliveryNotes: { type: String, trim: true, maxlength: 1000 },

    // ── Status ──────────────────────────────────────────────────────
    status: {
      type: String,
      enum: SERVICE_STATUSES,
      default: 'active',
      required: true,
      index: true,
    },
    isActive: { type: Boolean, default: true, index: true },

    // ── Audit ───────────────────────────────────────────────────────
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
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
// NOTE: `code` uses sparse + unique so we don't clash when many services
//       have no code at all.
serviceSchema.index({ code: 1 }, { unique: true, sparse: true });
serviceSchema.index({ status: 1, isDeleted: 1 });
serviceSchema.index({ category: 1, status: 1, isDeleted: 1 });
serviceSchema.index({ billingType: 1, status: 1 });
serviceSchema.index({ createdAt: -1 });
// Text search across the useful string fields
serviceSchema.index(
  { name: 'text', code: 'text', description: 'text', category: 'text' },
  { name: 'service_text_search' }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────
serviceSchema.virtual('displayName').get(function () {
  return this.code ? `${this.name} · ${this.code}` : this.name;
});

serviceSchema.virtual('defaultTier').get(function () {
  if (!this.pricingTiers?.length) return null;
  return (
    this.pricingTiers.find((t) => t.isDefault) ??
    this.pricingTiers[0] ??
    null
  );
});

serviceSchema.virtual('isRecurring').get(function () {
  return RECURRING_BILLING_TYPES.includes(this.billingType);
});

serviceSchema.virtual('isOneTime').get(function () {
  return this.billingType === 'one_time';
});

// ─── Auto-generate serviceId ──────────────────────────────────────────────
serviceSchema.pre('validate', async function () {
  if (this.isNew && !this.serviceId) {
    const seq = await Counter.next('serviceId');
    this.serviceId = `SVC-${String(seq).padStart(5, '0')}`;
  }
});

// ─── Pre-save lifecycle hooks ─────────────────────────────────────────────
serviceSchema.pre('save', function () {
  // Keep isActive in sync with status
  if (this.isModified('status') || this.isNew) {
    this.isActive = this.status === 'active';
  }

  // Stamp soft-delete time
  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }

  // Normalize code (already uppercase via schema, but trim empty strings away)
  if (typeof this.code === 'string') {
    const c = this.code.trim();
    this.code = c ? c : undefined;
  }

  // Normalize tags — dedupe case-insensitively, cap length
  if (Array.isArray(this.tags)) {
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const raw of this.tags) {
      const t = String(raw || '').trim().slice(0, 50);
      if (!t) continue;
      const key = t.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(t);
    }
    this.tags = cleaned;
  }
});

// ─── Statics ──────────────────────────────────────────────────────────────
serviceSchema.statics.findActive = function (
  filter: Record<string, any> = {}
) {
  return this.find({ ...filter, status: 'active', isDeleted: false });
};

// ─── Model export ─────────────────────────────────────────────────────────
const Service =
  (mongoose.models.Service as IServiceModel) ||
  mongoose.model<IService, IServiceModel>('Service', serviceSchema);

export default Service;