// controller/taskController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Task, {
  TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_ACTIVITY_TYPES,
  OPEN_TASK_STATUSES,
  type TaskStatus,
  type TaskPriority,
} from '../model/task';
import Project from '../model/project';
import Employee from '../model/employee';
import { AuthRequest } from '../middleware/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Lookup by _id or "TSK-XXXXX". */
function buildLookupQuery(idStr: string, onlyActive = true) {
  const base: any = mongoose.Types.ObjectId.isValid(idStr)
    ? { _id: idStr }
    : { taskId: idStr };
  if (onlyActive) base.isDeleted = false;
  return base;
}

/**
 * Validate and resolve a projectId to a real project.
 * When `projectId` is null/undefined/empty, returns `{ ok: true, projectId: null }`
 * so callers can create internal tasks with no project.
 */
async function resolveProject(
  projectId: unknown
): Promise<{
  ok: boolean;
  error?: string;
  projectId?: mongoose.Types.ObjectId | null;
  project?: any;
}> {
  if (
    projectId === undefined ||
    projectId === null ||
    projectId === ''
  ) {
    return { ok: true, projectId: null };
  }
  const s = String(projectId);
  if (!mongoose.Types.ObjectId.isValid(s)) {
    return { ok: false, error: 'Invalid projectId' };
  }
  const p = await Project.findOne({ _id: s, isDeleted: false }).select(
    '_id taskCategories projectManager teamMembers'
  );
  if (!p) return { ok: false, error: 'Project not found' };
  return { ok: true, projectId: p._id, project: p };
}

/**
 * Validate that categoryId belongs to the given project (or is null).
 * If `projectId` is null, the only valid value for categoryId is null/empty.
 */
async function resolveCategoryForProject(
  projectId: mongoose.Types.ObjectId | null,
  categoryId: unknown
): Promise<
  | { ok: true; categoryId: mongoose.Types.ObjectId | null }
  | { ok: false; error: string }
> {
  const isEmpty =
    categoryId === undefined || categoryId === null || categoryId === '';

  // No project → category must be empty
  if (!projectId) {
    if (!isEmpty) {
      return {
        ok: false,
        error: 'Internal tasks cannot have a category',
      };
    }
    return { ok: true, categoryId: null };
  }

  // Project present → optional category that must belong to that project
  if (isEmpty) {
    return { ok: true, categoryId: null };
  }

  const s = String(categoryId);
  if (!mongoose.Types.ObjectId.isValid(s)) {
    return { ok: false, error: 'Invalid categoryId' };
  }
  const project = await Project.findById(projectId).select('taskCategories');
  if (!project) return { ok: false, error: 'Project not found' };
  const match = (project.taskCategories ?? []).some(
    (c: any) => String(c._id) === s
  );
  if (!match) {
    return { ok: false, error: 'Category does not belong to this project' };
  }
  return { ok: true, categoryId: new mongoose.Types.ObjectId(s) };
}

/** Validate and resolve an assignedTo employee. */
async function resolveEmployee(
  id: unknown
): Promise<
  | { ok: true; id: mongoose.Types.ObjectId | null }
  | { ok: false; error: string }
> {
  if (id === undefined || id === null || id === '') {
    return { ok: true, id: null };
  }
  const s = String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) {
    return { ok: false, error: 'Invalid employee id' };
  }
  const emp = await Employee.findOne({ _id: s, isDeleted: false }).select('_id');
  if (!emp) return { ok: false, error: 'Employee not found' };
  return { ok: true, id: emp._id };
}

/** Validate and normalize tags. */
function validateTags(input: any): {
  ok: boolean;
  error?: string;
  parsed?: string[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'tags must be an array' };
  if (input.length > 20) return { ok: false, error: 'Too many tags (max 20)' };

  const seen = new Set<string>();
  const parsed: string[] = [];
  for (const raw of input) {
    const t = String(raw || '').trim().slice(0, 50);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(t);
  }
  return { ok: true, parsed };
}

/** Validate a manual activity payload. */
function validateActivities(input: any): {
  ok: boolean;
  error?: string;
  parsed?: any[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: 'activities must be an array' };
  }
  if (input.length > 500) {
    return { ok: false, error: 'Too many activities (max 500)' };
  }

  const parsed: any[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (!a || typeof a !== 'object') {
      return { ok: false, error: `activities[${i}] is invalid` };
    }
    const type = String(a.type || '').trim();
    if (!TASK_ACTIVITY_TYPES.includes(type as any)) {
      return {
        ok: false,
        error: `activities[${i}].type must be one of: ${TASK_ACTIVITY_TYPES.join(', ')}`,
      };
    }
    const description = String(a.description || '').trim();
    if (!description) {
      return { ok: false, error: `activities[${i}].description is required` };
    }
    parsed.push({
      type,
      description: description.slice(0, 2000),
      meta:
        a.meta && typeof a.meta === 'object' && !Array.isArray(a.meta)
          ? a.meta
          : undefined,
      performedBy:
        a.performedBy && mongoose.Types.ObjectId.isValid(String(a.performedBy))
          ? a.performedBy
          : null,
      performedAt: a.performedAt ? new Date(a.performedAt) : new Date(),
    });
  }
  return { ok: true, parsed };
}

/** Validate comments. */
function validateComments(input: any): {
  ok: boolean;
  error?: string;
  parsed?: any[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: 'comments must be an array' };
  }
  if (input.length > 1000) {
    return { ok: false, error: 'Too many comments (max 1000)' };
  }

  const parsed: any[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (!c || typeof c !== 'object') {
      return { ok: false, error: `comments[${i}] is invalid` };
    }
    const body = String(c.body || '').trim();
    if (!body) return { ok: false, error: `comments[${i}].body is required` };
    if (!mongoose.Types.ObjectId.isValid(String(c.author))) {
      return { ok: false, error: `comments[${i}].author is invalid` };
    }
    parsed.push({
      body: body.slice(0, 5000),
      author: c.author,
      createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
    });
  }
  return { ok: true, parsed };
}

/** Validate attachments. */
function validateAttachments(input: any): {
  ok: boolean;
  error?: string;
  parsed?: any[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: 'attachments must be an array' };
  }
  if (input.length > 50) {
    return { ok: false, error: 'Too many attachments (max 50)' };
  }

  const parsed: any[] = [];
  for (let i = 0; i < input.length; i++) {
    const f = input[i];
    if (!f || typeof f !== 'object') {
      return { ok: false, error: `attachments[${i}] is invalid` };
    }
    const fileName = String(f.fileName || '').trim();
    const fileUrl = String(f.fileUrl || '').trim();
    if (!fileName) {
      return { ok: false, error: `attachments[${i}].fileName is required` };
    }
    if (!fileUrl) {
      return { ok: false, error: `attachments[${i}].fileUrl is required` };
    }
    parsed.push({
      fileName: fileName.slice(0, 255),
      fileUrl: fileUrl.slice(0, 1000),
      fileType: f.fileType ? String(f.fileType).trim().slice(0, 100) : undefined,
      fileSize: f.fileSize !== undefined ? Number(f.fileSize) : undefined,
      uploadedBy:
        f.uploadedBy && mongoose.Types.ObjectId.isValid(String(f.uploadedBy))
          ? f.uploadedBy
          : null,
      uploadedAt: f.uploadedAt ? new Date(f.uploadedAt) : new Date(),
    });
  }
  return { ok: true, parsed };
}

// ═════════════════════════════════════════════════════════════════════════
// OWNERSHIP CHECK HELPER (per-task)
// ═════════════════════════════════════════════════════════════════════════
type TaskPermissionAction = 'view' | 'add' | 'edit' | 'delete';

async function userCanAccessTask(
  req: AuthRequest,
  task: any,
  opts: { permission?: TaskPermissionAction; requireAssigneeOnly?: boolean } = {}
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.isMainAdmin) return true;

  const userId = String(req.user._id);

  // Translate User._id -> Employee._id
  let employeeId: string | null = null;
  try {
    const emp = await Employee.findOne({ user: userId }).select('_id').lean();
    if (emp) employeeId = String(emp._id);
  } catch (err) {
    console.error('Error resolving employee in userCanAccessTask:', err);
  }

  const assignedToId = task.assignedTo ? String(task.assignedTo._id ?? task.assignedTo) : null;
  const assignedById = task.assignedBy ? String(task.assignedBy._id ?? task.assignedBy) : null;
  const createdById = task.createdBy ? String(task.createdBy._id ?? task.createdBy) : null;

  // Check direct relationships (Assignee, Assigner, Creator)
  const isAssignee =
    assignedToId === userId || (!!employeeId && assignedToId === employeeId);
  const isAssigner =
    assignedById === userId || (!!employeeId && assignedById === employeeId);
  const isCreator =
    createdById === userId || (!!employeeId && createdById === employeeId);

  // Check if user is the Project Manager or a Team Member of the populated project
  let isPM = false;
  let isTeamMember = false;
  if (task.projectId && typeof task.projectId === 'object') {
    const pmId = task.projectId.projectManager 
      ? String(task.projectId.projectManager._id ?? task.projectId.projectManager) 
      : null;
    if (pmId === userId) isPM = true;

    if (Array.isArray(task.projectId.teamMembers)) {
      isTeamMember = task.projectId.teamMembers.some(
        (m: any) => String(m._id ?? m) === userId
      );
    }
  }

  // For actions like logging time — only the assignee (or an admin) should act
  if (opts.requireAssigneeOnly) {
    if (isAssignee || isPM) return true;
    if (opts.permission && (await req.user.can('tasks', opts.permission))) return true;
    return false;
  }

  // If they are directly related, a PM, or a team member -> allow
  if (isAssignee || isAssigner || isCreator || isPM || isTeamMember) {
    return true;
  }

  // Fallback: check global permissions
  if (opts.permission && (await req.user.can('tasks', opts.permission))) {
    return true;
  }

  if (opts.permission === 'view' && (await req.user.can('projects', 'view'))) {
    return true;
  }

  return false;
}

// ═════════════════════════════════════════════════════════════════════════
// PROJECT-LEVEL ACCESS HELPER
// ═════════════════════════════════════════════════════════════════════════
type ProjectTaskAction = 'view' | 'add';

async function userCanAccessProjectTasks(
  req: AuthRequest,
  project: any,
  action: ProjectTaskAction
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.isMainAdmin) return true;

  const userId = String(req.user._id);

  const isPM = project.projectManager
    ? String(project.projectManager?._id ?? project.projectManager) === userId
    : false;
  const isTeamMember = (project.teamMembers ?? []).some(
    (m: any) => String(m?._id ?? m) === userId
  );

  if (action === 'view') {
    if (isPM || isTeamMember) return true;
    if (await req.user.can('projects', 'view')) return true;
    if (await req.user.can('tasks', 'view')) return true;
    return false;
  }

  // action === 'add'
  if (isPM) return true;
  if (await req.user.can('tasks', 'add')) return true;
  if (await req.user.can('projects', 'edit')) return true;
  return false;
}

// ═════════════════════════════════════════════════════════════════════════
// CREATE TASK
// ═════════════════════════════════════════════════════════════════════════
export async function createTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      projectId,
      categoryId,
      title,
      description,
      assignedTo,
      estimatedHours,
      startDate,
      dueDate,
      status,
      priority,
      progress,
      parentTaskId,
      dependsOn,
      tags,
      activities,
      comments,
      attachments,
      createdBy,
    } = req.body;

    if (!title || !String(title).trim()) {
      res.status(400).json({ success: false, message: 'title is required' });
      return;
    }
    if (String(title).length > 250) {
      res.status(400).json({
        success: false,
        message: 'title must be at most 250 characters',
      });
      return;
    }

    const projectRes = await resolveProject(projectId);
    if (!projectRes.ok) {
      res.status(400).json({ success: false, message: projectRes.error });
      return;
    }
    const resolvedProjectId = projectRes.projectId ?? null;
    const isInternal = resolvedProjectId === null;

    if (!isInternal) {
      const project = await Project.findOne({
        _id: resolvedProjectId,
        isDeleted: false,
      }).select('_id projectManager teamMembers');
      if (!project) {
        res.status(400).json({ success: false, message: 'Project not found' });
        return;
      }
      if (!(await userCanAccessProjectTasks(req, project, 'add'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot add tasks to this project',
        });
        return;
      }
    }

    const categoryRes = await resolveCategoryForProject(
      resolvedProjectId,
      categoryId
    );
    if (!categoryRes.ok) {
      res.status(400).json({ success: false, message: categoryRes.error });
      return;
    }

    const assigneeRes = await resolveEmployee(assignedTo);
    if (!assigneeRes.ok) {
      res.status(400).json({ success: false, message: assigneeRes.error });
      return;
    }

    const assignerId = req.user?._id;
    if (!assignerId) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    if (status !== undefined && !TASK_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${TASK_STATUSES.join(', ')}`,
      });
      return;
    }
    if (priority !== undefined && !TASK_PRIORITIES.includes(priority)) {
      res.status(400).json({
        success: false,
        message: `Invalid priority. Allowed: ${TASK_PRIORITIES.join(', ')}`,
      });
      return;
    }

    if (progress !== undefined && progress !== null && progress !== '') {
      const p = Number(progress);
      if (!Number.isInteger(p) || p < 0 || p > 100) {
        res.status(400).json({
          success: false,
          message: 'progress must be an integer between 0 and 100',
        });
        return;
      }
    }

    if (
      estimatedHours !== undefined &&
      estimatedHours !== null &&
      estimatedHours !== ''
    ) {
      const h = Number(estimatedHours);
      if (!Number.isFinite(h) || h < 0) {
        res.status(400).json({
          success: false,
          message: 'estimatedHours must be a non-negative number',
        });
        return;
      }
    }

    let resolvedParentId: mongoose.Types.ObjectId | null = null;
    if (parentTaskId) {
      if (!mongoose.Types.ObjectId.isValid(String(parentTaskId))) {
        res.status(400).json({ success: false, message: 'Invalid parentTaskId' });
        return;
      }
      const parent = await Task.findOne({
        _id: parentTaskId,
        isDeleted: false,
      }).select('_id projectId');
      if (!parent) {
        res.status(400).json({ success: false, message: 'Parent task not found' });
        return;
      }
      const parentProjectId = parent.projectId
        ? String(parent.projectId)
        : null;
      const childProjectId = resolvedProjectId
        ? String(resolvedProjectId)
        : null;
      if (parentProjectId !== childProjectId) {
        res.status(400).json({
          success: false,
          message:
            'Parent task must belong to the same project (or both must be internal)',
        });
        return;
      }
      resolvedParentId = parent._id;
    }

    let resolvedDependsOn: mongoose.Types.ObjectId[] = [];
    if (dependsOn !== undefined && dependsOn !== null) {
      if (!Array.isArray(dependsOn)) {
        res.status(400).json({
          success: false,
          message: 'dependsOn must be an array',
        });
        return;
      }
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const raw of dependsOn) {
        const s = String(raw);
        if (!mongoose.Types.ObjectId.isValid(s)) {
          res.status(400).json({
            success: false,
            message: `Invalid dependsOn id: ${s}`,
          });
          return;
        }
        if (!seen.has(s)) {
          seen.add(s);
          ids.push(s);
        }
      }
      if (ids.length > 20) {
        res.status(400).json({
          success: false,
          message: 'Too many dependencies (max 20)',
        });
        return;
      }
      const depFilter: any = {
        _id: { $in: ids },
        isDeleted: false,
      };
      if (isInternal) depFilter.projectId = null;
      else depFilter.projectId = resolvedProjectId;

      const deps = await Task.find(depFilter).select('_id');
      if (deps.length !== ids.length) {
        res.status(400).json({
          success: false,
          message: isInternal
            ? 'One or more dependencies are invalid or belong to a project'
            : 'One or more dependencies are invalid or belong to another project',
        });
        return;
      }
      resolvedDependsOn = deps.map((d) => d._id);
    }

    let creatorId: mongoose.Types.ObjectId | null = null;
    if (createdBy) {
      const r = await resolveEmployee(createdBy);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      creatorId = r.id;
    }

    const tagsRes = validateTags(tags);
    if (!tagsRes.ok) {
      res.status(400).json({ success: false, message: tagsRes.error });
      return;
    }
    const activitiesRes = validateActivities(activities);
    if (!activitiesRes.ok) {
      res.status(400).json({ success: false, message: activitiesRes.error });
      return;
    }
    const commentsRes = validateComments(comments);
    if (!commentsRes.ok) {
      res.status(400).json({ success: false, message: commentsRes.error });
      return;
    }
    const attachmentsRes = validateAttachments(attachments);
    if (!attachmentsRes.ok) {
      res.status(400).json({ success: false, message: attachmentsRes.error });
      return;
    }

    const task = new Task({
      projectId: resolvedProjectId,
      categoryId: categoryRes.categoryId,

      title: String(title).trim(),
      description: description ? String(description).trim() : undefined,

      assignedTo: assigneeRes.id,
      assignedBy: assignerId,
      assignedAt: assigneeRes.id ? new Date() : undefined,

      estimatedHours:
        estimatedHours !== undefined &&
        estimatedHours !== null &&
        estimatedHours !== ''
          ? Number(estimatedHours)
          : 0,

      startDate: startDate ? new Date(startDate) : undefined,
      dueDate: dueDate ? new Date(dueDate) : undefined,

      status: (status as TaskStatus) || 'todo',
      priority: (priority as TaskPriority) || 'medium',
      progress:
        progress !== undefined && progress !== null && progress !== ''
          ? Number(progress)
          : 0,

      parentTaskId: resolvedParentId,
      dependsOn: resolvedDependsOn,

      tags: tagsRes.parsed ?? [],
      activities: activitiesRes.parsed ?? [],
      comments: commentsRes.parsed ?? [],
      attachments: attachmentsRes.parsed ?? [],

      createdBy: creatorId ?? req.user?._id ?? null,
    });

    await task.save();

    const fresh = await Task.findById(task._id)
      .populate('projectId', 'projectId name status projectType')
      .populate('assignedTo', 'name employeeId designation department')
      .populate('assignedBy', 'name employeeId designation')
      .populate('createdBy', 'name employeeId')
      .populate('parentTaskId', 'taskId title status')
      .populate('dependsOn', 'taskId title status')
      .populate('activities.performedBy', 'name employeeId')
      .populate('comments.author', 'name employeeId')
      .populate('attachments.uploadedBy', 'name employeeId')
      .populate('timeEntries.loggedBy', 'name employeeId')
      .populate('estimateHistory.changedBy', 'name employeeId');

    res.status(201).json({
      success: true,
      message: isInternal
        ? 'Internal task created successfully'
        : 'Task created successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('createTask error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

    if (err?.name === 'ValidationError') {
      res.status(400).json({
        success: false,
        message: err.message,
        errors: Object.fromEntries(
          Object.entries(err.errors || {}).map(([k, v]: any) => [k, v.message])
        ),
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LIST TASKS (admin)
// ═════════════════════════════════════════════════════════════════════════
export async function listTasks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      projectId,
      categoryId,
      assignedTo,
      status,
      priority,
      parentTaskId,
      hasProject,
      overdue,
      dueBefore,
      dueAfter,
      search,
      tags,
      onlyDeleted,
      page = '1',
      limit = '50',
      sort = '-createdAt',
    } = req.query;

    const filter: any = {
      isDeleted: onlyDeleted === 'true',
    };

    if (projectId) {
      if (!mongoose.Types.ObjectId.isValid(String(projectId))) {
        res.status(400).json({ success: false, message: 'Invalid projectId' });
        return;
      }
      filter.projectId = projectId;
    }

    if (hasProject !== undefined) {
      if (hasProject === 'true') {
        filter.projectId = { $ne: null };
      } else if (hasProject === 'false') {
        filter.projectId = null;
      } else {
        res.status(400).json({
          success: false,
          message: "hasProject must be 'true' or 'false'",
        });
        return;
      }
    }

    if (categoryId) {
      if (!mongoose.Types.ObjectId.isValid(String(categoryId))) {
        res.status(400).json({ success: false, message: 'Invalid categoryId' });
        return;
      }
      filter.categoryId = categoryId;
    }

    if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(String(assignedTo))) {
        res.status(400).json({ success: false, message: 'Invalid assignedTo id' });
        return;
      }
      filter.assignedTo = assignedTo;
    }

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is TaskStatus => (TASK_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    if (priority) filter.priority = priority;

    if (parentTaskId) {
      if (!mongoose.Types.ObjectId.isValid(String(parentTaskId))) {
        res.status(400).json({ success: false, message: 'Invalid parentTaskId' });
        return;
      }
      filter.parentTaskId = parentTaskId;
    }

    if (overdue === 'true') {
      filter.status = filter.status || { $in: OPEN_TASK_STATUSES };
      filter.dueDate = { ...(filter.dueDate || {}), $lt: new Date() };
    } else {
      if (dueBefore) {
        filter.dueDate = {
          ...(filter.dueDate || {}),
          $lte: new Date(String(dueBefore)),
        };
      }
      if (dueAfter) {
        filter.dueDate = {
          ...(filter.dueDate || {}),
          $gte: new Date(String(dueAfter)),
        };
      }
    }

    if (tags) {
      const tagList = String(tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length) filter.tags = { $in: tagList };
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { taskId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('projectId', 'projectId name status projectType')
        .populate('assignedTo', 'name employeeId designation department')
        .populate('assignedBy', 'name employeeId designation')
        .populate('createdBy', 'name employeeId')
        .populate('parentTaskId', 'taskId title status')
        .populate('dependsOn', 'taskId title status')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Task.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: tasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listTasks error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LIST MY TASKS
// ═════════════════════════════════════════════════════════════════════════
export async function listMyTasks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const userId = req.user?._id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    let employeeId: string | null = null;
    const emp = await Employee.findOne({ user: userId }).select('_id').lean();
    if (emp?._id) {
      employeeId = String(emp._id);
    }

    if (!employeeId) {
      res.status(403).json({
        success: false,
        message:
          'No Employee record is linked to your account. Ask an admin to link your user to an employee.',
      });
      return;
    }

    const {
      status,
      priority,
      overdue,
      projectId,
      hasProject,
      includeDone,
      search,
      page = '1',
      limit = '50',
      sort = 'dueDate',
    } = req.query;

    const filter: any = {
      isDeleted: false,
      assignedTo: employeeId,
    };

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is TaskStatus => (TASK_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    } else if (includeDone !== 'true') {
      filter.status = { $in: OPEN_TASK_STATUSES };
    }

    if (priority) filter.priority = priority;

    if (projectId) {
      if (!mongoose.Types.ObjectId.isValid(String(projectId))) {
        res.status(400).json({ success: false, message: 'Invalid projectId' });
        return;
      }
      filter.projectId = projectId;
    }

    if (hasProject !== undefined) {
      if (hasProject === 'true') {
        filter.projectId = { $ne: null };
      } else if (hasProject === 'false') {
        filter.projectId = null;
      } else {
        res.status(400).json({
          success: false,
          message: "hasProject must be 'true' or 'false'",
        });
        return;
      }
    }

    if (overdue === 'true') {
      filter.dueDate = { $lt: new Date() };
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { taskId: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('assignedBy', 'name employeeId designation')
        .populate('assignedTo', 'name employeeId designation department')
        .populate('projectId', 'projectId name status')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Task.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: tasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listMyTasks error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// GET TASK BY ID
// ═════════════════════════════════════════════════════════════════════════
export async function getTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const idStr = String(taskId);

    const task = await Task.findOne(buildLookupQuery(idStr))
      // 🚨 CRITICAL FIX: We MUST populate projectManager and teamMembers 
      // so userCanAccessTask can verify if you are a PM or Team Member!
      .populate('projectId', 'projectId name status projectType projectManager teamMembers')
      .populate('assignedTo', 'name employeeId designation department phoneNo email')
      .populate('assignedBy', 'name employeeId designation department')
      .populate('createdBy', 'name employeeId')
      .populate('parentTaskId', 'taskId title status')
      .populate('dependsOn', 'taskId title status')
      .populate('activities.performedBy', 'name employeeId')
      .populate('comments.author', 'name employeeId')
      .populate('attachments.uploadedBy', 'name employeeId')
      .populate('timeEntries.loggedBy', 'name employeeId')
      .populate('estimateHistory.changedBy', 'name employeeId');

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    // ── Bulletproof Permission Check ──────────────────────────────────
    const allowed = await userCanAccessTask(req, task, { permission: 'view' });
    if (!allowed) {
      res.status(403).json({ success: false, message: 'You cannot view this task' });
      return;
    }

    res.json({ success: true, data: task });
  } catch (err: any) {
    console.error('getTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// UPDATE TASK
// ═════════════════════════════════════════════════════════════════════════
export async function updateTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const idStr = String(taskId);

    const task = await Task.findOne(buildLookupQuery(idStr));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    // ── Permission check ────────────────────────────────────────────────
    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot edit this task',
      });
      return;
    }

    const {
      categoryId,
      title,
      description,
      assignedTo,
      estimatedHours,
      startDate,
      dueDate,
      status,
      priority,
      progress,
      parentTaskId,
      dependsOn,
      tags,
    } = req.body;

    if (title !== undefined) {
      const t = String(title).trim();
      if (!t) {
        res.status(400).json({ success: false, message: 'title cannot be empty' });
        return;
      }
      if (t.length > 250) {
        res.status(400).json({
          success: false,
          message: 'title must be at most 250 characters',
        });
        return;
      }
    }

    if (status !== undefined && !TASK_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${TASK_STATUSES.join(', ')}`,
      });
      return;
    }
    if (priority !== undefined && !TASK_PRIORITIES.includes(priority)) {
      res.status(400).json({
        success: false,
        message: `Invalid priority. Allowed: ${TASK_PRIORITIES.join(', ')}`,
      });
      return;
    }

    if (progress !== undefined && progress !== null && progress !== '') {
      const p = Number(progress);
      if (!Number.isInteger(p) || p < 0 || p > 100) {
        res.status(400).json({
          success: false,
          message: 'progress must be an integer between 0 and 100',
        });
        return;
      }
    }

    if (
      estimatedHours !== undefined &&
      estimatedHours !== null &&
      estimatedHours !== ''
    ) {
      const h = Number(estimatedHours);
      if (!Number.isFinite(h) || h < 0) {
        res.status(400).json({
          success: false,
          message: 'estimatedHours must be a non-negative number',
        });
        return;
      }
    }

    let resolvedCategoryId: mongoose.Types.ObjectId | null | undefined;
    if (categoryId !== undefined) {
      const r = await resolveCategoryForProject(task.projectId, categoryId);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      resolvedCategoryId = r.categoryId;
    }

    let resolvedAssignee: mongoose.Types.ObjectId | null | undefined;
    if (assignedTo !== undefined) {
      const r = await resolveEmployee(assignedTo);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      resolvedAssignee = r.id;
    }

    let resolvedParentId: mongoose.Types.ObjectId | null | undefined;
    if (parentTaskId !== undefined) {
      if (parentTaskId === null || parentTaskId === '') {
        resolvedParentId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(parentTaskId))) {
          res.status(400).json({
            success: false,
            message: 'Invalid parentTaskId',
          });
          return;
        }
        if (String(parentTaskId) === String(task._id)) {
          res.status(400).json({
            success: false,
            message: 'Task cannot be its own parent',
          });
          return;
        }
        const parent = await Task.findOne({
          _id: parentTaskId,
          isDeleted: false,
        }).select('_id projectId');
        if (!parent) {
          res.status(400).json({
            success: false,
            message: 'Parent task not found',
          });
          return;
        }
        const parentProjectId = parent.projectId
          ? String(parent.projectId)
          : null;
        const childProjectId = task.projectId ? String(task.projectId) : null;
        if (parentProjectId !== childProjectId) {
          res.status(400).json({
            success: false,
            message:
              'Parent task must belong to the same project (or both must be internal)',
          });
          return;
        }
        resolvedParentId = parent._id;
      }
    }

    let resolvedDependsOn: mongoose.Types.ObjectId[] | undefined;
    if (dependsOn !== undefined && dependsOn !== null) {
      if (!Array.isArray(dependsOn)) {
        res.status(400).json({
          success: false,
          message: 'dependsOn must be an array',
        });
        return;
      }
      const ids: string[] = [];
      const seen = new Set<string>();
      for (const raw of dependsOn) {
        const s = String(raw);
        if (!mongoose.Types.ObjectId.isValid(s)) {
          res.status(400).json({
            success: false,
            message: `Invalid dependsOn id: ${s}`,
          });
          return;
        }
        if (String(s) === String(task._id)) {
          res.status(400).json({
            success: false,
            message: 'A task cannot depend on itself',
          });
          return;
        }
        if (!seen.has(s)) {
          seen.add(s);
          ids.push(s);
        }
      }
      if (ids.length > 20) {
        res.status(400).json({
          success: false,
          message: 'Too many dependencies (max 20)',
        });
        return;
      }
      const depFilter: any = {
        _id: { $in: ids },
        isDeleted: false,
      };
      if (task.projectId) depFilter.projectId = task.projectId;
      else depFilter.projectId = null;

      const deps = await Task.find(depFilter).select('_id');
      if (deps.length !== ids.length) {
        res.status(400).json({
          success: false,
          message: task.projectId
            ? 'One or more dependencies are invalid or belong to another project'
            : 'One or more dependencies are invalid or belong to a project',
        });
        return;
      }
      resolvedDependsOn = deps.map((d) => d._id);
    }

    let resolvedTags: string[] | undefined;
    if (tags !== undefined) {
      const r = validateTags(tags);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      resolvedTags = r.parsed;
    }

    const performer = req.user?._id ?? null;

    if (title !== undefined) task.title = String(title).trim();
    if (description !== undefined) {
      task.description = description ? String(description).trim() : undefined;
    }

    if (resolvedCategoryId !== undefined) {
      const previous = task.categoryId ? String(task.categoryId) : null;
      const next = resolvedCategoryId ? String(resolvedCategoryId) : null;
      if (previous !== next) {
        task.categoryId = resolvedCategoryId;
        task.activities.push({
          type: 'category_change',
          description: `Category changed`,
          meta: { from: previous, to: next },
          performedBy: performer,
          performedAt: new Date(),
        } as any);
        task.markModified('activities');
      }
    }

    if (resolvedAssignee !== undefined) {
      const previous = task.assignedTo ? String(task.assignedTo) : null;
      const next = resolvedAssignee ? String(resolvedAssignee) : null;
      if (previous !== next) {
        task.assignedTo = resolvedAssignee;
        task.assignedAt = resolvedAssignee ? new Date() : undefined;
        task.activities.push({
          type: previous ? 'reassigned' : 'assigned',
          description: resolvedAssignee
            ? `Assigned to a new employee`
            : `Unassigned`,
          meta: { from: previous, to: next },
          performedBy: performer,
          performedAt: new Date(),
        } as any);
        task.markModified('activities');
      }
    }

    if (
      estimatedHours !== undefined &&
      estimatedHours !== null &&
      estimatedHours !== ''
    ) {
      const h = Number(estimatedHours);
      const from = task.estimatedHours ?? 0;
      if (from !== h) {
        task.estimateHistory.push({
          fromHours: from,
          toHours: h,
          changedBy: (performer ?? task.assignedBy) as any,
          changedAt: new Date(),
        } as any);
        task.estimatedHours = h;
        task.activities.push({
          type: 'estimate_changed',
          description: `Estimate changed from ${from}h to ${h}h`,
          meta: { from, to: h },
          performedBy: performer,
          performedAt: new Date(),
        } as any);
        task.markModified('activities');
        task.markModified('estimateHistory');
      }
    }

    if (startDate !== undefined) {
      task.startDate = startDate ? new Date(startDate) : undefined;
    }

    if (dueDate !== undefined) {
      const prevMs = task.dueDate?.getTime() ?? null;
      const nextMs = dueDate ? new Date(dueDate).getTime() : null;
      if (prevMs !== nextMs) {
        task.dueDate = dueDate ? new Date(dueDate) : undefined;
        task.activities.push({
          type: 'due_date_change',
          description: dueDate
            ? `Due date changed to ${new Date(dueDate).toISOString().slice(0, 10)}`
            : `Due date cleared`,
          performedBy: performer,
          performedAt: new Date(),
        } as any);
        task.markModified('activities');
      }
    }

    if (status !== undefined && status !== task.status) {
      const previous = task.status;
      task.status = status as TaskStatus;
      task.activities.push({
        type: 'status_change',
        description: `Status changed from "${previous}" to "${status}"`,
        meta: { from: previous, to: status },
        performedBy: performer,
        performedAt: new Date(),
      } as any);
      task.markModified('activities');
    }

    if (priority !== undefined && priority !== task.priority) {
      const previous = task.priority;
      task.priority = priority as TaskPriority;
      task.activities.push({
        type: 'priority_change',
        description: `Priority changed from "${previous}" to "${priority}"`,
        meta: { from: previous, to: priority },
        performedBy: performer,
        performedAt: new Date(),
      } as any);
      task.markModified('activities');
    }

    if (progress !== undefined && progress !== null && progress !== '') {
      task.progress = Number(progress);
    }

    if (resolvedParentId !== undefined) task.parentTaskId = resolvedParentId;
    if (resolvedDependsOn !== undefined) task.dependsOn = resolvedDependsOn;
    if (resolvedTags !== undefined) {
      task.tags = resolvedTags;
      task.markModified('tags');
    }

    await task.save();

    const fresh = await Task.findById(task._id)
      .populate('projectId', 'projectId name status projectType')
      .populate('assignedTo', 'name employeeId designation department')
      .populate('assignedBy', 'name employeeId designation')
      .populate('createdBy', 'name employeeId')
      .populate('parentTaskId', 'taskId title status')
      .populate('dependsOn', 'taskId title status')
      .populate('activities.performedBy', 'name employeeId')
      .populate('comments.author', 'name employeeId')
      .populate('attachments.uploadedBy', 'name employeeId')
      .populate('timeEntries.loggedBy', 'name employeeId')
      .populate('estimateHistory.changedBy', 'name employeeId');

    res.json({
      success: true,
      message: 'Task updated successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('updateTask error:', err);

    if (err?.name === 'ValidationError') {
      res.status(400).json({
        success: false,
        message: err.message,
        errors: Object.fromEntries(
          Object.entries(err.errors || {}).map(([k, v]: any) => [k, v.message])
        ),
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ASSIGN / REASSIGN
// ═════════════════════════════════════════════════════════════════════════
export async function assignTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const { assignedTo } = req.body;

    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    // ── Fixed Permission Check ─────────────────────────────────────────
    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot reassign this task',
      });
      return;
    }

    const r = await resolveEmployee(assignedTo);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }

    const previous = task.assignedTo ? String(task.assignedTo) : null;
    const next = r.id ? String(r.id) : null;

    if (previous === next) {
      res.json({
        success: true,
        message: 'Assignment unchanged',
        data: task,
      });
      return;
    }

    task.assignedTo = r.id;
    task.assignedAt = r.id ? new Date() : undefined;
    task.activities.push({
      type: previous ? 'reassigned' : 'assigned',
      description: r.id
        ? `Assigned to a new employee`
        : `Unassigned`,
      meta: { from: previous, to: next },
      performedBy: req.user?._id ?? null,
      performedAt: new Date(),
    } as any);
    task.markModified('activities');

    await task.save();

    const fresh = await Task.findById(task._id)
      .populate('assignedTo', 'name employeeId designation department')
      .populate('assignedBy', 'name employeeId designation');

    res.json({
      success: true,
      message: 'Task assignment updated',
      data: fresh,
    });
  } catch (err: any) {
    console.error('assignTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// CHANGE STATUS
// ═════════════════════════════════════════════════════════════════════════
export async function changeTaskStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const { status, notes } = req.body;

    if (!status || !TASK_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${TASK_STATUSES.join(', ')}`,
      });
      return;
    }

    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: "You cannot change this task's status",
      });
      return;
    }

    await task.setStatus(status as TaskStatus, req.user?._id ?? null, notes);

    res.json({
      success: true,
      message: 'Task status updated',
      data: task,
    });
  } catch (err: any) {
    console.error('changeTaskStatus error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LOG TIME
// ═════════════════════════════════════════════════════════════════════════
export async function logTaskTime(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const { hours, note, workDate } = req.body;

    if (hours === undefined || hours === null || hours === '') {
      res.status(400).json({ success: false, message: 'hours is required' });
      return;
    }
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) {
      res.status(400).json({
        success: false,
        message: 'hours must be a positive number',
      });
      return;
    }

    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    // ── Relaxed Permission Check (Viewers can log time) ────────────────
    const allowed = await userCanAccessTask(req, task, { permission: 'view' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot log time on this task',
      });
      return;
    }

    await task.logTime(h, {
      note: note ? String(note).trim().slice(0, 1000) : undefined,
      loggedBy: req.user?._id ?? null,
      workDate: workDate ? new Date(workDate) : undefined,
    });

    res.status(201).json({
      success: true,
      message: 'Time logged',
      data: {
        actualHours: task.actualHours,
        estimatedHours: task.estimatedHours,
        timeEntries: task.timeEntries,
      },
    });
  } catch (err: any) {
    console.error('logTaskTime error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// CHANGE ESTIMATE
// ═════════════════════════════════════════════════════════════════════════
export async function changeTaskEstimate(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const { estimatedHours, reason } = req.body;

    if (
      estimatedHours === undefined ||
      estimatedHours === null ||
      estimatedHours === ''
    ) {
      res.status(400).json({
        success: false,
        message: 'estimatedHours is required',
      });
      return;
    }
    const h = Number(estimatedHours);
    if (!Number.isFinite(h) || h < 0) {
      res.status(400).json({
        success: false,
        message: 'estimatedHours must be a non-negative number',
      });
      return;
    }

    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: "You cannot change this task's estimate",
      });
      return;
    }

    await task.changeEstimate(h, {
      reason: reason ? String(reason).trim().slice(0, 500) : undefined,
      changedBy: req.user?._id ?? null,
    });

    res.json({
      success: true,
      message: 'Estimate updated',
      data: {
        estimatedHours: task.estimatedHours,
        estimateHistory: task.estimateHistory,
      },
    });
  } catch (err: any) {
    console.error('changeTaskEstimate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ACTIVITIES
// ═════════════════════════════════════════════════════════════════════════
export async function addTaskActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot add activities to this task',
      });
      return;
    }

    const r = validateActivities([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({
        success: false,
        message: r.error || 'Invalid activity',
      });
      return;
    }
    const activity = r.parsed[0];

    await task.logActivity(activity.type, activity.description, {
      performedBy: activity.performedBy ?? req.user?._id ?? null,
      meta: activity.meta,
    });

    res.status(201).json({
      success: true,
      message: 'Activity added',
      data: task.activities,
    });
  } catch (err: any) {
    console.error('addTaskActivity error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeTaskActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId, activityId } = req.params;
    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot remove activities from this task',
      });
      return;
    }

    const before = task.activities.length;
    task.activities = task.activities.filter(
      (a: any) => String(a._id) !== String(activityId)
    );

    if (task.activities.length === before) {
      res.status(404).json({ success: false, message: 'Activity not found' });
      return;
    }

    task.markModified('activities');
    await task.save();

    res.json({
      success: true,
      message: 'Activity removed',
      data: task.activities,
    });
  } catch (err: any) {
    console.error('removeTaskActivity error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: COMMENTS
// ═════════════════════════════════════════════════════════════════════════
export async function addTaskComment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot comment on this task',
      });
      return;
    }

    const body = String(req.body?.body ?? '').trim();
    if (!body) {
      res.status(400).json({ success: false, message: 'Comment body is required' });
      return;
    }

    const authorId = req.user?._id;
    if (!authorId) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    task.comments.push({
      body: body.slice(0, 5000),
      author: authorId,
      createdAt: new Date(),
    } as any);
    task.markModified('comments');
    await task.save();

    res.status(201).json({
      success: true,
      message: 'Comment added',
      data: task.comments,
    });
  } catch (err: any) {
    console.error('addTaskComment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeTaskComment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId, commentId } = req.params;
    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const comment: any = task.comments.find(
      (c: any) => String(c._id) === String(commentId)
    );
    if (!comment) {
      res.status(404).json({ success: false, message: 'Comment not found' });
      return;
    }

    const isMainAdmin = req.user!.isMainAdmin;
    const canEdit = await req.user!.can('tasks', 'edit');
    const isAuthor = String(comment.author) === String(req.user!._id);

    if (!isMainAdmin && !canEdit && !isAuthor) {
      res.status(403).json({
        success: false,
        message: 'You cannot remove this comment',
      });
      return;
    }

    task.comments = task.comments.filter(
      (c: any) => String(c._id) !== String(commentId)
    );
    task.markModified('comments');
    await task.save();

    res.json({
      success: true,
      message: 'Comment removed',
      data: task.comments,
    });
  } catch (err: any) {
    console.error('removeTaskComment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS
// ═════════════════════════════════════════════════════════════════════════
export async function addTaskAttachment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot attach files to this task',
      });
      return;
    }

    const r = validateAttachments([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({
        success: false,
        message: r.error || 'Invalid attachment',
      });
      return;
    }
    const attachment = r.parsed[0];

    task.attachments.push(attachment);
    task.markModified('attachments');
    await task.save();

    res.status(201).json({
      success: true,
      message: 'Attachment added',
      data: task.attachments,
    });
  } catch (err: any) {
    console.error('addTaskAttachment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeTaskAttachment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId, attachmentId } = req.params;
    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    const allowed = await userCanAccessTask(req, task, { permission: 'edit' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot remove attachments from this task',
      });
      return;
    }

    const before = task.attachments.length;
    task.attachments = task.attachments.filter(
      (a: any) => String(a._id) !== String(attachmentId)
    );

    if (task.attachments.length === before) {
      res.status(404).json({ success: false, message: 'Attachment not found' });
      return;
    }

    task.markModified('attachments');
    await task.save();

    res.json({
      success: true,
      message: 'Attachment removed',
      data: task.attachments,
    });
  } catch (err: any) {
    console.error('removeTaskAttachment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// DELETE (soft) / RESTORE
// ═════════════════════════════════════════════════════════════════════════
export async function deleteTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    // ── Fixed Permission Check ─────────────────────────────────────────
    const allowed = await userCanAccessTask(req, task, { permission: 'delete' });
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: 'You cannot delete this task',
      });
      return;
    }

    task.isDeleted = true;
    await task.save();

    res.json({ success: true, message: 'Task deleted successfully' });
  } catch (err: any) {
    console.error('deleteTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function restoreTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const idStr = String(taskId);

    const task = await Task.findOne(
      mongoose.Types.ObjectId.isValid(idStr)
        ? { _id: idStr }
        : { taskId: idStr }
    );
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      const canEdit = await req.user!.can('tasks', 'edit');
      if (!canEdit) {
        res.status(403).json({
          success: false,
          message: 'You cannot restore tasks',
        });
        return;
      }
    }

    task.isDeleted = false;
    task.deletedAt = undefined;
    await task.save();

    res.json({
      success: true,
      message: 'Task restored successfully',
      data: task,
    });
  } catch (err: any) {
    console.error('restoreTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE
// ═════════════════════════════════════════════════════════════════════════
export async function hardDeleteTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const idStr = String(taskId);

    if (!req.user!.isMainAdmin) {
      res.status(403).json({
        success: false,
        message: 'Only the main admin can permanently delete tasks',
      });
      return;
    }

    const task = await Task.findOne(
      mongoose.Types.ObjectId.isValid(idStr)
        ? { _id: idStr }
        : { taskId: idStr }
    );

    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    if (!task.isDeleted) {
      res.status(400).json({
        success: false,
        message:
          'Task must be soft-deleted first. Call DELETE /tasks/:id before permanent delete.',
      });
      return;
    }

    await Task.deleteOne({ _id: task._id });

    res.json({
      success: true,
      message: `Task ${task.taskId} permanently deleted`,
      data: { taskId: task.taskId, _id: task._id },
    });
  } catch (err: any) {
    console.error('hardDeleteTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// TASK STATS
// ═════════════════════════════════════════════════════════════════════════
export async function getTaskStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, assignedTo, hasProject } = req.query;

    const baseFilter: any = { isDeleted: false };

    if (projectId) {
      if (!mongoose.Types.ObjectId.isValid(String(projectId))) {
        res.status(400).json({ success: false, message: 'Invalid projectId' });
        return;
      }
      baseFilter.projectId = projectId;
    }

    if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(String(assignedTo))) {
        res.status(400).json({ success: false, message: 'Invalid assignedTo id' });
        return;
      }
      baseFilter.assignedTo = assignedTo;
    }

    const internalScopeFilter: any = { ...baseFilter, projectId: null };
    const outerScopeFilter: any = { ...baseFilter, projectId: { $ne: null } };

    if (hasProject !== undefined) {
      if (hasProject === 'true') baseFilter.projectId = { $ne: null };
      else if (hasProject === 'false') baseFilter.projectId = null;
      else {
        res.status(400).json({
          success: false,
          message: "hasProject must be 'true' or 'false'",
        });
        return;
      }
    }

    const [
      total,
      open,
      done,
      cancelled,
      blocked,
      overdue,
      dueToday,
      unassigned,
      internalCount,
      projectCount,
      byStatusRaw,
      byPriorityRaw,
      hoursAgg,
    ] = await Promise.all([
      Task.countDocuments(baseFilter),

      Task.countDocuments({
        ...baseFilter,
        status: { $in: OPEN_TASK_STATUSES },
      }),
      Task.countDocuments({ ...baseFilter, status: 'done' }),
      Task.countDocuments({ ...baseFilter, status: 'cancelled' }),
      Task.countDocuments({ ...baseFilter, status: 'blocked' }),

      Task.countDocuments({
        ...baseFilter,
        status: { $in: OPEN_TASK_STATUSES },
        dueDate: { $lt: new Date() },
      }),

      Task.countDocuments({
        ...baseFilter,
        status: { $in: OPEN_TASK_STATUSES },
        dueDate: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      }),

      Task.countDocuments({ ...baseFilter, assignedTo: null }),

      Task.countDocuments(internalScopeFilter),
      Task.countDocuments(outerScopeFilter),

      Task.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      Task.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Task.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: null,
            totalEstimated: { $sum: '$estimatedHours' },
            totalActual: { $sum: '$actualHours' },
          },
        },
      ]),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of TASK_STATUSES) byStatus[s] = 0;
    for (const row of byStatusRaw) {
      const key = String(row._id ?? 'unknown');
      byStatus[key] = (byStatus[key] ?? 0) + row.count;
    }

    const totalEstimatedHours = hoursAgg[0]?.totalEstimated ?? 0;
    const totalActualHours = hoursAgg[0]?.totalActual ?? 0;

    res.json({
      success: true,
      data: {
        total,
        open,
        done,
        cancelled,
        blocked,
        overdue,
        dueToday,
        unassigned,
        internalCount,
        projectCount,
        breakdown: {
          byStatus,
          byPriority: byPriorityRaw.map((d) => ({
            priority: d._id || 'medium',
            count: d.count,
          })),
        },
        hours: {
          totalEstimatedHours: +Number(totalEstimatedHours).toFixed(2),
          totalActualHours: +Number(totalActualHours).toFixed(2),
          variance:
            totalEstimatedHours > 0
              ? +(
                  ((totalActualHours - totalEstimatedHours) /
                    totalEstimatedHours) *
                  100
                ).toFixed(2)
              : 0,
        },
      },
    });
  } catch (err: any) {
    console.error('getTaskStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// RECOMPUTE PARENT PROJECT PROGRESS
// ═════════════════════════════════════════════════════════════════════════
export async function recomputeFromTask(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { taskId } = req.params;
    const task = await Task.findOne(buildLookupQuery(String(taskId)));
    if (!task) {
      res.status(404).json({ success: false, message: 'Task not found' });
      return;
    }

    if (!task.projectId) {
      res.status(400).json({
        success: false,
        message: 'Internal tasks have no project to recompute',
      });
      return;
    }

    const project = await Project.findById(task.projectId);
    if (!project) {
      res.status(404).json({ success: false, message: 'Parent project not found' });
      return;
    }

    // ── Fixed Permission Check ─────────────────────────────────────────
    const allowed = await userCanAccessProjectTasks(req, project, 'view');
    if (!allowed) {
      res.status(403).json({
        success: false,
        message: "You cannot recompute this project's progress",
      });
      return;
    }

    await (project as any).recomputeProgressFromTasks();

    res.json({
      success: true,
      message: 'Project progress recomputed',
      data: {
        progress: project.progress,
        totalEstimatedHours: project.totalEstimatedHours,
        totalActualHours: project.totalActualHours,
        totalTasks: project.totalTasks,
        completedTasks: project.completedTasks,
      },
    });
  } catch (err: any) {
    console.error('recomputeFromTask error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// BULK: LIST BY PROJECT
// ═════════════════════════════════════════════════════════════════════════
export async function listTasksByProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(projectId))) {
      res.status(400).json({ success: false, message: 'Invalid projectId' });
      return;
    }

    const project = await Project.findOne({
      _id: projectId,
      isDeleted: false,
    }).select('_id projectManager teamMembers');
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    if (!(await userCanAccessProjectTasks(req, project, 'view'))) {
      res.status(403).json({
        success: false,
        message: "You cannot view this project's tasks",
      });
      return;
    }

    const {
      status,
      categoryId,
      assignedTo,
      priority,
      overdue,
      search,
      sort = '-createdAt',
    } = req.query;

    const filter: any = {
      projectId: project._id,
      isDeleted: false,
    };

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is TaskStatus => (TASK_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    if (categoryId) filter.categoryId = categoryId;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (priority) filter.priority = priority;

    if (overdue === 'true') {
      filter.status = filter.status || { $in: OPEN_TASK_STATUSES };
      filter.dueDate = { $lt: new Date() };
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { taskId: { $regex: search, $options: 'i' } },
      ];
    }

    const tasks = await Task.find(filter)
      .populate('assignedTo', 'name employeeId designation department')
      .populate('assignedBy', 'name employeeId designation')
      .populate('parentTaskId', 'taskId title status')
      .sort(sort as string);

    res.json({ success: true, data: tasks });
  } catch (err: any) {
    console.error('listTasksByProject error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LIST INTERNAL TASKS
// ═════════════════════════════════════════════════════════════════════════
export async function listInternalTasks(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      assignedTo,
      status,
      priority,
      overdue,
      dueBefore,
      dueAfter,
      search,
      tags,
      onlyDeleted,
      page = '1',
      limit = '50',
      sort = '-createdAt',
    } = req.query;

    const filter: any = {
      isDeleted: onlyDeleted === 'true',
      projectId: null,
    };

    if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(String(assignedTo))) {
        res.status(400).json({ success: false, message: 'Invalid assignedTo id' });
        return;
      }
      filter.assignedTo = assignedTo;
    }

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is TaskStatus => (TASK_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    if (priority) filter.priority = priority;

    if (overdue === 'true') {
      filter.status = filter.status || { $in: OPEN_TASK_STATUSES };
      filter.dueDate = { ...(filter.dueDate || {}), $lt: new Date() };
    } else {
      if (dueBefore) {
        filter.dueDate = {
          ...(filter.dueDate || {}),
          $lte: new Date(String(dueBefore)),
        };
      }
      if (dueAfter) {
        filter.dueDate = {
          ...(filter.dueDate || {}),
          $gte: new Date(String(dueAfter)),
        };
      }
    }

    if (tags) {
      const tagList = String(tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length) filter.tags = { $in: tagList };
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { taskId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('assignedTo', 'name employeeId designation department')
        .populate('assignedBy', 'name employeeId designation')
        .populate('createdBy', 'name employeeId')
        .populate('parentTaskId', 'taskId title status')
        .populate('dependsOn', 'taskId title status')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Task.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: tasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listInternalTasks error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}