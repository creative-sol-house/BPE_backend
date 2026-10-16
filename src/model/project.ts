// model/project.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Counter from './counter';

// ─── Enums & Types ────────────────────────────────────────────────────────
export type ProjectStatus =
  | 'planning'
  | 'active'
  | 'on_hold'
  | 'completed'
  | 'cancelled';

export type ProjectPriority = 'low' | 'medium' | 'high' | 'urgent';

/** Whether a project belongs to a client or is internal to the company. */
export type ProjectType = 'client' | 'internal';

/** How `progress` is determined. */
export type ProjectProgressMode = 'auto' | 'manual';

export type ProjectActivityType =
  | 'created'
  | 'status_change'
  | 'note'
  | 'call'
  | 'email'
  | 'meeting'
  | 'task_added'
  | 'task_completed'
  | 'task_updated'
  | 'task_deleted'
  | 'estimate_changed'
  | 'deadline_change'
  | 'team_change'
  | 'attachment'
  | 'milestone'
  | 'proposal_linked';        // 👈 NEW

// ─── Sub-document Interfaces ──────────────────────────────────────────────
export interface IProjectMilestone {
  title: string;
  description?: string;
  dueDate?: Date;
  completedAt?: Date;
  isCompleted: boolean;
}

/** Category that tasks belong to (Planning, Design, Dev, QA…). */
export interface IProjectTaskCategory {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  /** Relative weight when averaging progress across categories. */
  weight: number;
  /** Display order (ascending). */
  order: number;
}

/** Lightweight snapshot of the project's progress at a point in time. */
export interface IProjectProgressSnapshot {
  progress: number;
  totalEstimatedHours: number;
  totalActualHours: number;
  taskCount: number;
  completedTaskCount: number;
  /** 'task_added' | 'task_completed' | 'estimate_changed' | 'task_deleted' | 'manual' */
  reason: string;
  recordedAt: Date;
}

export interface IProjectActivity {
  type: ProjectActivityType;
  description: string;
  /** Free-form metadata, e.g. { from: 'planning', to: 'active' } or { taskId, taskTitle } */
  meta?: Record<string, unknown>;
  performedBy?: Types.ObjectId | null;
  performedAt: Date;
}

export interface IProjectAttachment {
  fileName: string;
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
}

// ─── Proposal-transfer types (NEW) ────────────────────────────────────────

/** A milestone copied from a proposal into the project. */
export interface IProjectTransferredMilestone {
  title: string;
  description?: string;
  dueDate?: Date;
}

/**
 * Frozen snapshot of what was transferred from an accepted proposal.
 *
 * IMPORTANT: Contains NO financial data — no line items, no pricing,
 * no discounts, no tax, no payment milestones, no bank details.
 * Only the technical + scope content + top-line budget is stored.
 */
export interface IProjectProposalSnapshot {
  /** The proposal's user-facing ID, e.g. 'PRO-00001'. */
  proposalId: string;
  /** Proposal title at transfer time. */
  title: string;
  /** Optional subtitle. */
  subtitle?: string;
  /** Proposal type at transfer time (project / service / retainer / etc.). */
  proposalType?: string;

  /** Full technical details block (no financial fields). */
  technical: {
    approach?: string;
    techStack?: string[];
    architectureSummary?: string;
    modules?: { name: string; description?: string }[];
    deliverables?: string[];
    assumptions?: string[];
    dependencies?: string[];
    outOfScope?: string[];
    testingStrategy?: string;
    supportPlan?: string;
    phases?: { phase: string; duration?: string; deliverable?: string }[];
    estimatedDurationDays?: number;
    proposedMilestones?: IProjectTransferredMilestone[];
  };

  /**
   * Content sections copied from the proposal — excluding
   * `financial_summary` and `payment_terms` (they're financial).
   */
  sections: {
    key: string;
    title: string;
    content: any;        // TipTap JSON
    plainText?: string;
    order: number;
  }[];

  /** Scope lists (also duplicated at top level for quick access). */
  deliverables?: string[];
  assumptions?: string[];
  dependencies?: string[];
  outOfScope?: string[];

  /** Milestones pulled from the proposal. */
  milestones: IProjectTransferredMilestone[];

  /**
   * Top-line budget only — the accepted total.
   * We DO NOT store line items or tax/discount breakdowns here.
   */
  budget?: number;
  currency: string;

  /** Client snapshot from the proposal (for display, no financials). */
  clientSnapshot?: {
    name: string;
    displayName?: string;
    email?: string;
    phoneNo?: string;
    address?: {
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      postalCode?: string;
      country?: string;
    };
    primaryContact?: {
      name?: string;
      designation?: string;
      email?: string;
      phoneNo?: string;
    };
  } | null;

  /** Salesperson snapshot from the proposal (for reference). */
  salespersonSnapshot?: {
    name: string;
    designation?: string;
    email?: string;
    phoneNo?: string;
  } | null;

  /** When the transfer happened. */
  transferredAt: Date;
  /** Who triggered the transfer (employee id). */
  transferredBy?: Types.ObjectId | null;
  /** Whether the transfer was automatic or manual. */
  transferMode: 'auto' | 'manual';
}

// ─── Instance-method signatures ───────────────────────────────────────────
export interface IProjectMethods {
  /**
   * Append an activity to the project's history and save.
   * Use this from controllers/services for manual events (calls, notes, etc.).
   */
  logActivity(
    type: ProjectActivityType,
    description: string,
    opts?: {
      performedBy?: Types.ObjectId | null;
      meta?: Record<string, unknown>;
    }
  ): Promise<IProject>;

  /**
   * Apply a partial patch while auto-logging the meaningful changes
   * (status, deadline, teamMembers). Returns the saved document.
   */
  applyChanges(
    patch: Partial<IProject>,
    actorId?: Types.ObjectId | null
  ): Promise<IProject>;

  /**
   * Recompute `progress` from the project's tasks.
   */
  recomputeProgressFromTasks(): Promise<IProject | null>;
}

// ─── Main Interface ───────────────────────────────────────────────────────
export interface IProject extends Document, IProjectMethods {
  _id: Types.ObjectId;
  projectId: string;

  // ── Ownership ────────────────────────────────────────────────────
  name: string;
  description?: string;

  /** Whether this is a client-facing project or an internal one. */
  projectType: ProjectType;

  /**
   * REQUIRED when `projectType === 'client'`.
   * MUST be `null` when `projectType === 'internal'`.
   */
  clientId: Types.ObjectId | null;

  /** Optional free-text department (mainly used for internal projects). */
  department?: string;

  /** Optional — the lead this project originated from (audit trail). */
  leadId?: Types.ObjectId | null;

  /** 👇 NEW — the proposal this project was generated from (if any). */
  sourceProposalId?: Types.ObjectId | null;

  /** 👇 NEW — frozen technical snapshot transferred from the proposal. */
  proposalSnapshot?: IProjectProposalSnapshot | null;

  /** The person accountable for delivery. */
  projectManager: Types.ObjectId;

  // ── Commercial ───────────────────────────────────────────────────
  budget: number;
  currency: string;
  startDate?: Date;
  deadline?: Date;
  completedAt?: Date;

  // ── Status ───────────────────────────────────────────────────────
  status: ProjectStatus;
  priority: ProjectPriority;

  /**
   * 0–100.
   * - When `progressMode === 'auto'`, recomputed from tasks on every change.
   * - When `progressMode === 'manual'`, set by the PM.
   */
  progress: number;

  /** Whether progress is derived from tasks or set by hand. */
  progressMode: ProjectProgressMode;

  // ── Task-driven aggregates (denormalized for list views) ─────────
  totalEstimatedHours: number;
  totalActualHours: number;
  totalTasks: number;
  completedTasks: number;

  /** Trend + audit of progress. Capped at PROJECT_MAX_PROGRESS_HISTORY. */
  progressHistory: IProjectProgressSnapshot[];

  // ── Task categories ──────────────────────────────────────────────
  taskCategories: IProjectTaskCategory[];

  // ── Team ─────────────────────────────────────────────────────────
  teamMembers: Types.ObjectId[];

  // ── Milestones (kept as coarse markers) ──────────────────────────
  milestones: IProjectMilestone[];

  // ── Activity ─────────────────────────────────────────────────────
  activities: IProjectActivity[];
  attachments: IProjectAttachment[];
  tags: string[];

  // ── Audit ────────────────────────────────────────────────────────
  createdBy?: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // ── Virtuals ─────────────────────────────────────────────────────
  isOverdue: boolean;
  isCompleted: boolean;
  isOpen: boolean;
  isInternal: boolean;
  isProgressAuto: boolean;
  ageInDays: number;
  daysUntilDeadline: number | null;
  lastActivityAt: Date | null;
  activityCount: number;
  taskCategoryCount: number;
  /** Estimated hours remaining (totalEstimatedHours − done-estimated). */
  remainingEstimatedHours: number;

  /** 👇 NEW — does this project have a linked proposal? */
  hasSourceProposal: boolean;

  /** 👇 NEW — was this project created from a proposal (auto or manual)? */
  cameFromProposal: boolean;
}

export interface IProjectModel extends Model<IProject, {}, IProjectMethods> {
  findActive(filter?: Record<string, any>): Promise<IProject[]>;
  findByClient(clientId: Types.ObjectId | string): Promise<IProject[]>;
  findInternal(filter?: Record<string, any>): Promise<IProject[]>;
  findOverdue(filter?: Record<string, any>): Promise<IProject[]>;
  /** 👇 NEW */
  findByProposal(proposalId: Types.ObjectId | string): Promise<IProject[]>;
}

// ─── Constants ────────────────────────────────────────────────────────────
export const PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
];

export const PROJECT_PRIORITIES: ProjectPriority[] = [
  'low',
  'medium',
  'high',
  'urgent',
];

export const PROJECT_TYPES: ProjectType[] = ['client', 'internal'];

export const PROJECT_PROGRESS_MODES: ProjectProgressMode[] = [
  'auto',
  'manual',
];

export const PROJECT_ACTIVITY_TYPES: ProjectActivityType[] = [
  'created',
  'status_change',
  'note',
  'call',
  'email',
  'meeting',
  'task_added',
  'task_completed',
  'task_updated',
  'task_deleted',
  'estimate_changed',
  'deadline_change',
  'team_change',
  'attachment',
  'milestone',
  'proposal_linked',      // 👈 NEW
];

/** Statuses that mean the project is still being worked on. */
export const OPEN_PROJECT_STATUSES: ProjectStatus[] = [
  'planning',
  'active',
  'on_hold',
];

/** Statuses that mean the project is finished (successfully or not). */
export const CLOSED_PROJECT_STATUSES: ProjectStatus[] = [
  'completed',
  'cancelled',
];

/** Suggested internal departments (free text, not enforced). */
export const PROJECT_INTERNAL_DEPARTMENTS = [
  'Engineering',
  'Marketing',
  'Sales',
  'Operations',
  'HR',
  'Finance',
  'Product',
  'Design',
  'IT',
  'Other',
] as const;

/** Suggested starting task categories for a new project. */
export const DEFAULT_PROJECT_TASK_CATEGORIES = [
  'Planning',
  'Design',
  'Development',
  'Testing',
  'Deployment',
] as const;

export const PROJECT_NAME_MAX_LENGTH = 200;
export const PROJECT_DESCRIPTION_MAX_LENGTH = 5000;
export const PROJECT_DEPARTMENT_MAX_LENGTH = 100;
export const PROJECT_ACTIVITY_DESCRIPTION_MAX_LENGTH = 2000;
export const PROJECT_MAX_ACTIVITIES = 500;
export const PROJECT_MAX_TASK_CATEGORIES = 20;
export const PROJECT_MAX_PROGRESS_HISTORY = 100;

/** 👇 NEW — sections we do NOT copy from a proposal into a project. */
export const PROPOSAL_FINANCIAL_SECTION_KEYS = [
  'financial_summary',
  'payment_terms',
  'terms_conditions', // contains payment clauses — keep out by default
] as const;

// ─── Sub-schemas ──────────────────────────────────────────────────────────
const milestoneSchema = new Schema<IProjectMilestone>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    dueDate: { type: Date },
    completedAt: { type: Date },
    isCompleted: { type: Boolean, default: false },
  },
  { _id: true }
);

const taskCategorySchema = new Schema<IProjectTaskCategory>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: { type: String, trim: true, maxlength: 500 },
    weight: { type: Number, default: 1, min: 0 },
    order: { type: Number, default: 0 },
  },
  { _id: true }
);

const progressSnapshotSchema = new Schema<IProjectProgressSnapshot>(
  {
    progress: { type: Number, required: true, min: 0, max: 100 },
    totalEstimatedHours: { type: Number, default: 0, min: 0 },
    totalActualHours: { type: Number, default: 0, min: 0 },
    taskCount: { type: Number, default: 0, min: 0 },
    completedTaskCount: { type: Number, default: 0, min: 0 },
    reason: { type: String, trim: true, maxlength: 100 },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const activitySchema = new Schema<IProjectActivity>(
  {
    type: {
      type: String,
      enum: PROJECT_ACTIVITY_TYPES,
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: PROJECT_ACTIVITY_DESCRIPTION_MAX_LENGTH,
    },
    meta: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
    performedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const attachmentSchema = new Schema<IProjectAttachment>(
  {
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    fileUrl: { type: String, required: true, trim: true, maxlength: 1000 },
    fileType: { type: String, trim: true, maxlength: 100 },
    fileSize: { type: Number, min: 0 },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// ─── Proposal snapshot sub-schema (NEW) ───────────────────────────────────
const transferredMilestoneSchema = new Schema<IProjectTransferredMilestone>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    dueDate: { type: Date },
  },
  { _id: false }
);

const proposalSnapshotSchema = new Schema<IProjectProposalSnapshot>(
  {
    proposalId:   { type: String, required: true, trim: true },
    title:        { type: String, required: true, trim: true, maxlength: 200 },
    subtitle:     { type: String, trim: true, maxlength: 300 },
    proposalType: { type: String, trim: true, maxlength: 40 },

    technical: {
      approach:            { type: String, trim: true, maxlength: 5000 },
      techStack:           { type: [String], default: [] },
      architectureSummary: { type: String, trim: true, maxlength: 5000 },
      modules: {
        type: [
          new Schema(
            {
              name:        { type: String, required: true, trim: true, maxlength: 200 },
              description: { type: String, trim: true, maxlength: 1000 },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
      deliverables:    { type: [String], default: [] },
      assumptions:     { type: [String], default: [] },
      dependencies:    { type: [String], default: [] },
      outOfScope:      { type: [String], default: [] },
      testingStrategy: { type: String, trim: true, maxlength: 3000 },
      supportPlan:     { type: String, trim: true, maxlength: 3000 },
      phases: {
        type: [
          new Schema(
            {
              phase:       { type: String, required: true, trim: true, maxlength: 200 },
              duration:    { type: String, trim: true, maxlength: 100 },
              deliverable: { type: String, trim: true, maxlength: 500 },
            },
            { _id: false }
          ),
        ],
        default: [],
      },
      estimatedDurationDays: { type: Number, min: 0 },
      proposedMilestones:    { type: [transferredMilestoneSchema], default: [] },
    },

    sections: {
      type: [
        new Schema(
          {
            key:       { type: String, required: true, trim: true, maxlength: 60 },
            title:     { type: String, required: true, trim: true, maxlength: 200 },
            content:   { type: Schema.Types.Mixed, default: {} },
            plainText: { type: String, trim: true, maxlength: 20000 },
            order:     { type: Number, default: 0 },
          },
          { _id: false }
        ),
      ],
      default: [],
    },

    deliverables: { type: [String], default: [] },
    assumptions:  { type: [String], default: [] },
    dependencies: { type: [String], default: [] },
    outOfScope:   { type: [String], default: [] },

    milestones: { type: [transferredMilestoneSchema], default: [] },

    budget:   { type: Number, min: 0 },
    currency: {
      type: String,
      default: 'PKR',
      trim: true,
      uppercase: true,
      maxlength: 3,
    },

    clientSnapshot: {
      type: new Schema(
        {
          name:        { type: String, trim: true, maxlength: 200 },
          displayName: { type: String, trim: true, maxlength: 120 },
          email:       { type: String, trim: true, lowercase: true },
          phoneNo:     { type: String, trim: true, maxlength: 30 },
          address: {
            line1:      { type: String, trim: true, maxlength: 200 },
            line2:      { type: String, trim: true, maxlength: 200 },
            city:       { type: String, trim: true, maxlength: 100 },
            state:      { type: String, trim: true, maxlength: 100 },
            postalCode: { type: String, trim: true, maxlength: 20 },
            country:    { type: String, trim: true, maxlength: 100 },
          },
          primaryContact: {
            name:        { type: String, trim: true, maxlength: 120 },
            designation: { type: String, trim: true, maxlength: 120 },
            email:       { type: String, trim: true, lowercase: true },
            phoneNo:     { type: String, trim: true, maxlength: 30 },
          },
        },
        { _id: false }
      ),
      default: null,
    },

    salespersonSnapshot: {
      type: new Schema(
        {
          name:        { type: String, trim: true, maxlength: 120 },
          designation: { type: String, trim: true, maxlength: 120 },
          email:       { type: String, trim: true, lowercase: true },
          phoneNo:     { type: String, trim: true, maxlength: 30 },
        },
        { _id: false }
      ),
      default: null,
    },

    transferredAt: { type: Date, default: Date.now },
    transferredBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
    transferMode: {
      type: String,
      enum: ['auto', 'manual'],
      default: 'auto',
      required: true,
    },
  },
  { _id: false }
);

// ─── Main Project Schema ──────────────────────────────────────────────────
const projectSchema = new Schema<
  IProject,
  IProjectModel,
  {},
  {},
  {},
  IProjectMethods
>(
  {
    projectId: { type: String, required: true, unique: true, trim: true },

    // ── Type + Ownership ─────────────────────────────────────────────
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: PROJECT_NAME_MAX_LENGTH,
    },
    description: {
      type: String,
      trim: true,
      maxlength: PROJECT_DESCRIPTION_MAX_LENGTH,
    },
    projectType: {
      type: String,
      enum: PROJECT_TYPES,
      default: 'client',
      required: true,
      index: true,
    },
    clientId: {
      type: Schema.Types.ObjectId,
      ref: 'Client',
      default: null,
      index: true,
      validate: {
        validator: function (this: any, v: Types.ObjectId | null) {
          if (this.projectType === 'client') return v != null;
          if (this.projectType === 'internal') return v == null;
          return true;
        },
        message:
          'clientId is required for client projects and must be null for internal projects',
      },
    },
    department: {
      type: String,
      trim: true,
      maxlength: PROJECT_DEPARTMENT_MAX_LENGTH,
      default: undefined,
    },
    leadId: {
      type: Schema.Types.ObjectId,
      ref: 'Lead',
      default: null,
      index: true,
    },

    // ── Proposal linkage (NEW) ───────────────────────────────────────
    sourceProposalId: {
      type: Schema.Types.ObjectId,
      ref: 'Proposal',
      default: null,
      index: true,
    },
    proposalSnapshot: {
      type: proposalSnapshotSchema,
      default: null,
    },

    projectManager: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },

    // ── Commercial ───────────────────────────────────────────────────
    budget: { type: Number, default: 0, min: 0 },
    currency: {
      type: String,
      default: 'PKR',
      trim: true,
      uppercase: true,
      maxlength: 3,
    },
    startDate: { type: Date },
    deadline: { type: Date, index: true },
    completedAt: { type: Date },

    // ── Status ───────────────────────────────────────────────────────
    status: {
      type: String,
      enum: PROJECT_STATUSES,
      default: 'planning',
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: PROJECT_PRIORITIES,
      default: 'medium',
      required: true,
    },
    progress: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
      validate: {
        validator: (v: number) => Number.isInteger(v),
        message: 'progress must be an integer between 0 and 100',
      },
    },
    progressMode: {
      type: String,
      enum: PROJECT_PROGRESS_MODES,
      default: 'auto',
      required: true,
      index: true,
    },

    // ── Task-driven aggregates ──────────────────────────────────────
    totalEstimatedHours: { type: Number, default: 0, min: 0 },
    totalActualHours: { type: Number, default: 0, min: 0 },
    totalTasks: { type: Number, default: 0, min: 0 },
    completedTasks: { type: Number, default: 0, min: 0 },

    progressHistory: {
      type: [progressSnapshotSchema],
      default: [],
    },

    // ── Task categories ─────────────────────────────────────────────
    taskCategories: {
      type: [taskCategorySchema],
      default: [],
      validate: {
        validator: (arr: IProjectTaskCategory[]) =>
          arr.length <= PROJECT_MAX_TASK_CATEGORIES,
        message: `A project can have at most ${PROJECT_MAX_TASK_CATEGORIES} task categories`,
      },
    },

    // ── Team ─────────────────────────────────────────────────────────
    teamMembers: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Employee' }],
      default: [],
      validate: {
        validator: (arr: Types.ObjectId[]) => arr.length <= 50,
        message: 'A project can have at most 50 team members',
      },
    },

    // ── Milestones ───────────────────────────────────────────────────
    milestones: { type: [milestoneSchema], default: [] },

    // ── Activity ─────────────────────────────────────────────────────
    activities: { type: [activitySchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.length <= 20,
        message: 'A project can have at most 20 tags',
      },
    },

    // ── Audit ────────────────────────────────────────────────────────
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
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────
projectSchema.index({ status: 1, isDeleted: 1 });
projectSchema.index({ projectType: 1, isDeleted: 1 });
projectSchema.index({ progressMode: 1, isDeleted: 1 });
projectSchema.index({ clientId: 1, status: 1, isDeleted: 1 });
projectSchema.index({ clientId: 1, isDeleted: 1, createdAt: -1 });
projectSchema.index({ department: 1, isDeleted: 1 });
projectSchema.index({ projectManager: 1, status: 1 });
projectSchema.index({ teamMembers: 1, status: 1 });
projectSchema.index({ priority: 1, status: 1 });
projectSchema.index({ deadline: 1, status: 1 });
projectSchema.index({ sourceProposalId: 1, isDeleted: 1 });  // 👈 NEW
projectSchema.index({ createdAt: -1 });
projectSchema.index(
  { name: 'text', description: 'text' },
  { name: 'project_text_search' }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────
projectSchema.virtual('isOpen').get(function () {
  return OPEN_PROJECT_STATUSES.includes(this.status as ProjectStatus);
});

projectSchema.virtual('isCompleted').get(function () {
  return this.status === 'completed';
});

projectSchema.virtual('isInternal').get(function () {
  return this.projectType === 'internal';
});

projectSchema.virtual('isProgressAuto').get(function () {
  return this.progressMode === 'auto';
});

projectSchema.virtual('isOverdue').get(function () {
  if (!this.deadline) return false;
  if (!OPEN_PROJECT_STATUSES.includes(this.status as ProjectStatus)) return false;
  return (this.deadline as Date).getTime() < Date.now();
});

projectSchema.virtual('ageInDays').get(function () {
  if (!this.createdAt) return 0;
  return Math.floor(
    (Date.now() - (this.createdAt as Date).getTime()) / 86_400_000
  );
});

projectSchema.virtual('daysUntilDeadline').get(function () {
  if (!this.deadline) return null;
  return Math.ceil(
    ((this.deadline as Date).getTime() - Date.now()) / 86_400_000
  );
});

projectSchema.virtual('activityCount').get(function () {
  return this.activities?.length ?? 0;
});

projectSchema.virtual('lastActivityAt').get(function () {
  if (!this.activities?.length) return null;
  let latest: Date | null = null;
  for (const a of this.activities) {
    if (!latest || a.performedAt > latest) latest = a.performedAt;
  }
  return latest;
});

projectSchema.virtual('taskCategoryCount').get(function () {
  return this.taskCategories?.length ?? 0;
});

projectSchema.virtual('remainingEstimatedHours').get(function () {
  const total = this.totalEstimatedHours ?? 0;
  const done = this.completedTasks ?? 0;
  if (!total) return 0;
  return Math.max(0, total - done);
});

/** NEW — does this project have an originating proposal? */
projectSchema.virtual('hasSourceProposal').get(function () {
  return !!this.sourceProposalId;
});

/** NEW — was this project generated from a proposal? */
projectSchema.virtual('cameFromProposal').get(function () {
  return !!this.sourceProposalId || !!this.proposalSnapshot;
});

// ─── Auto-generate projectId ──────────────────────────────────────────────
projectSchema.pre('validate', async function () {
  if (this.isNew && !this.projectId) {
    const seq = await Counter.next('projectId');
    this.projectId = `PRJ-${String(seq).padStart(5, '0')}`;
  }
});

// ─── Pre-save lifecycle hooks (safe / deterministic only) ─────────────────
projectSchema.pre('save', function () {
  // ── First-time activity ─────────────────────────────────────────
  if (this.isNew && this.activities.length === 0) {
    this.activities.push({
      type: 'created',
      description: `Project "${this.name}" created`,
      performedBy: this.createdBy ?? null,
      performedAt: new Date(),
    } as IProjectActivity);
  }

  // ── Log proposal linkage on first save (NEW) ────────────────────
  if (
    this.isNew &&
    this.sourceProposalId &&
    !this.activities.some((a) => a.type === 'proposal_linked')
  ) {
    this.activities.push({
      type: 'proposal_linked',
      description: `Created from proposal ${this.proposalSnapshot?.proposalId ?? this.sourceProposalId}`,
      meta: {
        proposalId: this.sourceProposalId,
        proposalNumber: this.proposalSnapshot?.proposalId ?? null,
        transferMode: this.proposalSnapshot?.transferMode ?? 'auto',
      },
      performedBy: this.createdBy ?? null,
      performedAt: new Date(),
    } as IProjectActivity);
  }

  // ── Completion timestamp (derived from status) ──────────────────
  if (this.status === 'completed' && !this.completedAt) {
    this.completedAt = new Date();
  }
  if (this.status !== 'completed' && this.completedAt) {
    this.completedAt = undefined;
  }

  // ── Cap activities array to avoid unbounded growth ──────────────
  if (this.activities.length > PROJECT_MAX_ACTIVITIES) {
    this.activities = this.activities.slice(-PROJECT_MAX_ACTIVITIES);
  }

  // ── Cap progress history ────────────────────────────────────────
  if (this.progressHistory.length > PROJECT_MAX_PROGRESS_HISTORY) {
    this.progressHistory = this.progressHistory.slice(
      -PROJECT_MAX_PROGRESS_HISTORY
    );
  }

  // ── Soft delete ─────────────────────────────────────────────────
  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
});

// ─── Instance methods ─────────────────────────────────────────────────────
projectSchema.methods.logActivity = function (
  type: ProjectActivityType,
  description: string,
  opts: {
    performedBy?: Types.ObjectId | null;
    meta?: Record<string, unknown>;
  } = {}
): Promise<IProject> {
  this.activities.push({
    type,
    description,
    meta: opts.meta,
    performedBy: opts.performedBy ?? null,
    performedAt: new Date(),
  } as IProjectActivity);

  if (this.activities.length > PROJECT_MAX_ACTIVITIES) {
    this.activities = this.activities.slice(-PROJECT_MAX_ACTIVITIES);
  }

  return this.save() as unknown as Promise<IProject>;
};

projectSchema.methods.applyChanges = function (
  patch: Partial<IProject>,
  actorId?: Types.ObjectId | null
): Promise<IProject> {
  const performer = actorId ?? this.createdBy ?? null;

  // ── Status change ───────────────────────────────────────────────
  if (patch.status !== undefined && patch.status !== this.status) {
    const from = this.status;
    const to = patch.status;
    this.activities.push({
      type: 'status_change',
      description: `Status changed from "${from}" to "${to}"`,
      meta: { from, to },
      performedBy: performer,
      performedAt: new Date(),
    } as IProjectActivity);
    this.status = to;
  }

  // ── Deadline change ─────────────────────────────────────────────
  if (patch.deadline !== undefined) {
    const prevMs = this.deadline?.getTime() ?? null;
    const nextMs = patch.deadline?.getTime() ?? null;
    if (prevMs !== nextMs) {
      const prevIso = this.deadline?.toISOString().slice(0, 10) ?? null;
      const nextIso = patch.deadline?.toISOString().slice(0, 10) ?? null;
      this.activities.push({
        type: 'deadline_change',
        description: prevIso
          ? `Deadline moved from ${prevIso} to ${nextIso ?? 'none'}`
          : `Deadline set to ${nextIso ?? 'none'}`,
        meta: { from: this.deadline ?? null, to: patch.deadline ?? null },
        performedBy: performer,
        performedAt: new Date(),
      } as IProjectActivity);
      this.deadline = patch.deadline;
    }
  }

  // ── Team changes ────────────────────────────────────────────────
  if (patch.teamMembers !== undefined) {
    const prev = this.teamMembers ?? [];
    const curr = patch.teamMembers;
    const added = curr.filter(
      (id) => !prev.some((p: Types.ObjectId) => p.equals(id))
    );
    const removed = prev.filter(
      (id: Types.ObjectId) => !curr.some((c) => c.equals(id))
    );
    if (added.length || removed.length) {
      this.activities.push({
        type: 'team_change',
        description: `Team updated — ${added.length} added, ${removed.length} removed`,
        meta: { added, removed },
        performedBy: performer,
        performedAt: new Date(),
      } as IProjectActivity);
      this.teamMembers = curr;
    }
  }

  // ── Simple scalar fields (no activity logging) ──────────────────
  const handled = new Set<string>(['status', 'deadline', 'teamMembers']);
  for (const key of Object.keys(patch) as (keyof IProject)[]) {
    if (handled.has(key as string)) continue;
    const value = patch[key];
    if (value !== undefined) {
      (this as any)[key] = value;
    }
  }

  // Cap and save
  if (this.activities.length > PROJECT_MAX_ACTIVITIES) {
    this.activities = this.activities.slice(-PROJECT_MAX_ACTIVITIES);
  }
  if (this.progressHistory.length > PROJECT_MAX_PROGRESS_HISTORY) {
    this.progressHistory = this.progressHistory.slice(
      -PROJECT_MAX_PROGRESS_HISTORY
    );
  }

  return this.save() as unknown as Promise<IProject>;
};

/**
 * Recompute progress from the project's tasks.
 *
 * Formula (hours-based):
 *   progress = Σ(done.estimatedHours) / Σ(all non-cancelled.estimatedHours) × 100
 */
projectSchema.methods.recomputeProgressFromTasks = async function (): Promise<IProject | null> {
  if (this.progressMode === 'manual') return null;

  let Task: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Task = require('./task').default;
  } catch {
    return null;
  }
  if (!Task) return null;

  const tasks = await Task.find({
    projectId: this._id,
    isDeleted: false,
    status: { $ne: 'cancelled' },
  })
    .select('estimatedHours status')
    .lean();

  if (tasks.length === 0) {
    return this as unknown as IProject;
  }

  let totalEstimate = 0;
  let doneEstimate = 0;
  let completedCount = 0;

  for (const t of tasks as any[]) {
    const est = Number(t.estimatedHours) || 0;
    totalEstimate += est;
    if (t.status === 'done') {
      doneEstimate += est;
      completedCount += 1;
    }
  }

  const newProgress =
    totalEstimate > 0
      ? Math.round((doneEstimate / totalEstimate) * 100)
      : 0;

  const previousProgress = this.progress;
  const previousSnapshot =
    this.progressHistory[this.progressHistory.length - 1];
  const lastAt = previousSnapshot?.recordedAt?.getTime?.() ?? 0;
  const changed = newProgress !== previousProgress;
  const dayPassed = Date.now() - lastAt > 24 * 60 * 60 * 1000;

  this.progress = newProgress;
  this.totalEstimatedHours = totalEstimate;
  this.totalActualHours = (tasks as any[]).reduce(
    (s, t) => s + (Number(t.actualHours) || 0),
    0
  );
  this.totalTasks = tasks.length;
  this.completedTasks = completedCount;

  if (changed || dayPassed) {
    this.progressHistory.push({
      progress: newProgress,
      totalEstimatedHours: totalEstimate,
      totalActualHours: this.totalActualHours,
      taskCount: tasks.length,
      completedTaskCount: completedCount,
      reason: 'task_sync',
      recordedAt: new Date(),
    } as IProjectProgressSnapshot);
  }

  if (this.progressHistory.length > PROJECT_MAX_PROGRESS_HISTORY) {
    this.progressHistory = this.progressHistory.slice(
      -PROJECT_MAX_PROGRESS_HISTORY
    );
  }

  await this.save();
  return this as unknown as IProject;
};

// ─── Statics ──────────────────────────────────────────────────────────────
projectSchema.statics.findActive = function (
  filter: Record<string, any> = {}
) {
  return this.find({ ...filter, status: 'active', isDeleted: false });
};

projectSchema.statics.findByClient = function (
  clientId: Types.ObjectId | string
) {
  return this.find({
    clientId,
    projectType: 'client',
    isDeleted: false,
  }).sort({ createdAt: -1 });
};

projectSchema.statics.findInternal = function (
  filter: Record<string, any> = {}
) {
  return this.find({
    ...filter,
    projectType: 'internal',
    isDeleted: false,
  }).sort({ createdAt: -1 });
};

projectSchema.statics.findOverdue = function (
  filter: Record<string, any> = {}
) {
  return this.find({
    ...filter,
    status: { $in: OPEN_PROJECT_STATUSES },
    isDeleted: false,
    deadline: { $lt: new Date() },
  });
};

/** NEW — find all projects generated from a specific proposal. */
projectSchema.statics.findByProposal = function (
  proposalId: Types.ObjectId | string
) {
  return this.find({
    sourceProposalId: proposalId,
    isDeleted: false,
  }).sort({ createdAt: -1 });
};

// ─── Model export ─────────────────────────────────────────────────────────
const Project =
  (mongoose.models.Project as unknown as IProjectModel) ||
  mongoose.model<IProject, IProjectModel>('Project', projectSchema);

export default Project;