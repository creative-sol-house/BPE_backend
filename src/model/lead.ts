// model/lead.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Counter from './counter';

// ─── Enums & Types ────────────────────────────────────────────────────────
export type LeadStatus =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'proposal_sent'
  | 'negotiation'
  | 'won'
  | 'lost'
  | 'on_hold'
  | 'disqualified';

export type LeadPriority = 'low' | 'medium' | 'high' | 'urgent';

export type LeadSource =
  | 'website'
  | 'referral'
  | 'cold_call'
  | 'email_campaign'
  | 'social_media'
  | 'event'
  | 'walk_in'
  | 'partner'
  | 'advertisement'
  | 'other';

export type LeadTemperature = 'cold' | 'warm' | 'hot';

// ─── Sub-document Interfaces ──────────────────────────────────────────────
export interface ILeadActivity {
  type: 'call' | 'email' | 'meeting' | 'note' | 'status_change' | 'follow_up';
  description: string;
  performedBy?: Types.ObjectId | null;
  performedAt: Date;
}

export interface ILeadAttachment {
  fileName: string;
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
}

// ─── Main Interface ───────────────────────────────────────────────────────
export interface ILead extends Document {
  _id: Types.ObjectId;

  leadId: string;

  // ── Prospect ─────────────────────────────────────────────────────
  name: string;
  companyName?: string;
  email?: string;
  phoneNo: string;
  alternatePhoneNo?: string;
  website?: string;

  // ── Opportunity ──────────────────────────────────────────────────
  /** FK to a known Service. Only set when the user picked from the dropdown. */
  serviceId?: Types.ObjectId | null;
  /** Free-text service name. Only set when the user typed a custom value. */
  serviceLabel?: string;
  requirement?: string;
  estimatedBudget?: number;
  currency: string;
  expectedStartDate?: Date;

  // ── Sales pipeline ───────────────────────────────────────────────
  status: LeadStatus;
  priority: LeadPriority;
  source: LeadSource;
  temperature: LeadTemperature;
  /** 0–100 confidence of closing */
  probability?: number;

  // ── Assignment ───────────────────────────────────────────────────
  assignedTo?: Types.ObjectId | null;
  assignedAt?: Date;

  // ── Follow-up ────────────────────────────────────────────────────
  nextFollowUpDate?: Date;
  lastContactedAt?: Date;

  // ── Conversion ───────────────────────────────────────────────────
  clientId?: Types.ObjectId | null;
  convertedAt?: Date;
  convertedBy?: Types.ObjectId | null;
  lostReason?: string;

  // ── Notes & activity ─────────────────────────────────────────────
  notes?: string;
  activities: ILeadActivity[];
  attachments: ILeadAttachment[];
  tags: string[];

  // ── Audit ────────────────────────────────────────────────────────
  createdBy?: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // ── Virtuals ─────────────────────────────────────────────────────
  isConverted: boolean;
  isOpen: boolean;
  isClosed: boolean;
  ageInDays: number;
  isFollowUpOverdue: boolean;
  fullDisplayName: string;
  daysSinceLastContact: number | null;
  /** Human-readable service name — resolves `serviceId` or falls back to `serviceLabel`. */
  serviceDisplay: string | null;
  /** True if the service was entered as free text (no FK). */
  hasCustomService: boolean;
}

export interface ILeadModel extends Model<ILead> {
  findOpen(filter?: Record<string, any>): Promise<ILead[]>;
  findOverdueFollowUps(filter?: Record<string, any>): Promise<ILead[]>;
  findByAssignee(userId: Types.ObjectId | string): Promise<ILead[]>;
}

// ─── Constants ────────────────────────────────────────────────────────────
export const LEAD_STATUSES: LeadStatus[] = [
  'new', 'contacted', 'qualified', 'proposal_sent',
  'negotiation', 'won', 'lost', 'on_hold', 'disqualified',
];

export const LEAD_PRIORITIES: LeadPriority[] = ['low', 'medium', 'high', 'urgent'];

export const LEAD_SOURCES: LeadSource[] = [
  'website', 'referral', 'cold_call', 'email_campaign', 'social_media',
  'event', 'walk_in', 'partner', 'advertisement', 'other',
];

export const LEAD_TEMPERATURES: LeadTemperature[] = ['cold', 'warm', 'hot'];

export const LEAD_ACTIVITY_TYPES = [
  'call', 'email', 'meeting', 'note', 'status_change', 'follow_up',
] as const;

/** Statuses that mean the lead is still being worked on. */
export const OPEN_LEAD_STATUSES: LeadStatus[] = [
  'new', 'contacted', 'qualified', 'proposal_sent', 'negotiation', 'on_hold',
];

/** Statuses that mean the lead is closed (won or lost). */
export const CLOSED_LEAD_STATUSES: LeadStatus[] = ['won', 'lost', 'disqualified'];

/** Terminal statuses that count as won. */
export const WON_LEAD_STATUSES: LeadStatus[] = ['won'];

/** Max length of a free-text service label. */
export const SERVICE_LABEL_MAX_LENGTH = 200;

/** Helper: is this string a 24-hex Mongo ObjectId? */
export function isObjectIdLike(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  const s = String(v).trim();
  return /^[a-fA-F0-9]{24}$/.test(s);
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────
const leadActivitySchema = new Schema<ILeadActivity>(
  {
    type: {
      type: String,
      enum: LEAD_ACTIVITY_TYPES,
      required: true,
    },
    description: { type: String, required: true, trim: true, maxlength: 1000 },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
    performedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const leadAttachmentSchema = new Schema<ILeadAttachment>(
  {
    fileName:   { type: String, required: true, trim: true, maxlength: 255 },
    fileUrl:    { type: String, required: true, trim: true, maxlength: 1000 },
    fileType:   { type: String, trim: true, maxlength: 100 },
    fileSize:   { type: Number, min: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// ─── Main Lead Schema ─────────────────────────────────────────────────────
const leadSchema = new Schema<ILead, ILeadModel>(
  {
    leadId: { type: String, required: true, unique: true, trim: true },

    // ── Prospect ────────────────────────────────────────────────────
    name:             { type: String, required: true, trim: true, maxlength: 200 },
    companyName:      { type: String, trim: true, maxlength: 200 },
    email:            { type: String, trim: true, lowercase: true, default: undefined },
    phoneNo:          { type: String, required: true, trim: true, maxlength: 30 },
    alternatePhoneNo: { type: String, trim: true, maxlength: 30 },
    website:          { type: String, trim: true, maxlength: 200 },

    // ── Opportunity ─────────────────────────────────────────────────
    serviceId: {
      type: Schema.Types.ObjectId,
      ref: 'Service',
      default: null,
      index: true,
    },
    serviceLabel: {
      type: String,
      trim: true,
      maxlength: SERVICE_LABEL_MAX_LENGTH,
      default: undefined,
    },
    requirement:       { type: String, trim: true, maxlength: 2000 },
    estimatedBudget:   { type: Number, default: 0, min: 0 },
    currency: {
      type: String,
      default: 'PKR',
      trim: true,
      uppercase: true,
      maxlength: 3,
    },
    expectedStartDate: { type: Date },

    // ── Sales pipeline ──────────────────────────────────────────────
    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: 'new',
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: LEAD_PRIORITIES,
      default: 'medium',
      required: true,
    },
    source: {
      type: String,
      enum: LEAD_SOURCES,
      default: 'other',
      required: true,
    },
    temperature: {
      type: String,
      enum: LEAD_TEMPERATURES,
      default: 'warm',
    },
    probability: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
      validate: {
        validator: (v: number) => Number.isInteger(v),
        message: 'probability must be an integer between 0 and 100',
      },
    },

    // ── Assignment ──────────────────────────────────────────────────
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
      index: true,
    },
    assignedAt: { type: Date },

    // ── Follow-up ───────────────────────────────────────────────────
    nextFollowUpDate: { type: Date, index: true },
    lastContactedAt:  { type: Date },

    // ── Conversion ──────────────────────────────────────────────────
    clientId: {
      type: Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
    },
    convertedAt: { type: Date },
    convertedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
    lostReason: { type: String, trim: true, maxlength: 500 },

    // ── Notes / activity / attachments ──────────────────────────────
    notes:       { type: String, trim: true, maxlength: 5000 },
    activities:  { type: [leadActivitySchema], default: [] },
    attachments: { type: [leadAttachmentSchema], default: [] },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.length <= 20,
        message: 'A lead can have at most 20 tags',
      },
    },

    // ── Audit ───────────────────────────────────────────────────────
    createdBy: {
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
leadSchema.index({ status: 1, isDeleted: 1 });
leadSchema.index({ assignedTo: 1, status: 1, isDeleted: 1 });
leadSchema.index({ priority: 1, status: 1 });
leadSchema.index({ source: 1, isDeleted: 1 });
leadSchema.index({ nextFollowUpDate: 1, status: 1 });
leadSchema.index({ createdAt: -1 });
// Only create the clientId index once — sparse because many leads have none.
leadSchema.index({ clientId: 1 }, { sparse: true });
// Text search across the useful string fields
leadSchema.index(
  { name: 'text', companyName: 'text', email: 'text', phoneNo: 'text' },
  { name: 'lead_text_search' }
);
// Helpful for filtering by custom service label (case-insensitive prefix lookups).
leadSchema.index({ serviceLabel: 1 }, { sparse: true });

// ─── Virtuals ─────────────────────────────────────────────────────────────
leadSchema.virtual('isConverted').get(function () {
  return this.status === 'won' && !!this.clientId;
});

leadSchema.virtual('isOpen').get(function () {
  return OPEN_LEAD_STATUSES.includes(this.status);
});

leadSchema.virtual('isClosed').get(function () {
  return CLOSED_LEAD_STATUSES.includes(this.status);
});

leadSchema.virtual('ageInDays').get(function () {
  if (!this.createdAt) return 0;
  const ms = Date.now() - this.createdAt.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
});

leadSchema.virtual('isFollowUpOverdue').get(function () {
  if (!this.nextFollowUpDate) return false;
  if (!OPEN_LEAD_STATUSES.includes(this.status)) return false;
  return this.nextFollowUpDate.getTime() < Date.now();
});

leadSchema.virtual('daysSinceLastContact').get(function () {
  if (!this.lastContactedAt) return null;
  const ms = Date.now() - this.lastContactedAt.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
});

leadSchema.virtual('fullDisplayName').get(function () {
  return this.companyName ? `${this.name} (${this.companyName})` : this.name;
});

/**
 * Human-readable service name.
 * - If `serviceId` is populated (an object), prefer its `name` (append `code` if present).
 * - Otherwise, if `serviceId` is just an ObjectId (not populated), fall back to `serviceLabel`.
 * - Otherwise, return `serviceLabel` if set.
 * - Otherwise, `null`.
 */
leadSchema.virtual('serviceDisplay').get(function () {
  const sid: any = this.serviceId;
  if (sid && typeof sid === 'object' && 'name' in sid) {
    const code = (sid as any).code;
    return code ? `${(sid as any).name} · ${code}` : (sid as any).name;
  }
  if (this.serviceLabel) return this.serviceLabel;
  return null;
});

/** True when the service was entered as free text (no FK to a Service doc). */
leadSchema.virtual('hasCustomService').get(function () {
  return !this.serviceId && !!this.serviceLabel;
});

// ─── Auto-generate leadId ─────────────────────────────────────────────────
leadSchema.pre('validate', async function () {
  if (this.isNew && !this.leadId) {
    const seq = await Counter.next('leadId');
    this.leadId = `LEAD-${String(seq).padStart(5, '0')}`;
  }
});

// ─── Pre-save lifecycle hooks ─────────────────────────────────────────────
leadSchema.pre('save', function () {
  // ── Service normalization ────────────────────────────────────────
  // Rule: `serviceId` and `serviceLabel` are mutually exclusive.
  // If both are set, the FK wins and the label is cleared.
  if (this.serviceId && this.serviceLabel) {
    this.serviceLabel = undefined;
  }

  // If `serviceId` was set but isn't a valid ObjectId, move it to `serviceLabel`.
  // This catches free-text values that snuck in via casts.
  const sid: any = this.serviceId;
  if (sid && typeof sid === 'string' && !isObjectIdLike(sid)) {
    this.serviceLabel = String(sid).trim().slice(0, SERVICE_LABEL_MAX_LENGTH);
    this.serviceId = null;
  }

  // Normalize label: trim, drop if empty
  if (typeof this.serviceLabel === 'string') {
    const trimmed = this.serviceLabel.trim();
    this.serviceLabel = trimmed ? trimmed.slice(0, SERVICE_LABEL_MAX_LENGTH) : undefined;
  }

  // ── Soft delete ──────────────────────────────────────────────────
  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }

  // ── Assignment ───────────────────────────────────────────────────
  if (this.isModified('assignedTo') && this.assignedTo) {
    this.assignedAt = new Date();
  }

  // ── Conversion ───────────────────────────────────────────────────
  if (this.isModified('status') && this.status === 'won' && !this.convertedAt) {
    this.convertedAt = new Date();
  }

  // Clear stale conversion timestamp if reopened without a linked client
  if (
    this.isModified('status') &&
    this.status !== 'won' &&
    this.convertedAt &&
    !this.clientId
  ) {
    this.convertedAt = undefined;
  }
});

// ─── Statics ──────────────────────────────────────────────────────────────
leadSchema.statics.findOpen = function (filter: Record<string, any> = {}) {
  return this.find({
    ...filter,
    status: { $in: OPEN_LEAD_STATUSES },
    isDeleted: false,
  });
};

leadSchema.statics.findOverdueFollowUps = function (
  filter: Record<string, any> = {}
) {
  return this.find({
    ...filter,
    status: { $in: OPEN_LEAD_STATUSES },
    isDeleted: false,
    nextFollowUpDate: { $lt: new Date() },
  });
};

leadSchema.statics.findByAssignee = function (
  userId: Types.ObjectId | string
) {
  return this.find({ assignedTo: userId, isDeleted: false });
};

// ─── Model export ─────────────────────────────────────────────────────────
const Lead =
  (mongoose.models.Lead as ILeadModel) ||
  mongoose.model<ILead, ILeadModel>('Lead', leadSchema);

export default Lead;