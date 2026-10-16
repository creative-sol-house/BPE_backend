// model/task.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Counter from './counter';

// ─── Enums & Types ────────────────────────────────────────────────────────
export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'blocked'
  | 'done'
  | 'cancelled';

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type TaskActivityType =
  | 'created'
  | 'status_change'
  | 'assigned'
  | 'reassigned'
  | 'estimate_changed'
  | 'hours_logged'
  | 'due_date_change'
  | 'priority_change'
  | 'category_change'
  | 'note'
  | 'comment'
  | 'attachment';

// ─── Sub-document Interfaces ──────────────────────────────────────────────
//
// NOTE: `_id` is optional on sub-documents. Mongoose auto-generates it when
// the parent doc is saved, so requiring it here would force every `push({})`
// call to invent one. Making it optional keeps both the runtime and the
// type-checker happy.

export interface ITimeEntry {
  _id?: Types.ObjectId;
  hours: number;
  note?: string;
  loggedBy: Types.ObjectId;
  loggedAt: Date;
  /** Date the work was actually performed (may differ from loggedAt). */
  workDate?: Date;
}

export interface ITaskEstimateChange {
  _id?: Types.ObjectId;
  fromHours: number;
  toHours: number;
  reason?: string;
  changedBy: Types.ObjectId;
  changedAt: Date;
}

export interface ITaskComment {
  _id?: Types.ObjectId;
  body: string;
  author: Types.ObjectId;
  createdAt: Date;
}

export interface ITaskAttachment {
  _id?: Types.ObjectId;
  fileName: string;
  fileUrl: string;
  fileType?: string;
  fileSize?: number;
  uploadedBy?: Types.ObjectId | null;
  uploadedAt: Date;
}

export interface ITaskActivity {
  _id?: Types.ObjectId;
  type: TaskActivityType;
  description: string;
  meta?: Record<string, unknown>;
  performedBy?: Types.ObjectId | null;
  performedAt: Date;
}

// ─── Instance-method signatures ───────────────────────────────────────────
export interface ITaskMethods {
  /** Log hours worked on the task. Recomputes `actualHours`. */
  logTime(
    hours: number,
    opts?: {
      note?: string;
      loggedBy?: Types.ObjectId | null;
      workDate?: Date;
    }
  ): Promise<ITask>;

  /** Change the estimate. Records the change in `estimateHistory`. */
  changeEstimate(
    newHours: number,
    opts?: {
      reason?: string;
      changedBy?: Types.ObjectId | null;
    }
  ): Promise<ITask>;

  /** Append an activity and save. */
  logActivity(
    type: TaskActivityType,
    description: string,
    opts?: {
      performedBy?: Types.ObjectId | null;
      meta?: Record<string, unknown>;
    }
  ): Promise<ITask>;

  /** Transition to a new status, auto-logging and timestamping. */
  setStatus(
    status: TaskStatus,
    actorId?: Types.ObjectId | null,
    notes?: string
  ): Promise<ITask>;
}

// ─── Main Interface ───────────────────────────────────────────────────────
export interface ITask extends Document, ITaskMethods {
  _id: Types.ObjectId;
  taskId: string;

  // ── Ownership ────────────────────────────────────────────────────
  /**
   * The project this task belongs to.
   * `null` for "internal" tasks that aren't tied to any project.
   */
  projectId: Types.ObjectId | null;

  /**
   * Category within the project.
   * Always `null` when `projectId` is `null`.
   * Not a `ref` — categories live inside the project document.
   */
  categoryId: Types.ObjectId | null;

  title: string;
  description?: string;

  // ── Assignment ───────────────────────────────────────────────────
  assignedTo: Types.ObjectId | null;
  assignedBy: Types.ObjectId;
  assignedAt?: Date;

  // ── Timing ───────────────────────────────────────────────────────
  estimatedHours: number;
  actualHours: number;
  timeEntries: ITimeEntry[];
  estimateHistory: ITaskEstimateChange[];

  // ── Schedule ─────────────────────────────────────────────────────
  startDate?: Date;
  dueDate?: Date;
  startedAt?: Date;
  completedAt?: Date;

  // ── Status ───────────────────────────────────────────────────────
  status: TaskStatus;
  priority: TaskPriority;
  progress: number; // 0–100, manual % within the task

  // ── Hierarchy ────────────────────────────────────────────────────
  parentTaskId?: Types.ObjectId | null;
  dependsOn: Types.ObjectId[];

  // ── Content ──────────────────────────────────────────────────────
  comments: ITaskComment[];
  attachments: ITaskAttachment[];
  activities: ITaskActivity[];
  tags: string[];

  // ── Audit ────────────────────────────────────────────────────────
  createdBy?: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // ── Virtuals ─────────────────────────────────────────────────────
  isDone: boolean;
  isOverdue: boolean;
  isActive: boolean;
  isInternal: boolean;
  daysUntilDue: number | null;
  hoursVariance: number; // actual − estimated
  hoursVariancePercent: number;
}

export interface ITaskModel extends Model<ITask, {}, ITaskMethods> {
  findByProject(
    projectId: Types.ObjectId | string,
    filter?: Record<string, any>
  ): Promise<ITask[]>;
  findByAssignee(userId: Types.ObjectId | string): Promise<ITask[]>;
  findOverdue(filter?: Record<string, any>): Promise<ITask[]>;
  findOpen(filter?: Record<string, any>): Promise<ITask[]>;
  findInternal(filter?: Record<string, any>): Promise<ITask[]>;
}

// ─── Constants ────────────────────────────────────────────────────────────
export const TASK_STATUSES: TaskStatus[] = [
  'todo',
  'in_progress',
  'review',
  'blocked',
  'done',
  'cancelled',
];

export const TASK_PRIORITIES: TaskPriority[] = [
  'low',
  'medium',
  'high',
  'urgent',
];

export const TASK_ACTIVITY_TYPES: TaskActivityType[] = [
  'created',
  'status_change',
  'assigned',
  'reassigned',
  'estimate_changed',
  'hours_logged',
  'due_date_change',
  'priority_change',
  'category_change',
  'note',
  'comment',
  'attachment',
];

/** Statuses considered "open" (still being worked on). */
export const OPEN_TASK_STATUSES: TaskStatus[] = [
  'todo',
  'in_progress',
  'review',
  'blocked',
];

/** Terminal statuses. */
export const CLOSED_TASK_STATUSES: TaskStatus[] = ['done', 'cancelled'];

export const TASK_TITLE_MAX_LENGTH = 250;
export const TASK_DESCRIPTION_MAX_LENGTH = 10000;
export const TASK_ACTIVITY_DESCRIPTION_MAX_LENGTH = 2000;
export const TASK_COMMENT_MAX_LENGTH = 5000;
export const TASK_MAX_ACTIVITIES = 500;
export const TASK_MAX_TIME_ENTRIES = 2000;
export const TASK_MAX_ESTIMATE_HISTORY = 100;
export const TASK_MAX_COMMENTS = 1000;

// ─── Sub-schemas ──────────────────────────────────────────────────────────
const timeEntrySchema = new Schema<ITimeEntry>(
  {
    hours: { type: Number, required: true, min: 0 },
    note: { type: String, trim: true, maxlength: 1000 },
    loggedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    loggedAt: { type: Date, default: Date.now },
    workDate: { type: Date },
  },
  { _id: true }
);

const estimateChangeSchema = new Schema<ITaskEstimateChange>(
  {
    fromHours: { type: Number, required: true, min: 0 },
    toHours: { type: Number, required: true, min: 0 },
    reason: { type: String, trim: true, maxlength: 500 },
    changedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    changedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const commentSchema = new Schema<ITaskComment>(
  {
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: TASK_COMMENT_MAX_LENGTH,
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const attachmentSchema = new Schema<ITaskAttachment>(
  {
    fileName: { type: String, required: true, trim: true, maxlength: 255 },
    fileUrl: { type: String, required: true, trim: true, maxlength: 1000 },
    fileType: { type: String, trim: true, maxlength: 100 },
    fileSize: { type: Number, min: 0 },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const activitySchema = new Schema<ITaskActivity>(
  {
    type: {
      type: String,
      enum: TASK_ACTIVITY_TYPES,
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: TASK_ACTIVITY_DESCRIPTION_MAX_LENGTH,
    },
    meta: { type: Schema.Types.Mixed, default: undefined },
    performedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
    performedAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// ─── Main Task Schema ─────────────────────────────────────────────────────
//
// NOTE on generics: Mongoose 7/8 wants up to 6 generics in this order:
//   1. DocType           — the interface
//   2. TModelType        — the model interface
//   3. TInstanceMethods  — instance-method signatures
//   4. TQueryHelpers     — (leave as {})
//   5. TVirtuals         — (leave as {})
//   6. TSchemaOptions    — (leave default)
// Using `<ITask, ITaskModel, {}, {}, {}, ITaskMethods>` keeps the
// `this` context correct in validators/methods and prevents the
// "property does not exist on type IfAny<...>" cascade.
//
const taskSchema = new Schema<
  ITask,
  ITaskModel,
  {},
  {},
  {},
  ITaskMethods
>(
  {
    taskId: { type: String, required: true, unique: true, trim: true },

    // ── Ownership ───────────────────────────────────────────────────
    //
    // `projectId` is optional. When `null`, the task is "internal" —
    // an ad-hoc item that doesn't belong to any project.
    projectId: {
      type: Schema.Types.ObjectId,
      ref: 'Project',
      default: null,
      index: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      default: null,
      index: true,
      // Not a ref — categories live inside the project document.
      // Must be `null` when `projectId` is `null`.
      validate: {
        validator: function (this: any, v: Types.ObjectId | null) {
          // If the task has no project, it must have no category.
          if (!this.projectId) return v == null;
          return true;
        },
        message: 'Internal tasks cannot have a category',
      },
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: TASK_TITLE_MAX_LENGTH,
    },
    description: {
      type: String,
      trim: true,
      maxlength: TASK_DESCRIPTION_MAX_LENGTH,
    },

    // ── Assignment ──────────────────────────────────────────────────
    assignedTo: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
      index: true,
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
      index: true,
    },
    assignedAt: { type: Date },

    // ── Time tracking ───────────────────────────────────────────────
    estimatedHours: { type: Number, default: 0, min: 0 },
    actualHours: { type: Number, default: 0, min: 0 },
    timeEntries: { type: [timeEntrySchema], default: [] },
    estimateHistory: { type: [estimateChangeSchema], default: [] },

    // ── Schedule ────────────────────────────────────────────────────
    startDate: { type: Date },
    dueDate: { type: Date, index: true },
    startedAt: { type: Date },
    completedAt: { type: Date },

    // ── Status ──────────────────────────────────────────────────────
    status: {
      type: String,
      enum: TASK_STATUSES,
      default: 'todo',
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: TASK_PRIORITIES,
      default: 'medium',
      required: true,
      index: true,
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

    // ── Hierarchy ───────────────────────────────────────────────────
    parentTaskId: {
      type: Schema.Types.ObjectId,
      ref: 'Task',
      default: null,
      index: true,
    },
    dependsOn: {
      type: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
      default: [],
    },

    // ── Content ─────────────────────────────────────────────────────
    comments: { type: [commentSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },
    activities: { type: [activitySchema], default: [] },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.length <= 20,
        message: 'A task can have at most 20 tags',
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
    toJSON: { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────
taskSchema.index({ projectId: 1, status: 1, isDeleted: 1 });
taskSchema.index({ projectId: 1, categoryId: 1, isDeleted: 1 });
taskSchema.index({ projectId: 1, assignedTo: 1, isDeleted: 1 });
taskSchema.index({ assignedTo: 1, status: 1, isDeleted: 1 });
taskSchema.index({ dueDate: 1, status: 1 });
taskSchema.index({ priority: 1, status: 1 });
taskSchema.index({ createdAt: -1 });
// Fast lookup of internal-only tasks
taskSchema.index({ projectId: 1, createdAt: -1 });
taskSchema.index(
  { title: 'text', description: 'text', tags: 'text' },
  { name: 'task_text_search' }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────
taskSchema.virtual('isDone').get(function () {
  return this.status === 'done';
});

taskSchema.virtual('isActive').get(function () {
  return OPEN_TASK_STATUSES.includes(this.status as TaskStatus);
});

taskSchema.virtual('isOverdue').get(function () {
  if (!this.dueDate) return false;
  if (!OPEN_TASK_STATUSES.includes(this.status as TaskStatus)) return false;
  return (this.dueDate as Date).getTime() < Date.now();
});

taskSchema.virtual('isInternal').get(function () {
  return !this.projectId;
});

taskSchema.virtual('daysUntilDue').get(function () {
  if (!this.dueDate) return null;
  return Math.ceil(
    ((this.dueDate as Date).getTime() - Date.now()) / 86_400_000
  );
});

taskSchema.virtual('hoursVariance').get(function () {
  return (this.actualHours ?? 0) - (this.estimatedHours ?? 0);
});

taskSchema.virtual('hoursVariancePercent').get(function () {
  const est = this.estimatedHours ?? 0;
  if (est === 0) return 0;
  return Math.round((((this.actualHours ?? 0) - est) / est) * 100);
});

// ─── Auto-generate taskId ─────────────────────────────────────────────────
taskSchema.pre('validate', async function () {
  if (this.isNew && !this.taskId) {
    const seq = await Counter.next('taskId');
    this.taskId = `TSK-${String(seq).padStart(5, '0')}`;
  }
});

// ─── Pre-save lifecycle hooks ─────────────────────────────────────────────
taskSchema.pre('save', function () {
  // ── Category guard ──────────────────────────────────────────────
  // If the task has no project, it must not have a category.
  if (!this.projectId && this.categoryId) {
    this.categoryId = null;
  }

  // ── First-time activity ─────────────────────────────────────────
  if (this.isNew && this.activities.length === 0) {
    this.activities.push({
      type: 'created',
      description: this.projectId
        ? `Task "${this.title}" created`
        : `Internal task "${this.title}" created`,
      performedBy: this.createdBy ?? null,
      performedAt: new Date(),
    } as ITaskActivity);
  }

  // ── Assignment timestamp ────────────────────────────────────────
  if (this.isModified('assignedTo') && this.assignedTo && !this.assignedAt) {
    this.assignedAt = new Date();
  }

  // ── Started/completed timestamps ────────────────────────────────
  if (
    this.isModified('status') &&
    this.status === 'in_progress' &&
    !this.startedAt
  ) {
    this.startedAt = new Date();
  }
  if (this.isModified('status') && this.status === 'done') {
    if (!this.completedAt) this.completedAt = new Date();
    // Done → snap progress to 100
    this.progress = 100;
  }
  if (this.isModified('status') && this.status !== 'done' && this.completedAt) {
    this.completedAt = undefined;
  }

  // ── Recompute actual hours from time entries ────────────────────
  if (this.isModified('timeEntries')) {
    this.actualHours = this.timeEntries.reduce(
      (sum, e) => sum + (Number(e.hours) || 0),
      0
    );
  }

  // ── Cap arrays to keep documents bounded ────────────────────────
  if (this.activities.length > TASK_MAX_ACTIVITIES) {
    this.activities = this.activities.slice(-TASK_MAX_ACTIVITIES);
  }
  if (this.timeEntries.length > TASK_MAX_TIME_ENTRIES) {
    this.timeEntries = this.timeEntries.slice(-TASK_MAX_TIME_ENTRIES);
  }
  if (this.estimateHistory.length > TASK_MAX_ESTIMATE_HISTORY) {
    this.estimateHistory = this.estimateHistory.slice(
      -TASK_MAX_ESTIMATE_HISTORY
    );
  }
  if (this.comments.length > TASK_MAX_COMMENTS) {
    this.comments = this.comments.slice(-TASK_MAX_COMMENTS);
  }

  // ── Soft delete ─────────────────────────────────────────────────
  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
});

// ─── Post-save: recompute the parent project's progress ───────────────────
/**
 * After every task save we trigger a project progress recompute — but ONLY
 * when the task belongs to a project. Internal tasks skip this step.
 *
 * Failures are logged but do not break the task save — the recompute can
 * always be triggered manually from the project detail page.
 */
taskSchema.post('save', async function (doc) {
  if (!doc?.projectId) return;
  try {
    const Project = (await import('./project')).default;
    const project = await Project.findById(doc.projectId);
    if (
      project &&
      typeof (project as any).recomputeProgressFromTasks === 'function'
    ) {
      await (project as any).recomputeProgressFromTasks();
    }
  } catch (err) {
    console.error('task post-save project recompute failed:', err);
  }
});

// ─── Post-delete: recompute the parent project's progress ─────────────────
taskSchema.post('findOneAndDelete', async function (doc) {
  if (!doc?.projectId) return;
  try {
    const Project = (await import('./project')).default;
    const project = await Project.findById(doc.projectId);
    if (
      project &&
      typeof (project as any).recomputeProgressFromTasks === 'function'
    ) {
      await (project as any).recomputeProgressFromTasks();
    }
  } catch (err) {
    console.error('task post-findOneAndDelete project recompute failed:', err);
  }
});

// ─── Instance methods ─────────────────────────────────────────────────────
taskSchema.methods.logActivity = function (
  type: TaskActivityType,
  description: string,
  opts: {
    performedBy?: Types.ObjectId | null;
    meta?: Record<string, unknown>;
  } = {}
): Promise<ITask> {
  this.activities.push({
    type,
    description,
    meta: opts.meta,
    performedBy: opts.performedBy ?? null,
    performedAt: new Date(),
  } as ITaskActivity);

  if (this.activities.length > TASK_MAX_ACTIVITIES) {
    this.activities = this.activities.slice(-TASK_MAX_ACTIVITIES);
  }

  return this.save() as unknown as Promise<ITask>;
};

taskSchema.methods.logTime = function (
  hours: number,
  opts: {
    note?: string;
    loggedBy?: Types.ObjectId | null;
    workDate?: Date;
  } = {}
): Promise<ITask> {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) {
    return Promise.reject(new Error('hours must be a positive number'));
  }

  this.timeEntries.push({
    hours: h,
    note: opts.note,
    loggedBy: (opts.loggedBy ??
      this.assignedTo ??
      this.assignedBy) as Types.ObjectId,
    loggedAt: new Date(),
    workDate: opts.workDate,
  } as ITimeEntry);

  this.actualHours = this.timeEntries.reduce(
    (sum: number, e: { hours: any; }) => sum + (Number(e.hours) || 0),
    0
  );

  this.activities.push({
    type: 'hours_logged',
    description: `Logged ${h}h${opts.note ? ` — ${opts.note}` : ''}`,
    meta: { hours: h },
    performedBy: opts.loggedBy ?? null,
    performedAt: new Date(),
  } as ITaskActivity);

  return this.save() as unknown as Promise<ITask>;
};

taskSchema.methods.changeEstimate = function (
  newHours: number,
  opts: {
    reason?: string;
    changedBy?: Types.ObjectId | null;
  } = {}
): Promise<ITask> {
  const h = Number(newHours);
  if (!Number.isFinite(h) || h < 0) {
    return Promise.reject(new Error('estimatedHours must be >= 0'));
  }

  const from = this.estimatedHours ?? 0;
  if (from === h) return Promise.resolve(this as unknown as ITask);

  this.estimateHistory.push({
    fromHours: from,
    toHours: h,
    reason: opts.reason,
    changedBy: (opts.changedBy ?? this.assignedBy) as Types.ObjectId,
    changedAt: new Date(),
  } as ITaskEstimateChange);

  this.estimatedHours = h;

  this.activities.push({
    type: 'estimate_changed',
    description: `Estimate changed from ${from}h to ${h}h${
      opts.reason ? ` — ${opts.reason}` : ''
    }`,
    meta: { from, to: h },
    performedBy: opts.changedBy ?? null,
    performedAt: new Date(),
  } as ITaskActivity);

  return this.save() as unknown as Promise<ITask>;
};

taskSchema.methods.setStatus = function (
  status: TaskStatus,
  actorId?: Types.ObjectId | null,
  notes?: string
): Promise<ITask> {
  const previous = this.status;
  if (previous === status) return Promise.resolve(this as unknown as ITask);

  this.status = status;

  this.activities.push({
    type: 'status_change',
    description:
      `Status changed from "${previous}" to "${status}"` +
      (notes ? ` — ${notes}` : ''),
    meta: { from: previous, to: status },
    performedBy: actorId ?? null,
    performedAt: new Date(),
  } as ITaskActivity);

  return this.save() as unknown as Promise<ITask>;
};

// ─── Statics ──────────────────────────────────────────────────────────────
taskSchema.statics.findByProject = function (
  projectId: Types.ObjectId | string,
  filter: Record<string, any> = {}
) {
  return this.find({
    ...filter,
    projectId,
    isDeleted: false,
  }).sort('order createdAt');
};

taskSchema.statics.findByAssignee = function (
  userId: Types.ObjectId | string
) {
  return this.find({
    assignedTo: userId,
    isDeleted: false,
  }).sort('-createdAt');
};

taskSchema.statics.findOverdue = function (
  filter: Record<string, any> = {}
) {
  return this.find({
    ...filter,
    isDeleted: false,
    status: { $in: OPEN_TASK_STATUSES },
    dueDate: { $lt: new Date() },
  });
};

taskSchema.statics.findOpen = function (filter: Record<string, any> = {}) {
  return this.find({
    ...filter,
    isDeleted: false,
    status: { $in: OPEN_TASK_STATUSES },
  });
};

taskSchema.statics.findInternal = function (
  filter: Record<string, any> = {}
) {
  return this.find({
    ...filter,
    projectId: null,
    isDeleted: false,
  }).sort('-createdAt');
};

// ─── Model export ─────────────────────────────────────────────────────────
const Task =
  (mongoose.models.Task as unknown as ITaskModel) ||
  mongoose.model<ITask, ITaskModel>('Task', taskSchema);

export default Task;