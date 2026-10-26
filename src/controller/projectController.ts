// controller/projectController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Project, {
  PROJECT_STATUSES,
  PROJECT_PRIORITIES,
  PROJECT_TYPES,
  PROJECT_ACTIVITY_TYPES,
  PROJECT_PROGRESS_MODES,
  OPEN_PROJECT_STATUSES,
  PROJECT_DEPARTMENT_MAX_LENGTH,
  PROJECT_MAX_TASK_CATEGORIES,
  type ProjectStatus,
  type ProjectPriority,
  type ProjectType,
  type ProjectProgressMode,
} from '../model/project';
import Client from '../model/client';
import Lead from '../model/lead';
import Employee from '../model/employee';
import { AuthRequest } from '../middleware/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Common ObjectId-or-projectId lookup query. */
function buildLookupQuery(idStr: string, onlyActive = true) {
  const base: any = mongoose.Types.ObjectId.isValid(idStr)
    ? { _id: idStr }
    : { projectId: idStr };
  if (onlyActive) base.isDeleted = false;
  return base;
}

/** Validate and normalize a milestone subdocument. */
function validateMilestones(
  input: any
): { ok: boolean; error?: string; parsed?: any[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'milestones must be an array' };
  if (input.length > 50) return { ok: false, error: 'Too many milestones (max 50)' };

  const parsed: any[] = [];
  for (let i = 0; i < input.length; i++) {
    const m = input[i];
    if (!m || typeof m !== 'object') {
      return { ok: false, error: `milestones[${i}] is invalid` };
    }
    const title = String(m.title || '').trim();
    if (!title) return { ok: false, error: `milestones[${i}].title is required` };

    parsed.push({
      title: title.slice(0, 200),
      description: m.description ? String(m.description).trim().slice(0, 1000) : undefined,
      dueDate: m.dueDate ? new Date(m.dueDate) : undefined,
      completedAt: m.completedAt ? new Date(m.completedAt) : undefined,
      isCompleted: Boolean(m.isCompleted),
    });
  }
  return { ok: true, parsed };
}

/**
 * Returns true if the caller can act on this project.
 *   • main admin → always true
 *   • has `projects:edit` → true
 *   • is the project's manager → true
 *   • otherwise → false
 */
async function canActOnProject(
  req: AuthRequest,
  project: any
): Promise<boolean> {
  if (!req.user) return false;
  if (req.user.isMainAdmin) return true;

  const hasEdit = await req.user.can('projects', 'edit');
  if (hasEdit) return true;

  const isPM =
    String(project.projectManager?._id ?? project.projectManager) ===
    String(req.user._id);
  return isPM;
}


/** Validate and normalize task categories. */
function validateTaskCategories(
  input: any
): { ok: boolean; error?: string; parsed?: any[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: 'taskCategories must be an array' };
  }
  if (input.length > PROJECT_MAX_TASK_CATEGORIES) {
    return {
      ok: false,
      error: `Too many task categories (max ${PROJECT_MAX_TASK_CATEGORIES})`,
    };
  }

  const seen = new Set<string>();
  const parsed: any[] = [];

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (!c || typeof c !== 'object') {
      return { ok: false, error: `taskCategories[${i}] is invalid` };
    }
    const name = String(c.name || '').trim();
    if (!name) {
      return { ok: false, error: `taskCategories[${i}].name is required` };
    }
    const key = name.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: `Duplicate task category "${name}"` };
    }
    seen.add(key);

    const weight = c.weight !== undefined ? Number(c.weight) : 1;
    if (!Number.isFinite(weight) || weight < 0) {
      return {
        ok: false,
        error: `taskCategories[${i}].weight must be a non-negative number`,
      };
    }

    parsed.push({
      name: name.slice(0, 100),
      description: c.description
        ? String(c.description).trim().slice(0, 500)
        : undefined,
      weight,
      order: Number.isFinite(Number(c.order)) ? Number(c.order) : i,
    });
  }

  return { ok: true, parsed };
}

/** Validate a manual activity payload. */
function validateActivities(
  input: any
): { ok: boolean; error?: string; parsed?: any[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'activities must be an array' };
  if (input.length > 500) return { ok: false, error: 'Too many activities (max 500)' };

  const parsed: any[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (!a || typeof a !== 'object') {
      return { ok: false, error: `activities[${i}] is invalid` };
    }
    const type = String(a.type || '').trim();
    if (!PROJECT_ACTIVITY_TYPES.includes(type as any)) {
      return {
        ok: false,
        error: `activities[${i}].type must be one of: ${PROJECT_ACTIVITY_TYPES.join(', ')}`,
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

function validateAttachments(
  input: any
): { ok: boolean; error?: string; parsed?: any[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'attachments must be an array' };
  if (input.length > 50) return { ok: false, error: 'Too many attachments (max 50)' };

  const parsed: any[] = [];
  for (let i = 0; i < input.length; i++) {
    const f = input[i];
    if (!f || typeof f !== 'object') {
      return { ok: false, error: `attachments[${i}] is invalid` };
    }
    const fileName = String(f.fileName || '').trim();
    const fileUrl = String(f.fileUrl || '').trim();
    if (!fileName) return { ok: false, error: `attachments[${i}].fileName is required` };
    if (!fileUrl) return { ok: false, error: `attachments[${i}].fileUrl is required` };

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

function validateTags(input: any): { ok: boolean; error?: string; parsed?: string[] } {
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

/** Ensure an array of employee ids all exist and are not deleted. */
async function resolveEmployeeIds(
  ids: unknown
): Promise<{ ok: boolean; error?: string; ids: mongoose.Types.ObjectId[] }> {
  if (ids === undefined || ids === null) return { ok: true, ids: [] };
  if (!Array.isArray(ids)) return { ok: false, error: 'teamMembers must be an array', ids: [] };

  const unique: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const s = String(raw);
    if (!mongoose.Types.ObjectId.isValid(s)) {
      return { ok: false, error: `Invalid employee id: ${s}`, ids: [] };
    }
    if (!seen.has(s)) {
      seen.add(s);
      unique.push(s);
    }
  }
  if (unique.length > 50) {
    return { ok: false, error: 'A project can have at most 50 team members', ids: [] };
  }
  const found = await Employee.find({ _id: { $in: unique }, isDeleted: false }).select('_id');
  if (found.length !== unique.length) {
    const foundIds = new Set(found.map((e) => String(e._id)));
    const missing = unique.filter((id) => !foundIds.has(id));
    return { ok: false, error: `Employee(s) not found: ${missing.join(', ')}`, ids: [] };
  }
  return { ok: true, ids: found.map((e) => e._id) };
}

/** Recompute progress from milestones + status fallback (used if no tasks yet). */
function computeProgressFromMilestones(
  milestones: { isCompleted: boolean }[] | undefined,
  fallback = 0
): number {
  if (!milestones || milestones.length === 0) return fallback;
  const done = milestones.filter((m) => m.isCompleted).length;
  return Math.round((done / milestones.length) * 100);
}

/** Normalize an incoming department string. */
function normalizeDepartment(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const s = String(input).trim();
  if (!s) return undefined;
  return s.slice(0, PROJECT_DEPARTMENT_MAX_LENGTH);
}

// ═════════════════════════════════════════════════════════════════════════
// CREATE PROJECT
//   POST /api/projects
// ═════════════════════════════════════════════════════════════════════════
export async function createProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      name,
      description,
      projectType = 'client',
      clientId,
      department,
      leadId,
      projectManager,
      budget,
      currency,
      startDate,
      deadline,
      status,
      priority,
      progress,
      progressMode,
      taskCategories,
      teamMembers,
      milestones,
      activities,
      attachments,
      tags,
      createdBy,
    } = req.body;

    // ── 1. projectType enum check ────────────────────────────────────────
    if (!PROJECT_TYPES.includes(projectType)) {
      res.status(400).json({
        success: false,
        message: `Invalid projectType. Allowed: ${PROJECT_TYPES.join(', ')}`,
      });
      return;
    }

    // ── 2. Required fields (clientId required ONLY for client projects) ──
    const required: Record<string, any> = { name, projectManager };
    if (projectType === 'client') {
      required.clientId = clientId;
    }
    const missing = Object.entries(required)
      .filter(([, v]) => v === undefined || v === null || v === '')
      .map(([k]) => k);
    if (missing.length) {
      res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`,
      });
      return;
    }

    // ── 3. Enum checks ───────────────────────────────────────────────────
    if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${PROJECT_STATUSES.join(', ')}`,
      });
      return;
    }
    if (priority !== undefined && !PROJECT_PRIORITIES.includes(priority)) {
      res.status(400).json({
        success: false,
        message: `Invalid priority. Allowed: ${PROJECT_PRIORITIES.join(', ')}`,
      });
      return;
    }
    if (progressMode !== undefined && !PROJECT_PROGRESS_MODES.includes(progressMode)) {
      res.status(400).json({
        success: false,
        message: `Invalid progressMode. Allowed: ${PROJECT_PROGRESS_MODES.join(', ')}`,
      });
      return;
    }

    // ── 4. Progress check ────────────────────────────────────────────────
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

    // ── 5. Budget check ──────────────────────────────────────────────────
    if (budget !== undefined && budget !== null && budget !== '') {
      const b = Number(budget);
      if (!Number.isFinite(b) || b < 0) {
        res.status(400).json({
          success: false,
          message: 'budget must be a non-negative number',
        });
        return;
      }
    }

    // ── 6. Client resolution (conditional) ───────────────────────────────
    let resolvedClientId: mongoose.Types.ObjectId | null = null;
    if (projectType === 'client') {
      if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
        res.status(400).json({ success: false, message: 'Invalid clientId' });
        return;
      }
      const client = await Client.findOne({ _id: clientId, isDeleted: false }).select('_id');
      if (!client) {
        res.status(400).json({ success: false, message: 'Client not found' });
        return;
      }
      resolvedClientId = client._id;
    } else {
      // Internal project — must NOT carry a clientId
      if (clientId !== undefined && clientId !== null && clientId !== '') {
        res.status(400).json({
          success: false,
          message: 'Internal projects cannot have a clientId',
        });
        return;
      }
    }

    // ── 7. Project manager must be a valid employee ──────────────────────
    if (!mongoose.Types.ObjectId.isValid(String(projectManager))) {
      res.status(400).json({ success: false, message: 'Invalid projectManager id' });
      return;
    }
    const pm = await Employee.findOne({ _id: projectManager, isDeleted: false }).select('_id');
    if (!pm) {
      res.status(400).json({ success: false, message: 'projectManager not found' });
      return;
    }

    // ── 8. Optional leadId must exist ────────────────────────────────────
    let resolvedLeadId: mongoose.Types.ObjectId | null = null;
    if (leadId) {
      if (!mongoose.Types.ObjectId.isValid(String(leadId))) {
        res.status(400).json({ success: false, message: 'Invalid leadId' });
        return;
      }
      const lead = await Lead.findOne({ _id: leadId, isDeleted: false }).select('_id');
      if (!lead) {
        res.status(400).json({ success: false, message: 'leadId not found' });
        return;
      }
      resolvedLeadId = lead._id;
    }

    // ── 9. Team members ──────────────────────────────────────────────────
    const teamRes = await resolveEmployeeIds(teamMembers);
    if (!teamRes.ok) {
      res.status(400).json({ success: false, message: teamRes.error });
      return;
    }

    // ── 10. createdBy must be valid employee (optional) ──────────────────
    let creatorId: mongoose.Types.ObjectId | null = null;
    if (createdBy) {
      if (!mongoose.Types.ObjectId.isValid(String(createdBy))) {
        res.status(400).json({ success: false, message: 'Invalid createdBy id' });
        return;
      }
      const emp = await Employee.findOne({ _id: createdBy, isDeleted: false }).select('_id');
      if (!emp) {
        res.status(400).json({ success: false, message: 'createdBy employee not found' });
        return;
      }
      creatorId = emp._id;
    }

    // ── 11. Sub-arrays ───────────────────────────────────────────────────
    const milestonesRes = validateMilestones(milestones);
    if (!milestonesRes.ok) {
      res.status(400).json({ success: false, message: milestonesRes.error });
      return;
    }
    const categoriesRes = validateTaskCategories(taskCategories);
    if (!categoriesRes.ok) {
      res.status(400).json({ success: false, message: categoriesRes.error });
      return;
    }
    const activitiesRes = validateActivities(activities);
    if (!activitiesRes.ok) {
      res.status(400).json({ success: false, message: activitiesRes.error });
      return;
    }
    const attachmentsRes = validateAttachments(attachments);
    if (!attachmentsRes.ok) {
      res.status(400).json({ success: false, message: attachmentsRes.error });
      return;
    }
    const tagsRes = validateTags(tags);
    if (!tagsRes.ok) {
      res.status(400).json({ success: false, message: tagsRes.error });
      return;
    }

    // ── 12. Auto-compute progress from milestones when none provided ─────
    const resolvedProgress =
      progress !== undefined && progress !== null && progress !== ''
        ? Number(progress)
        : computeProgressFromMilestones(milestonesRes.parsed);

    // ── 13. Create ───────────────────────────────────────────────────────
    const project = new Project({
      name: String(name).trim(),
      description: description ? String(description).trim() : undefined,

      projectType: projectType as ProjectType,
      clientId: resolvedClientId,
      department: normalizeDepartment(department),

      leadId: resolvedLeadId,
      projectManager: pm._id,

      budget:
        budget !== undefined && budget !== null && budget !== ''
          ? Number(budget)
          : 0,
      currency: currency ? String(currency).toUpperCase() : 'PKR',
      startDate: startDate ? new Date(startDate) : undefined,
      deadline: deadline ? new Date(deadline) : undefined,

      status: (status as ProjectStatus) || 'planning',
      priority: (priority as ProjectPriority) || 'medium',
      progress: resolvedProgress,
      progressMode: (progressMode as ProjectProgressMode) || 'auto',

      taskCategories: categoriesRes.parsed ?? [],
      teamMembers: teamRes.ids,
      milestones: milestonesRes.parsed ?? [],
      activities: activitiesRes.parsed ?? [],
      attachments: attachmentsRes.parsed ?? [],
      tags: tagsRes.parsed ?? [],

      createdBy: creatorId ?? req.user?._id ?? null,
    });

    await project.save();

    // Populate for the response
    const fresh = await Project.findById(project._id)
      .populate('clientId', 'clientId name clientType status')
      .populate('leadId', 'leadId name companyName')
      .populate('projectManager', 'name employeeId designation department')
      .populate('teamMembers', 'name employeeId designation department')
      .populate('createdBy', 'name employeeId')
      .populate('activities.performedBy', 'name employeeId')
      .populate('attachments.uploadedBy', 'name employeeId');

    res.status(201).json({
      success: true,
      message: 'Project created successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('createProject error:', err);

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
// LIST PROJECTS
//   GET /api/projects
// ═════════════════════════════════════════════════════════════════════════
export async function listProjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      status,
      priority,
      projectType,
      department,
      clientId,
      projectManager,
      teamMember,
      leadId,
      progressMode,
      // deadline filters
      overdue,
      deadlineBefore,
      deadlineAfter,
      // budget
      budgetMin,
      budgetMax,
      // search / misc
      search,
      tags,
      onlyDeleted,
      // pagination
      page = '1',
      limit = '20',
      sort = '-createdAt',
    } = req.query;

    const filter: any = {
      isDeleted: onlyDeleted === 'true',
    };

    // ── Status (single or comma-separated) ───────────────────────────────
    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ProjectStatus => (PROJECT_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    // ── Priority (single value) ──────────────────────────────────────────
    if (priority) filter.priority = priority;

    // ── projectType (single or comma-separated) ──────────────────────────
    if (projectType) {
      const list = String(projectType)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ProjectType => (PROJECT_TYPES as string[]).includes(s));
      if (list.length === 1) filter.projectType = list[0];
      else if (list.length > 1) filter.projectType = { $in: list };
    }

    // ── progressMode (single value) ──────────────────────────────────────
    if (progressMode) {
      if (!PROJECT_PROGRESS_MODES.includes(progressMode as ProjectProgressMode)) {
        res.status(400).json({
          success: false,
          message: `Invalid progressMode. Allowed: ${PROJECT_PROGRESS_MODES.join(', ')}`,
        });
        return;
      }
      filter.progressMode = progressMode;
    }

    // ── department (case-insensitive regex) ──────────────────────────────
    if (department) {
      filter.department = { $regex: String(department), $options: 'i' };
    }

    // ── Relationships ────────────────────────────────────────────────────
    if (clientId) {
      if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
        res.status(400).json({ success: false, message: 'Invalid clientId' });
        return;
      }
      filter.clientId = clientId;
    }
    if (projectManager) {
      if (!mongoose.Types.ObjectId.isValid(String(projectManager))) {
        res.status(400).json({ success: false, message: 'Invalid projectManager id' });
        return;
      }
      filter.projectManager = projectManager;
    }
    if (teamMember) {
      if (!mongoose.Types.ObjectId.isValid(String(teamMember))) {
        res.status(400).json({ success: false, message: 'Invalid teamMember id' });
        return;
      }
      filter.teamMembers = teamMember;
    }
    if (leadId) {
      if (!mongoose.Types.ObjectId.isValid(String(leadId))) {
        res.status(400).json({ success: false, message: 'Invalid leadId' });
        return;
      }
      filter.leadId = leadId;
    }

    // ── Deadline ─────────────────────────────────────────────────────────
    if (overdue === 'true') {
      filter.status = filter.status || { $in: OPEN_PROJECT_STATUSES };
      filter.deadline = { ...(filter.deadline || {}), $lt: new Date() };
    } else {
      if (deadlineBefore) {
        filter.deadline = {
          ...(filter.deadline || {}),
          $lte: new Date(String(deadlineBefore)),
        };
      }
      if (deadlineAfter) {
        filter.deadline = {
          ...(filter.deadline || {}),
          $gte: new Date(String(deadlineAfter)),
        };
      }
    }

    // ── Budget range ─────────────────────────────────────────────────────
    if (budgetMin !== undefined || budgetMax !== undefined) {
      filter.budget = {};
      if (budgetMin !== undefined) filter.budget.$gte = Number(budgetMin);
      if (budgetMax !== undefined) filter.budget.$lte = Number(budgetMax);
    }

    // ── Tags (any-of match) ──────────────────────────────────────────────
    if (tags) {
      const tagList = String(tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length) filter.tags = { $in: tagList };
    }

    // ── Search ───────────────────────────────────────────────────────────
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { projectId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .populate('clientId', 'clientId name clientType status')
        .populate('leadId', 'leadId name companyName')
        .populate('projectManager', 'name employeeId designation department')
        .populate('teamMembers', 'name employeeId designation department')
        .populate('createdBy', 'name employeeId')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Project.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: projects,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listProjects error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LIST INTERNAL PROJECTS (convenience endpoint)
//   GET /api/projects/internal
// ═════════════════════════════════════════════════════════════════════════
export async function listInternalProjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      department,
      status,
      priority,
      projectManager,
      search,
      page = '1',
      limit = '20',
      sort = '-createdAt',
    } = req.query;

    const filter: any = {
      isDeleted: false,
      projectType: 'internal',
    };

    if (department) {
      filter.department = { $regex: String(department), $options: 'i' };
    }

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ProjectStatus => (PROJECT_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    if (priority) filter.priority = priority;

    if (projectManager) {
      if (!mongoose.Types.ObjectId.isValid(String(projectManager))) {
        res.status(400).json({ success: false, message: 'Invalid projectManager id' });
        return;
      }
      filter.projectManager = projectManager;
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { projectId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .populate('projectManager', 'name employeeId designation department')
        .populate('teamMembers', 'name employeeId designation department')
        .populate('createdBy', 'name employeeId')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Project.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: projects,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listInternalProjects error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// GET PROJECT BY ID
//   GET /api/projects/:projectId
// ═════════════════════════════════════════════════════════════════════════
export async function getProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const idStr = String(projectId);

    const project = await Project.findOne(buildLookupQuery(idStr))
      .populate('clientId', 'clientId name clientType status email phoneNo')
      .populate('leadId', 'leadId name companyName email phoneNo status')
      .populate('projectManager', 'name employeeId designation department phoneNo email')
      .populate('teamMembers', 'name employeeId designation department')
      .populate('createdBy', 'name employeeId')
      .populate('activities.performedBy', 'name employeeId')
      .populate('attachments.uploadedBy', 'name employeeId');

    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    res.json({ success: true, data: project });
  } catch (err: any) {
    console.error('getProject error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// UPDATE PROJECT (uses model's applyChanges for auto-logged activities)
//   PATCH /api/projects/:projectId
// ═════════════════════════════════════════════════════════════════════════
export async function updateProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const idStr = String(projectId);

    const project = await Project.findOne(buildLookupQuery(idStr));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // ── Permission check ────────────────────────────────────────────────
    const isMainAdmin = req.user!.isMainAdmin;
    const canEdit = await req.user!.can('projects', 'edit');
    const isPM = String(project.projectManager) === String(req.user!._id);
    if (!isMainAdmin && !canEdit && !isPM) {
      res.status(403).json({
        success: false,
        message: 'You cannot edit this project',
      });
      return;
    }

    const {
      name,
      description,
      projectType,
      clientId,
      department,
      leadId,
      projectManager,
      budget,
      currency,
      startDate,
      deadline,
      status,
      priority,
      progress,
      progressMode,
      taskCategories,
      teamMembers,
      milestones,
      tags,
    } = req.body;

    // ── Validation ──────────────────────────────────────────────────────
    if (projectType !== undefined && !PROJECT_TYPES.includes(projectType)) {
      res.status(400).json({
        success: false,
        message: `Invalid projectType. Allowed: ${PROJECT_TYPES.join(', ')}`,
      });
      return;
    }
    if (status !== undefined && !PROJECT_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${PROJECT_STATUSES.join(', ')}`,
      });
      return;
    }
    if (priority !== undefined && !PROJECT_PRIORITIES.includes(priority)) {
      res.status(400).json({
        success: false,
        message: `Invalid priority. Allowed: ${PROJECT_PRIORITIES.join(', ')}`,
      });
      return;
    }
    if (progressMode !== undefined && !PROJECT_PROGRESS_MODES.includes(progressMode)) {
      res.status(400).json({
        success: false,
        message: `Invalid progressMode. Allowed: ${PROJECT_PROGRESS_MODES.join(', ')}`,
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
    if (budget !== undefined && budget !== null && budget !== '') {
      const b = Number(budget);
      if (!Number.isFinite(b) || b < 0) {
        res.status(400).json({
          success: false,
          message: 'budget must be a non-negative number',
        });
        return;
      }
    }

    // ── Resolve projectType + clientId TOGETHER ──────────────────────────
    let resolvedProjectType: ProjectType | undefined;
    let resolvedClientId: mongoose.Types.ObjectId | null | undefined;

    const effectiveType: ProjectType =
      (projectType as ProjectType | undefined) ?? project.projectType;

    if (projectType !== undefined) {
      resolvedProjectType = projectType as ProjectType;
    }

    if (effectiveType === 'internal') {
      if (clientId !== undefined && clientId !== null && clientId !== '') {
        res.status(400).json({
          success: false,
          message: 'Internal projects cannot have a clientId',
        });
        return;
      }
      if (project.projectType !== 'internal' || project.clientId) {
        resolvedClientId = null;
      }
    } else {
      if (clientId !== undefined) {
        if (clientId === null || clientId === '') {
          res.status(400).json({
            success: false,
            message: 'clientId is required for client projects',
          });
          return;
        }
        if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
          res.status(400).json({ success: false, message: 'Invalid clientId' });
          return;
        }
        const c = await Client.findOne({ _id: clientId, isDeleted: false }).select('_id');
        if (!c) {
          res.status(400).json({ success: false, message: 'Client not found' });
          return;
        }
        resolvedClientId = c._id;
      } else if (project.projectType !== 'client' && !project.clientId) {
        res.status(400).json({
          success: false,
          message: 'clientId is required when changing projectType to "client"',
        });
        return;
      }
    }

    // ── Resolve leadId if provided (nullable) ────────────────────────────
    let resolvedLeadId: mongoose.Types.ObjectId | null | undefined;
    if (leadId !== undefined) {
      if (leadId === null || leadId === '') {
        resolvedLeadId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(leadId))) {
          res.status(400).json({ success: false, message: 'Invalid leadId' });
          return;
        }
        const l = await Lead.findOne({ _id: leadId, isDeleted: false }).select('_id');
        if (!l) {
          res.status(400).json({ success: false, message: 'leadId not found' });
          return;
        }
        resolvedLeadId = l._id;
      }
    }

    // ── Resolve projectManager if provided ───────────────────────────────
    let resolvedPM: mongoose.Types.ObjectId | undefined;
    if (projectManager !== undefined) {
      if (!mongoose.Types.ObjectId.isValid(String(projectManager))) {
        res.status(400).json({ success: false, message: 'Invalid projectManager id' });
        return;
      }
      const e = await Employee.findOne({ _id: projectManager, isDeleted: false }).select('_id');
      if (!e) {
        res.status(400).json({ success: false, message: 'projectManager not found' });
        return;
      }
      resolvedPM = e._id;
    }

    // ── Resolve teamMembers if provided ──────────────────────────────────
    let resolvedTeam: mongoose.Types.ObjectId[] | undefined;
    if (teamMembers !== undefined) {
      const r = await resolveEmployeeIds(teamMembers);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      resolvedTeam = r.ids;
    }

    // ── Milestones ───────────────────────────────────────────────────────
    let resolvedMilestones: any[] | undefined;
    if (milestones !== undefined) {
      const r = validateMilestones(milestones);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      resolvedMilestones = r.parsed;
    }

    // ── Task categories ──────────────────────────────────────────────────
    let resolvedCategories: any[] | undefined;
    if (taskCategories !== undefined) {
      const r = validateTaskCategories(taskCategories);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      resolvedCategories = r.parsed;
    }

    // ── Tags ─────────────────────────────────────────────────────────────
    let resolvedTags: string[] | undefined;
    if (tags !== undefined) {
      const r = validateTags(tags);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      resolvedTags = r.parsed;
    }

    // ── Build patch and apply via the model's diff-aware method ─────────
    const patch: any = {};
    if (name !== undefined) patch.name = String(name).trim();
    if (description !== undefined)
      patch.description = description ? String(description).trim() : undefined;

    if (resolvedProjectType !== undefined) patch.projectType = resolvedProjectType;
    if (resolvedClientId !== undefined) patch.clientId = resolvedClientId;
    if (department !== undefined) patch.department = normalizeDepartment(department);

    if (resolvedLeadId !== undefined) patch.leadId = resolvedLeadId;
    if (resolvedPM !== undefined) patch.projectManager = resolvedPM;
    if (budget !== undefined && budget !== null && budget !== '')
      patch.budget = Number(budget);
    if (currency !== undefined) patch.currency = String(currency).toUpperCase();
    if (startDate !== undefined)
      patch.startDate = startDate ? new Date(startDate) : undefined;
    if (deadline !== undefined)
      patch.deadline = deadline ? new Date(deadline) : undefined;
    if (status !== undefined) patch.status = status as ProjectStatus;
    if (priority !== undefined) patch.priority = priority as ProjectPriority;
    if (progress !== undefined && progress !== null && progress !== '')
      patch.progress = Number(progress);
    if (progressMode !== undefined) patch.progressMode = progressMode as ProjectProgressMode;
    if (resolvedCategories !== undefined) patch.taskCategories = resolvedCategories;
    if (resolvedTeam !== undefined) patch.teamMembers = resolvedTeam;
    if (resolvedMilestones !== undefined) patch.milestones = resolvedMilestones;
    if (resolvedTags !== undefined) patch.tags = resolvedTags;

    // applyChanges auto-logs status_change / deadline_change / team_change
    await project.applyChanges(patch, req.user?._id ?? null);

    const fresh = await Project.findById(project._id)
      .populate('clientId', 'clientId name clientType status')
      .populate('leadId', 'leadId name companyName')
      .populate('projectManager', 'name employeeId designation department')
      .populate('teamMembers', 'name employeeId designation department')
      .populate('createdBy', 'name employeeId');

    res.json({
      success: true,
      message: 'Project updated successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('updateProject error:', err);

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
// SUB-RESOURCE: ACTIVITIES
// ═════════════════════════════════════════════════════════════════════════
export async function addProjectActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const r = validateActivities([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid activity' });
      return;
    }
    const activity = r.parsed[0];

    await project.logActivity(activity.type, activity.description, {
      performedBy: activity.performedBy ?? req.user?._id ?? null,
      meta: activity.meta,
    });

    res.status(201).json({
      success: true,
      message: 'Activity added',
      data: project.activities,
    });
  } catch (err: any) {
    console.error('addProjectActivity error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProjectActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, activityId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const before = project.activities.length;
    project.activities = project.activities.filter(
      (a: any) => String(a._id) !== String(activityId)
    );

    if (project.activities.length === before) {
      res.status(404).json({ success: false, message: 'Activity not found' });
      return;
    }

    project.markModified('activities');
    await project.save();

    res.json({
      success: true,
      message: 'Activity removed',
      data: project.activities,
    });
  } catch (err: any) {
    console.error('removeProjectActivity error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS
// ═════════════════════════════════════════════════════════════════════════
export async function addProjectAttachment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const r = validateAttachments([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid attachment' });
      return;
    }
    const attachment = r.parsed[0];

    project.attachments.push(attachment);
    project.markModified('attachments');
    await project.save();

    res.status(201).json({
      success: true,
      message: 'Attachment added',
      data: project.attachments,
    });
  } catch (err: any) {
    console.error('addProjectAttachment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProjectAttachment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, attachmentId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const before = project.attachments.length;
    project.attachments = project.attachments.filter(
      (a: any) => String(a._id) !== String(attachmentId)
    );

    if (project.attachments.length === before) {
      res.status(404).json({ success: false, message: 'Attachment not found' });
      return;
    }

    project.markModified('attachments');
    await project.save();

    res.json({
      success: true,
      message: 'Attachment removed',
      data: project.attachments,
    });
  } catch (err: any) {
    console.error('removeProjectAttachment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: MILESTONES
// ═════════════════════════════════════════════════════════════════════════
export async function addProjectMilestone(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // ── Permission check: admin OR projects:edit OR PM of this project ──
    if (!(await canActOnProject(req, project))) {
      res.status(403).json({
        success: false,
        message: 'You cannot manage this project\'s milestones',
      });
      return;
    }

    const r = validateMilestones([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid milestone' });
      return;
    }

    project.milestones.push(r.parsed[0]);
    project.markModified('milestones');

    // Auto-recompute progress from milestones when in manual mode and no tasks exist
    project.progress = computeProgressFromMilestones(project.milestones, project.progress);

    await project.save();

    res.status(201).json({
      success: true,
      message: 'Milestone added',
      data: project.milestones,
    });
  } catch (err: any) {
    console.error('addProjectMilestone error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function toggleProjectMilestone(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, milestoneId } = req.params;
    const { isCompleted } = req.body;

    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // ── Permission check: admin OR projects:edit OR PM of this project ──
    if (!(await canActOnProject(req, project))) {
      res.status(403).json({
        success: false,
        message: 'You cannot manage this project\'s milestones',
      });
      return;
    }

    const milestone: any = project.milestones.find(
      (m: any) => String(m._id) === String(milestoneId)
    );
    if (!milestone) {
      res.status(404).json({ success: false, message: 'Milestone not found' });
      return;
    }

    milestone.isCompleted = Boolean(isCompleted);
    milestone.completedAt = milestone.isCompleted ? new Date() : undefined;
    project.markModified('milestones');

    project.progress = computeProgressFromMilestones(
      project.milestones,
      project.progress
    );

    if (milestone.isCompleted) {
      project.activities.push({
        type: 'milestone',
        description: `Milestone completed: "${milestone.title}"`,
        meta: { milestoneId: milestone._id, title: milestone.title },
        performedBy: req.user?._id ?? null,
        performedAt: new Date(),
      } as any);
      project.markModified('activities');
    }

    await project.save();

    res.json({
      success: true,
      message: 'Milestone updated',
      data: {
        milestones: project.milestones,
        progress: project.progress,
      },
    });
  } catch (err: any) {
    console.error('toggleProjectMilestone error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProjectMilestone(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, milestoneId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // ── Permission check: admin OR projects:edit OR PM of this project ──
    if (!(await canActOnProject(req, project))) {
      res.status(403).json({
        success: false,
        message: 'You cannot manage this project\'s milestones',
      });
      return;
    }

    const before = project.milestones.length;
    project.milestones = project.milestones.filter(
      (m: any) => String(m._id) !== String(milestoneId)
    );

    if (project.milestones.length === before) {
      res.status(404).json({ success: false, message: 'Milestone not found' });
      return;
    }

    project.markModified('milestones');
    project.progress = computeProgressFromMilestones(project.milestones, project.progress);

    await project.save();

    res.json({
      success: true,
      message: 'Milestone removed',
      data: {
        milestones: project.milestones,
        progress: project.progress,
      },
    });
  } catch (err: any) {
    console.error('removeProjectMilestone error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: TASK CATEGORIES
// ═════════════════════════════════════════════════════════════════════════
export async function addTaskCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const r = validateTaskCategories([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid category' });
      return;
    }
    const category = r.parsed[0];

    // Duplicate check across existing categories
    if (
      project.taskCategories.some(
        (c) => c.name.trim().toLowerCase() === category.name.toLowerCase()
      )
    ) {
      res.status(409).json({
        success: false,
        message: `Category "${category.name}" already exists`,
      });
      return;
    }

    project.taskCategories.push(category);
    project.markModified('taskCategories');
    await project.save();

    res.status(201).json({
      success: true,
      message: 'Task category added',
      data: project.taskCategories,
    });
  } catch (err: any) {
    console.error('addTaskCategory error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateTaskCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, categoryId } = req.params;
    const { name, description, weight, order } = req.body;

    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const category: any = project.taskCategories.find(
      (c: any) => String(c._id) === String(categoryId)
    );
    if (!category) {
      res.status(404).json({ success: false, message: 'Category not found' });
      return;
    }

    if (name !== undefined) {
      const trimmed = String(name).trim();
      if (!trimmed) {
        res.status(400).json({ success: false, message: 'Category name cannot be empty' });
        return;
      }
      const dup = project.taskCategories.some(
        (c: any) =>
          String(c._id) !== String(categoryId) &&
          c.name.trim().toLowerCase() === trimmed.toLowerCase()
      );
      if (dup) {
        res.status(409).json({
          success: false,
          message: `Category "${trimmed}" already exists`,
        });
        return;
      }
      category.name = trimmed.slice(0, 100);
    }
    if (description !== undefined) {
      category.description = description
        ? String(description).trim().slice(0, 500)
        : undefined;
    }
    if (weight !== undefined) {
      const w = Number(weight);
      if (!Number.isFinite(w) || w < 0) {
        res.status(400).json({
          success: false,
          message: 'weight must be a non-negative number',
        });
        return;
      }
      category.weight = w;
    }
    if (order !== undefined && Number.isFinite(Number(order))) {
      category.order = Number(order);
    }

    project.markModified('taskCategories');
    await project.save();

    res.json({
      success: true,
      message: 'Task category updated',
      data: project.taskCategories,
    });
  } catch (err: any) {
    console.error('updateTaskCategory error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeTaskCategory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId, categoryId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    const before = project.taskCategories.length;
    project.taskCategories = project.taskCategories.filter(
      (c: any) => String(c._id) !== String(categoryId)
    );

    if (project.taskCategories.length === before) {
      res.status(404).json({ success: false, message: 'Category not found' });
      return;
    }

    project.markModified('taskCategories');
    await project.save();

    res.json({
      success: true,
      message: 'Task category removed',
      data: project.taskCategories,
    });
  } catch (err: any) {
    console.error('removeTaskCategory error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function setProjectTeam(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const { teamMembers } = req.body;

    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // ── Permission check: admin OR projects:edit OR PM of this project ──
    if (!(await canActOnProject(req, project))) {
      res.status(403).json({
        success: false,
        message: 'You cannot change this project\'s team',
      });
      return;
    }

    const r = await resolveEmployeeIds(teamMembers);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }

    await project.applyChanges({ teamMembers: r.ids }, req.user?._id ?? null);

    const fresh = await Project.findById(project._id).populate(
      'teamMembers',
      'name employeeId designation department'
    );

    res.json({
      success: true,
      message: 'Project team updated',
      data: fresh?.teamMembers ?? [],
    });
  } catch (err: any) {
    console.error('setProjectTeam error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function changeProjectStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const { status, notes } = req.body;

    if (!status || !PROJECT_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${PROJECT_STATUSES.join(', ')}`,
      });
      return;
    }

    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // ── Permission check: admin OR projects:edit OR PM of this project ──
    if (!(await canActOnProject(req, project))) {
      res.status(403).json({
        success: false,
        message: 'You cannot change this project\'s status',
      });
      return;
    }

    await project.applyChanges(
      { status: status as ProjectStatus },
      req.user?._id ?? null
    );

    if (notes && String(notes).trim()) {
      await project.logActivity('note', String(notes).trim().slice(0, 2000), {
        performedBy: req.user?._id ?? null,
      });
    }

    res.json({
      success: true,
      message: 'Project status updated',
      data: project,
    });
  } catch (err: any) {
    console.error('changeProjectStatus error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LIST MY PROJECTS (no permission required — any authenticated user)
//   GET /api/projects/my-projects
//
// Returns every project the caller is related to in ANY capacity:
//   • projectManager
//   • teamMembers
//   • createdBy
// No `projects:view` / `projects:edit` permission is checked.
// ═════════════════════════════════════════════════════════════════════════
export async function listMyProjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const userId = req.user._id;

    const {
      status,
      priority,
      projectType,
      department,
      progressMode,
      // deadline
      overdue,
      deadlineBefore,
      deadlineAfter,
      // search / misc
      search,
      tags,
      // pagination
      page = '1',
      limit = '20',
      sort = '-createdAt',
    } = req.query;

    // ── Base: any project the user is related to ─────────────────────────
    const filter: any = {
      isDeleted: false,
      $or: [
        { projectManager: userId },
        { teamMembers: userId },
        { createdBy: userId },
      ],
    };

    // ── Status (single or comma-separated) ───────────────────────────────
    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ProjectStatus => (PROJECT_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    // ── Priority ─────────────────────────────────────────────────────────
    if (priority) filter.priority = priority;

    // ── projectType (single or comma-separated) ──────────────────────────
    if (projectType) {
      const list = String(projectType)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ProjectType => (PROJECT_TYPES as string[]).includes(s));
      if (list.length === 1) filter.projectType = list[0];
      else if (list.length > 1) filter.projectType = { $in: list };
    }

    // ── progressMode ─────────────────────────────────────────────────────
    if (progressMode) {
      if (!PROJECT_PROGRESS_MODES.includes(progressMode as ProjectProgressMode)) {
        res.status(400).json({
          success: false,
          message: `Invalid progressMode. Allowed: ${PROJECT_PROGRESS_MODES.join(', ')}`,
        });
        return;
      }
      filter.progressMode = progressMode;
    }

    // ── department (case-insensitive) ────────────────────────────────────
    if (department) {
      filter.department = { $regex: String(department), $options: 'i' };
    }

    // ── Deadline ─────────────────────────────────────────────────────────
    if (overdue === 'true') {
      filter.status = filter.status || { $in: OPEN_PROJECT_STATUSES };
      filter.deadline = { ...(filter.deadline || {}), $lt: new Date() };
    } else {
      if (deadlineBefore) {
        filter.deadline = {
          ...(filter.deadline || {}),
          $lte: new Date(String(deadlineBefore)),
        };
      }
      if (deadlineAfter) {
        filter.deadline = {
          ...(filter.deadline || {}),
          $gte: new Date(String(deadlineAfter)),
        };
      }
    }

    // ── Tags (any-of match) ──────────────────────────────────────────────
    if (tags) {
      const tagList = String(tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length) filter.tags = { $in: tagList };
    }

    // ── Search (must be ANDed with the relationship $or) ────────────────
    // Because `filter.$or` is already used for relationships, we combine
    // the search predicate with it via `$and` to avoid overwriting it.
    if (search) {
      const searchOr = [
        { name: { $regex: search, $options: 'i' } },
        { projectId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
      ];
      filter.$and = [...(filter.$and || []), { $or: searchOr }];
    }

    // ── Pagination ───────────────────────────────────────────────────────
    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .populate('clientId', 'clientId name clientType status')
        .populate('leadId', 'leadId name companyName')
        .populate('projectManager', 'name employeeId designation department')
        .populate('teamMembers', 'name employeeId designation department')
        .populate('createdBy', 'name employeeId')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Project.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: projects,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listMyProjects error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function recomputeProjectProgress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // ── Permission check: admin OR projects:edit OR PM of this project ──
    if (!(await canActOnProject(req, project))) {
      res.status(403).json({
        success: false,
        message: 'You cannot recompute this project\'s progress',
      });
      return;
    }

    const result = await project.recomputeProgressFromTasks();
    if (!result) {
      res.status(400).json({
        success: false,
        message:
          'Cannot recompute — project is in manual mode or Task model is unavailable',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Progress recomputed',
      data: {
        progress: project.progress,
        totalEstimatedHours: project.totalEstimatedHours,
        totalActualHours: project.totalActualHours,
        totalTasks: project.totalTasks,
        completedTasks: project.completedTasks,
      },
    });
  } catch (err: any) {
    console.error('recomputeProjectProgress error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}
// ═════════════════════════════════════════════════════════════════════════
// DELETE (soft) / RESTORE
// ═════════════════════════════════════════════════════════════════════════
export async function deleteProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const project = await Project.findOne(buildLookupQuery(String(projectId)));
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('projects', 'delete'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot delete projects',
        });
        return;
      }
    }

    project.isDeleted = true;
    await project.save();

    res.json({ success: true, message: 'Project deleted successfully' });
  } catch (err: any) {
    console.error('deleteProject error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function restoreProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const idStr = String(projectId);

    const project = await Project.findOne({
      ...(mongoose.Types.ObjectId.isValid(idStr)
        ? { _id: idStr }
        : { projectId: idStr }),
    });
    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('projects', 'edit'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot restore projects',
        });
        return;
      }
    }

    project.isDeleted = false;
    project.deletedAt = undefined;
    await project.save();

    res.json({
      success: true,
      message: 'Project restored successfully',
      data: project,
    });
  } catch (err: any) {
    console.error('restoreProject error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// PROJECT STATS
//   GET /api/projects/stats
// ═════════════════════════════════════════════════════════════════════════
export async function getProjectStats(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const baseFilter = { isDeleted: false };

    const [
      total,
      open,
      completed,
      cancelled,
      onHold,
      internalCount,
      clientCount,
      overdue,
      dueThisWeek,
      autoProgressCount,
      manualProgressCount,
      byStatusRaw,
      byPriorityRaw,
      byTypeRaw,
      byProgressModeRaw,
      budgetAgg,
      completedBudgetAgg,
      avgCompletionAgg,
      hoursAgg,
    ] = await Promise.all([
      Project.countDocuments(baseFilter),

      Project.countDocuments({ ...baseFilter, status: { $in: OPEN_PROJECT_STATUSES } }),
      Project.countDocuments({ ...baseFilter, status: 'completed' }),
      Project.countDocuments({ ...baseFilter, status: 'cancelled' }),
      Project.countDocuments({ ...baseFilter, status: 'on_hold' }),

      Project.countDocuments({ ...baseFilter, projectType: 'internal' }),
      Project.countDocuments({ ...baseFilter, projectType: 'client' }),

      Project.countDocuments({
        ...baseFilter,
        status: { $in: OPEN_PROJECT_STATUSES },
        deadline: { $lt: new Date() },
      }),

      Project.countDocuments({
        ...baseFilter,
        status: { $in: OPEN_PROJECT_STATUSES },
        deadline: {
          $gte: new Date(),
          $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }),

      Project.countDocuments({ ...baseFilter, progressMode: 'auto' }),
      Project.countDocuments({ ...baseFilter, progressMode: 'manual' }),

      Project.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      Project.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Project.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$projectType', count: { $sum: 1 } } },
      ]),

      Project.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$progressMode', count: { $sum: 1 } } },
      ]),

      Project.aggregate([
        { $match: { ...baseFilter, status: { $in: OPEN_PROJECT_STATUSES } } },
        { $group: { _id: null, total: { $sum: '$budget' } } },
      ]),

      Project.aggregate([
        { $match: { ...baseFilter, status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$budget' } } },
      ]),

      Project.aggregate([
        { $match: { ...baseFilter, status: 'completed' } },
        { $group: { _id: null, avg: { $avg: '$progress' } } },
      ]),

      // Totals across active projects
      Project.aggregate([
        { $match: { ...baseFilter, status: { $in: OPEN_PROJECT_STATUSES } } },
        {
          $group: {
            _id: null,
            estimated: { $sum: '$totalEstimatedHours' },
            actual: { $sum: '$totalActualHours' },
          },
        },
      ]),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of PROJECT_STATUSES) byStatus[s] = 0;
    for (const row of byStatusRaw) {
      const key = String(row._id ?? 'unknown');
      byStatus[key] = (byStatus[key] ?? 0) + row.count;
    }

    const activeEstimate = hoursAgg[0]?.estimated ?? 0;
    const activeActual = hoursAgg[0]?.actual ?? 0;

    res.json({
      success: true,
      data: {
        total,
        open,
        completed,
        cancelled,
        onHold,
        internalCount,
        clientCount,
        overdue,
        dueThisWeek,
        autoProgressCount,
        manualProgressCount,
        breakdown: {
          byStatus,
          byPriority: byPriorityRaw.map((d) => ({
            priority: d._id || 'medium',
            count: d.count,
          })),
          byType: byTypeRaw.map((d) => ({
            projectType: d._id || 'client',
            count: d.count,
          })),
          byProgressMode: byProgressModeRaw.map((d) => ({
            progressMode: d._id || 'auto',
            count: d.count,
          })),
        },
        financials: {
          activeBudget: +(budgetAgg[0]?.total ?? 0).toFixed(2),
          completedBudget: +(completedBudgetAgg[0]?.total ?? 0).toFixed(2),
          avgCompletion: +(avgCompletionAgg[0]?.avg ?? 0).toFixed(2),
          activeEstimatedHours: +Number(activeEstimate).toFixed(2),
          activeActualHours: +Number(activeActual).toFixed(2),
        },
      },
    });
  } catch (err: any) {
    console.error('getProjectStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// PROJECTS FOR A SPECIFIC CLIENT
//   GET /api/clients/:clientId/projects
// ═════════════════════════════════════════════════════════════════════════
export async function listProjectsByClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
      res.status(400).json({ success: false, message: 'Invalid clientId' });
      return;
    }

    const client = await Client.findOne({ _id: clientId, isDeleted: false }).select('_id');
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const projects = await Project.find({
      clientId: client._id,
      projectType: 'client',
      isDeleted: false,
    })
      .populate('projectManager', 'name employeeId designation department')
      .populate('teamMembers', 'name employeeId designation department')
      .sort('-createdAt');

    res.json({ success: true, data: projects });
  } catch (err: any) {
    console.error('listProjectsByClient error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE (permanent)
//   DELETE /api/projects/:projectId/permanent
// ═════════════════════════════════════════════════════════════════════════
export async function hardDeleteProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { projectId } = req.params;
    const idStr = String(projectId);

    if (!req.user!.isMainAdmin) {
      res.status(403).json({
        success: false,
        message: 'Only the main admin can permanently delete projects',
      });
      return;
    }

    const project = await Project.findOne(
      mongoose.Types.ObjectId.isValid(idStr)
        ? { _id: idStr }
        : { projectId: idStr }
    );

    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    if (!project.isDeleted) {
      res.status(400).json({
        success: false,
        message:
          'Project must be soft-deleted first. Call DELETE /projects/:id before permanent delete.',
      });
      return;
    }

    // ── Cascade cleanup ──────────────────────────────────────────────
    // When Task model exists, uncomment and adapt:
    //
    // await Task.deleteMany({ projectId: project._id });
    //
    // For now, nothing else references projects directly.

    await Project.deleteOne({ _id: project._id });

    res.json({
      success: true,
      message: `Project ${project.projectId} permanently deleted`,
      data: { projectId: project.projectId, _id: project._id },
    });
  } catch (err: any) {
    console.error('hardDeleteProject error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}