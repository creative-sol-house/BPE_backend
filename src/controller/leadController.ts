// controller/leadController.ts — imports (top of file)
import { Response } from 'express';
import mongoose from 'mongoose';
import Lead, {
  LEAD_STATUSES,
  LEAD_PRIORITIES,
  LEAD_SOURCES,
  LEAD_TEMPERATURES,
  LEAD_ACTIVITY_TYPES,
  OPEN_LEAD_STATUSES,
  isObjectIdLike,
  SERVICE_LABEL_MAX_LENGTH,
  type LeadStatus,
  type LeadPriority,
  type LeadSource,
  type LeadTemperature,
} from '../model/lead';
import Client from '../model/client';
import Employee from '../model/employee';
import Service from '../model/service';   // 👈 adjust path if needed
import { AuthRequest } from '../middleware/auth';

/**
 * Resolves an incoming `serviceId` value (from a dropdown pick, OR a free-text
 * label the user typed) into the pair `{ serviceId, serviceLabel }`.
 *
 * - Looks like an ObjectId + exists in DB → returns `{ serviceId: id, serviceLabel: undefined }`
 * - Looks like an ObjectId but NOT found   → returns `{ error }`
 * - Anything else (free text)              → returns `{ serviceId: null, serviceLabel: text }`
 * - Empty/null                             → returns `{ serviceId: null, serviceLabel: undefined }`
 */
async function resolveServiceInput(
  input: unknown
): Promise<
  | { ok: true; serviceId: mongoose.Types.ObjectId | null; serviceLabel: string | undefined }
  | { ok: false; error: string }
> {
  if (input === undefined || input === null || String(input).trim() === '') {
    return { ok: true, serviceId: null, serviceLabel: undefined };
  }

  const s = String(input).trim();

  if (isObjectIdLike(s)) {
    // It *looks* like a real Service id → confirm it exists
    const svc = await Service.findOne({ _id: s, isDeleted: false }).select('_id');
    if (!svc) {
      // An ObjectId-looking value that isn't found could still be intended
      // as text, but that's dangerous (users pasting hex strings). Reject.
      return { ok: false, error: 'Service not found' };
    }
    return { ok: true, serviceId: svc._id, serviceLabel: undefined };
  }

  // Free text
  return {
    ok: true,
    serviceId: null,
    serviceLabel: s.slice(0, SERVICE_LABEL_MAX_LENGTH),
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const EMAIL_RE = /^\S+@\S+\.\S+$/;

function validateActivities(input: any): { ok: boolean; error?: string; parsed?: any[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'activities must be an array' };
  if (input.length > 200) return { ok: false, error: 'Too many activities (max 200)' };

  const parsed: any[] = [];
  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (!a || typeof a !== 'object') {
      return { ok: false, error: `activities[${i}] is invalid` };
    }
    const type = String(a.type || '').trim();
    if (!LEAD_ACTIVITY_TYPES.includes(type as any)) {
      return {
        ok: false,
        error: `activities[${i}].type must be one of: ${LEAD_ACTIVITY_TYPES.join(', ')}`,
      };
    }
    const description = String(a.description || '').trim();
    if (!description) {
      return { ok: false, error: `activities[${i}].description is required` };
    }
    parsed.push({
      type,
      description: description.slice(0, 1000),
      performedBy: a.performedBy && mongoose.Types.ObjectId.isValid(String(a.performedBy))
        ? a.performedBy
        : null,
      performedAt: a.performedAt ? new Date(a.performedAt) : new Date(),
    });
  }
  return { ok: true, parsed };
}

function validateAttachments(input: any): { ok: boolean; error?: string; parsed?: any[] } {
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
      uploadedBy: f.uploadedBy && mongoose.Types.ObjectId.isValid(String(f.uploadedBy))
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
  for (let i = 0; i < input.length; i++) {
    const raw = String(input[i] || '').trim();
    if (!raw) continue;
    const t = raw.slice(0, 50);
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(t);
  }
  return { ok: true, parsed };
}

/** Common ObjectId-or-leadId lookup query. */
function buildLookupQuery(idStr: string, onlyActive = true) {
  const base: any = mongoose.Types.ObjectId.isValid(idStr)
    ? { _id: idStr }
    : { leadId: idStr };
  if (onlyActive) base.isDeleted = false;
  return base;
}

// ═════════════════════════════════════════════════════════════════════════
// CREATE LEAD
//   POST /api/leads
// ═════════════════════════════════════════════════════════════════════════
// ═════════════════════════════════════════════════════════════════════════
// CREATE LEAD
//   POST /api/leads
// ═════════════════════════════════════════════════════════════════════════
export async function createLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      // prospect
      name,
      companyName,
      email,
      phoneNo,
      alternatePhoneNo,
      website,
      // opportunity
      serviceId,
      requirement,
      estimatedBudget,
      currency,
      expectedStartDate,
      // pipeline
      status,
      priority,
      source,
      temperature,
      probability,
      // assignment
      assignedTo,
      // follow-up
      nextFollowUpDate,
      lastContactedAt,
      // notes / activity / attachments
      notes,
      activities,
      attachments,
      tags,
      // audit
      createdBy,
    } = req.body;

    // ── 1. Required fields ───────────────────────────────────────────────
    const required: Record<string, any> = { name, phoneNo };
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

    // ── 1b. Enum checks ──────────────────────────────────────────────────
    if (status !== undefined && !LEAD_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${LEAD_STATUSES.join(', ')}`,
      });
      return;
    }
    if (priority !== undefined && !LEAD_PRIORITIES.includes(priority)) {
      res.status(400).json({
        success: false,
        message: `Invalid priority. Allowed: ${LEAD_PRIORITIES.join(', ')}`,
      });
      return;
    }
    if (source !== undefined && !LEAD_SOURCES.includes(source)) {
      res.status(400).json({
        success: false,
        message: `Invalid source. Allowed: ${LEAD_SOURCES.join(', ')}`,
      });
      return;
    }
    if (temperature !== undefined && !LEAD_TEMPERATURES.includes(temperature)) {
      res.status(400).json({
        success: false,
        message: `Invalid temperature. Allowed: ${LEAD_TEMPERATURES.join(', ')}`,
      });
      return;
    }

    // ── 1c. Email check ──────────────────────────────────────────────────
    if (email !== undefined && email !== null && email !== '') {
      if (!EMAIL_RE.test(String(email))) {
        res.status(400).json({ success: false, message: 'Invalid email format' });
        return;
      }
    }

    // ── 1d. Probability check ────────────────────────────────────────────
    if (probability !== undefined && probability !== null && probability !== '') {
      const p = Number(probability);
      if (!Number.isInteger(p) || p < 0 || p > 100) {
        res.status(400).json({
          success: false,
          message: 'probability must be an integer between 0 and 100',
        });
        return;
      }
    }

    // ── 1e. estimatedBudget check ────────────────────────────────────────
    if (estimatedBudget !== undefined && estimatedBudget !== null && estimatedBudget !== '') {
      const b = Number(estimatedBudget);
      if (!Number.isFinite(b) || b < 0) {
        res.status(400).json({
          success: false,
          message: 'estimatedBudget must be a non-negative number',
        });
        return;
      }
    }

    // ── 1f. Sub-arrays ───────────────────────────────────────────────────
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

    // ── 1g. assignedTo must be valid employee ────────────────────────────
    let assigneeId: mongoose.Types.ObjectId | null = null;
    if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(String(assignedTo))) {
        res.status(400).json({ success: false, message: 'Invalid assignedTo id' });
        return;
      }
      const emp = await Employee.findOne({
        _id: assignedTo,
        isDeleted: false,
      }).select('_id');
      if (!emp) {
        res.status(400).json({ success: false, message: 'assignedTo employee not found' });
        return;
      }
      assigneeId = emp._id;
    }

    // ── 1h. createdBy must be valid employee (optional) ──────────────────
    let creatorId: mongoose.Types.ObjectId | null = null;
    if (createdBy) {
      if (!mongoose.Types.ObjectId.isValid(String(createdBy))) {
        res.status(400).json({ success: false, message: 'Invalid createdBy id' });
        return;
      }
      const emp = await Employee.findOne({
        _id: createdBy,
        isDeleted: false,
      }).select('_id');
      if (!emp) {
        res.status(400).json({ success: false, message: 'createdBy employee not found' });
        return;
      }
      creatorId = emp._id;
    }

    // ── 1i. serviceId: accept either a real Service id OR a free-text label ──
    const svcRes = await resolveServiceInput(serviceId);
    if (!svcRes.ok) {
      res.status(400).json({ success: false, message: svcRes.error });
      return;
    }

    // ── 2. Create ────────────────────────────────────────────────────────
    const lead = new Lead({
      name: String(name).trim(),
      companyName: companyName ? String(companyName).trim() : undefined,
      email: email ? String(email).trim().toLowerCase() : undefined,
      phoneNo: String(phoneNo).trim(),
      alternatePhoneNo: alternatePhoneNo ? String(alternatePhoneNo).trim() : undefined,
      website: website ? String(website).trim() : undefined,

      // Route to FK or label based on what the user supplied
      serviceId: svcRes.serviceId,
      serviceLabel: svcRes.serviceLabel,

      requirement: requirement ? String(requirement).trim() : undefined,
      estimatedBudget:
        estimatedBudget !== undefined && estimatedBudget !== null && estimatedBudget !== ''
          ? Number(estimatedBudget)
          : 0,
      currency: currency ? String(currency).toUpperCase() : 'PKR',
      expectedStartDate: expectedStartDate ? new Date(expectedStartDate) : undefined,

      status: (status as LeadStatus) || 'new',
      priority: (priority as LeadPriority) || 'medium',
      source: (source as LeadSource) || 'other',
      temperature: (temperature as LeadTemperature) || 'warm',
      probability:
        probability !== undefined && probability !== null && probability !== ''
          ? Number(probability)
          : 0,

      assignedTo: assigneeId,
      assignedAt: assigneeId ? new Date() : undefined,

      nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : undefined,
      lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : undefined,

      notes: notes ? String(notes).trim() : undefined,
      activities: activitiesRes.parsed ?? [],
      attachments: attachmentsRes.parsed ?? [],
      tags: tagsRes.parsed ?? [],

      createdBy: creatorId,
    });

    await lead.save();

    // Populate for the response so the frontend gets serviceDisplay, etc.
    const fresh = await Lead.findById(lead._id)
      .populate('assignedTo', 'name employeeId designation department')
      .populate('serviceId', 'name code')
      .populate('createdBy', 'name employeeId');

    res.status(201).json({
      success: true,
      message: 'Lead created successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('createLead error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── List Leads ───────────────────────────────────────────────────────────
export async function listLeads(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      status,
      priority,
      source,
      temperature,
      assignedTo,
      serviceId,
      // follow-up filters
      overdueFollowUp,
      followUpBefore,
      followUpAfter,
      // budget
      budgetMin,
      budgetMax,
      // search
      search,
      tags,
      onlyDeleted,
      onlyConverted,
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
        .filter((s): s is LeadStatus => (LEAD_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    if (priority) filter.priority = priority;
    if (source) filter.source = source;
    if (temperature) filter.temperature = temperature;

    // ── Assignment ───────────────────────────────────────────────────────
    if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(String(assignedTo))) {
        res.status(400).json({
          success: false,
          message: 'Invalid assignedTo id',
        });
        return;
      }
      filter.assignedTo = assignedTo;
    }

    // ── Service: match FK when it's an ObjectId, else match the free-text label ──
    if (serviceId !== undefined && serviceId !== null && String(serviceId).trim() !== '') {
      const s = String(serviceId).trim();
      if (isObjectIdLike(s)) {
        filter.serviceId = s;
      } else {
        filter.serviceLabel = { $regex: s, $options: 'i' };
      }
    }

    // ── Follow-up ────────────────────────────────────────────────────────
    if (overdueFollowUp === 'true') {
      filter.status = filter.status || { $in: OPEN_LEAD_STATUSES };
      filter.nextFollowUpDate = { ...(filter.nextFollowUpDate || {}), $lt: new Date() };
    } else {
      if (followUpBefore) {
        filter.nextFollowUpDate = {
          ...(filter.nextFollowUpDate || {}),
          $lte: new Date(String(followUpBefore)),
        };
      }
      if (followUpAfter) {
        filter.nextFollowUpDate = {
          ...(filter.nextFollowUpDate || {}),
          $gte: new Date(String(followUpAfter)),
        };
      }
    }

    // ── Budget range ─────────────────────────────────────────────────────
    if (budgetMin !== undefined || budgetMax !== undefined) {
      filter.estimatedBudget = {};
      if (budgetMin !== undefined) filter.estimatedBudget.$gte = Number(budgetMin);
      if (budgetMax !== undefined) filter.estimatedBudget.$lte = Number(budgetMax);
    }

    // ── Tags (any-of match) ──────────────────────────────────────────────
    if (tags) {
      const tagList = String(tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length) filter.tags = { $in: tagList };
    }

    // ── Converted ────────────────────────────────────────────────────────
    if (onlyConverted === 'true') {
      filter.status = 'won';
      filter.clientId = { $ne: null };
    }

    // ── Search ───────────────────────────────────────────────────────────
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { companyName: { $regex: search, $options: 'i' } },
        { leadId: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNo: { $regex: search, $options: 'i' } },
        { requirement: { $regex: search, $options: 'i' } },
        { serviceLabel: { $regex: search, $options: 'i' } },   // 👈 include custom service in free-text search
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .populate('assignedTo', 'name employeeId designation department')
        .populate('serviceId', 'name code')
        .populate('clientId', 'clientId name')
        .populate('createdBy', 'name employeeId')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Lead.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: leads,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listLeads error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}
// ─── Get Lead By ID ───────────────────────────────────────────────────────
export async function getLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const idStr = String(leadId);

    const query = buildLookupQuery(idStr);

    const lead = await Lead.findOne(query)
      .populate('assignedTo', 'name employeeId designation department phoneNo email')
      .populate('serviceId', 'name code description')
      .populate('clientId', 'clientId name clientType status')
      .populate('convertedBy', 'name employeeId')
      .populate('createdBy', 'name employeeId')
      .populate('activities.performedBy', 'name employeeId')
      .populate('attachments.uploadedBy', 'name employeeId');

    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    res.json({ success: true, data: lead });
  } catch (err: any) {
    console.error('getLead error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Update Lead ──────────────────────────────────────────────────────────
export async function updateLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const idStr = String(leadId);

    const {
      name,
      companyName,
      email,
      phoneNo,
      alternatePhoneNo,
      website,

      serviceId,
      requirement,
      estimatedBudget,
      currency,
      expectedStartDate,

      status,
      priority,
      source,
      temperature,
      probability,

      assignedTo,
      nextFollowUpDate,
      lastContactedAt,

      notes,
      tags,
    } = req.body;

    const query = buildLookupQuery(idStr);

    const lead = await Lead.findOne(query);
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    // ── Permission check ────────────────────────────────────────────────
    const isMainAdmin = req.user!.isMainAdmin;
    const canEdit = await req.user!.can('leads', 'edit');
    if (!isMainAdmin && !canEdit) {
      res.status(403).json({
        success: false,
        message: 'You cannot edit leads',
      });
      return;
    }

    // ── Validation ──────────────────────────────────────────────────────
    if (email !== undefined && email !== null && email !== '') {
      if (!EMAIL_RE.test(String(email))) {
        res.status(400).json({ success: false, message: 'Invalid email format' });
        return;
      }
    }
    if (status !== undefined && !LEAD_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${LEAD_STATUSES.join(', ')}`,
      });
      return;
    }
    if (priority !== undefined && !LEAD_PRIORITIES.includes(priority)) {
      res.status(400).json({
        success: false,
        message: `Invalid priority. Allowed: ${LEAD_PRIORITIES.join(', ')}`,
      });
      return;
    }
    if (source !== undefined && !LEAD_SOURCES.includes(source)) {
      res.status(400).json({
        success: false,
        message: `Invalid source. Allowed: ${LEAD_SOURCES.join(', ')}`,
      });
      return;
    }
    if (temperature !== undefined && !LEAD_TEMPERATURES.includes(temperature)) {
      res.status(400).json({
        success: false,
        message: `Invalid temperature. Allowed: ${LEAD_TEMPERATURES.join(', ')}`,
      });
      return;
    }
    if (probability !== undefined && probability !== null && probability !== '') {
      const p = Number(probability);
      if (!Number.isInteger(p) || p < 0 || p > 100) {
        res.status(400).json({
          success: false,
          message: 'probability must be an integer between 0 and 100',
        });
        return;
      }
    }
    if (estimatedBudget !== undefined && estimatedBudget !== null && estimatedBudget !== '') {
      const b = Number(estimatedBudget);
      if (!Number.isFinite(b) || b < 0) {
        res.status(400).json({
          success: false,
          message: 'estimatedBudget must be a non-negative number',
        });
        return;
      }
    }

    let parsedTags: string[] | undefined;
    if (tags !== undefined) {
      const r = validateTags(tags);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedTags = r.parsed;
    }

    // ── Resolve service input (FK or free text) BEFORE mutating ────────
    let resolvedService:
      | { serviceId: mongoose.Types.ObjectId | null; serviceLabel: string | undefined }
      | undefined;

    if (serviceId !== undefined) {
      const svcRes = await resolveServiceInput(serviceId);
      if (!svcRes.ok) {
        res.status(400).json({ success: false, message: svcRes.error });
        return;
      }
      resolvedService = {
        serviceId: svcRes.serviceId,
        serviceLabel: svcRes.serviceLabel,
      };
    }

    // ── Scalar updates ──────────────────────────────────────────────────
    if (name !== undefined) lead.name = String(name).trim();
    if (companyName !== undefined) lead.companyName = companyName || undefined;
    if (email !== undefined) {
      lead.email = email ? String(email).trim().toLowerCase() : undefined;
    }
    if (phoneNo !== undefined) lead.phoneNo = String(phoneNo).trim();
    if (alternatePhoneNo !== undefined) {
      lead.alternatePhoneNo = alternatePhoneNo || undefined;
    }
    if (website !== undefined) lead.website = website || undefined;

    if (resolvedService !== undefined) {
      lead.serviceId = resolvedService.serviceId;
      lead.serviceLabel = resolvedService.serviceLabel;
    }

    if (requirement !== undefined) lead.requirement = requirement || undefined;
    if (estimatedBudget !== undefined && estimatedBudget !== null && estimatedBudget !== '') {
      lead.estimatedBudget = Number(estimatedBudget);
    }
    if (currency !== undefined) lead.currency = String(currency).toUpperCase();
    if (expectedStartDate !== undefined) {
      lead.expectedStartDate = expectedStartDate ? new Date(expectedStartDate) : undefined;
    }

    if (status !== undefined) lead.status = status as LeadStatus;
    if (priority !== undefined) lead.priority = priority as LeadPriority;
    if (source !== undefined) lead.source = source as LeadSource;
    if (temperature !== undefined) lead.temperature = temperature as LeadTemperature;
    if (probability !== undefined && probability !== null && probability !== '') {
      lead.probability = Number(probability);
    }

    if (assignedTo !== undefined) {
      if (assignedTo === null || assignedTo === '') {
        lead.assignedTo = null;
        lead.assignedAt = undefined;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(assignedTo))) {
          res.status(400).json({ success: false, message: 'Invalid assignedTo id' });
          return;
        }
        const emp = await Employee.findOne({
          _id: assignedTo,
          isDeleted: false,
        }).select('_id');
        if (!emp) {
          res.status(400).json({
            success: false,
            message: 'assignedTo employee not found',
          });
          return;
        }
        lead.assignedTo = emp._id;
      }
    }

    if (nextFollowUpDate !== undefined) {
      lead.nextFollowUpDate = nextFollowUpDate ? new Date(nextFollowUpDate) : undefined;
    }
    if (lastContactedAt !== undefined) {
      lead.lastContactedAt = lastContactedAt ? new Date(lastContactedAt) : undefined;
    }

    if (notes !== undefined) lead.notes = notes ? String(notes).trim() : undefined;
    if (parsedTags !== undefined) {
      lead.tags = parsedTags;
      lead.markModified('tags');
    }

    await lead.save();

    const fresh = await Lead.findById(lead._id)
      .populate('assignedTo', 'name employeeId designation department')
      .populate('serviceId', 'name code')
      .populate('clientId', 'clientId name')
      .populate('createdBy', 'name employeeId');

    res.json({
      success: true,
      message: 'Lead updated successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('updateLead error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ACTIVITIES
// ═════════════════════════════════════════════════════════════════════════
export async function addLeadActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const idStr = String(leadId);

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    const r = validateActivities([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid activity' });
      return;
    }
    const activity = r.parsed[0];

    // If the activity is a call/email/meeting/follow_up, bump lastContactedAt
    if (['call', 'email', 'meeting', 'follow_up'].includes(activity.type)) {
      lead.lastContactedAt = activity.performedAt || new Date();
    }

    lead.activities.push(activity);
    lead.markModified('activities');
    await lead.save();

    res.status(201).json({
      success: true,
      message: 'Activity added',
      data: lead.activities,
    });
  } catch (err: any) {
    console.error('addLeadActivity error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeLeadActivity(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId, activityId } = req.params;
    const idStr = String(leadId);

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    const before = lead.activities.length;
    lead.activities = lead.activities.filter(
      (a: any) => String(a._id) !== String(activityId)
    );

    if (lead.activities.length === before) {
      res.status(404).json({ success: false, message: 'Activity not found' });
      return;
    }

    lead.markModified('activities');
    await lead.save();

    res.json({
      success: true,
      message: 'Activity removed',
      data: lead.activities,
    });
  } catch (err: any) {
    console.error('removeLeadActivity error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ATTACHMENTS
// ═════════════════════════════════════════════════════════════════════════
export async function addLeadAttachment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const idStr = String(leadId);

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    const r = validateAttachments([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid attachment' });
      return;
    }
    const attachment = r.parsed[0];

    lead.attachments.push(attachment);
    lead.markModified('attachments');
    await lead.save();

    res.status(201).json({
      success: true,
      message: 'Attachment added',
      data: lead.attachments,
    });
  } catch (err: any) {
    console.error('addLeadAttachment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeLeadAttachment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId, attachmentId } = req.params;
    const idStr = String(leadId);

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    const before = lead.attachments.length;
    lead.attachments = lead.attachments.filter(
      (a: any) => String(a._id) !== String(attachmentId)
    );

    if (lead.attachments.length === before) {
      res.status(404).json({ success: false, message: 'Attachment not found' });
      return;
    }

    lead.markModified('attachments');
    await lead.save();

    res.json({
      success: true,
      message: 'Attachment removed',
      data: lead.attachments,
    });
  } catch (err: any) {
    console.error('removeLeadAttachment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// ASSIGNMENT
// ═════════════════════════════════════════════════════════════════════════
export async function assignLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const { assignedTo } = req.body;
    const idStr = String(leadId);

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    if (assignedTo === null || assignedTo === '') {
      lead.assignedTo = null;
      lead.assignedAt = undefined;
    } else {
      if (!mongoose.Types.ObjectId.isValid(String(assignedTo))) {
        res.status(400).json({ success: false, message: 'Invalid assignedTo id' });
        return;
      }
      const emp = await Employee.findOne({
        _id: assignedTo,
        isDeleted: false,
      }).select('_id');
      if (!emp) {
        res.status(400).json({
          success: false,
          message: 'assignedTo employee not found',
        });
        return;
      }
      lead.assignedTo = emp._id;
      lead.assignedAt = new Date();
    }

    await lead.save();

    const fresh = await Lead.findById(lead._id).populate(
      'assignedTo',
      'name employeeId designation department'
    );

    res.json({
      success: true,
      message: 'Lead assignment updated',
      data: fresh,
    });
  } catch (err: any) {
    console.error('assignLead error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// FOLLOW-UP
// ═════════════════════════════════════════════════════════════════════════
export async function scheduleFollowUp(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const { nextFollowUpDate, notes } = req.body;
    const idStr = String(leadId);

    if (!nextFollowUpDate) {
      res.status(400).json({
        success: false,
        message: 'nextFollowUpDate is required',
      });
      return;
    }

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    const d = new Date(nextFollowUpDate);
    if (isNaN(d.getTime())) {
      res.status(400).json({
        success: false,
        message: 'nextFollowUpDate is not a valid date',
      });
      return;
    }

    lead.nextFollowUpDate = d;

    // Auto-log a follow_up activity if a note is provided
    if (notes && String(notes).trim()) {
      lead.activities.push({
        type: 'follow_up',
        description: String(notes).trim().slice(0, 1000),
        performedBy: req.user?._id ?? null,
        performedAt: new Date(),
      } as any);
      lead.markModified('activities');
    }

    await lead.save();

    res.json({
      success: true,
      message: 'Follow-up scheduled',
      data: {
        nextFollowUpDate: lead.nextFollowUpDate,
        activities: lead.activities,
      },
    });
  } catch (err: any) {
    console.error('scheduleFollowUp error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// STATUS TRANSITIONS
// ═════════════════════════════════════════════════════════════════════════
export async function changeLeadStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const { status, lostReason, notes } = req.body;
    const idStr = String(leadId);

    if (!status || !LEAD_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${LEAD_STATUSES.join(', ')}`,
      });
      return;
    }

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    const previous = lead.status;
    lead.status = status as LeadStatus;

    // If moving to lost/disqualified, capture the reason
    if (['lost', 'disqualified'].includes(lead.status)) {
      lead.lostReason = lostReason
        ? String(lostReason).trim().slice(0, 500)
        : lead.lostReason;
    }

    // If moving away from a closed status, clear stale conversion info when
    // no client has been linked yet.
    if (
      !['won', 'lost', 'disqualified'].includes(lead.status) &&
      !lead.clientId
    ) {
      lead.convertedAt = undefined;
    }

    // Auto-log the status change as an activity
    lead.activities.push({
      type: 'status_change',
      description:
        `Status changed from "${previous}" to "${lead.status}"` +
        (notes ? ` — ${String(notes).trim()}` : ''),
      performedBy: req.user?._id ?? null,
      performedAt: new Date(),
    } as any);
    lead.markModified('activities');

    await lead.save();

    res.json({
      success: true,
      message: 'Lead status updated',
      data: lead,
    });
  } catch (err: any) {
    console.error('changeLeadStatus error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// CONVERT LEAD → CLIENT
//   POST /api/leads/:leadId/convert
// ═════════════════════════════════════════════════════════════════════════
export async function convertLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const idStr = String(leadId);

    // Optional client overrides from the request body
    const {
      // client core
      clientType = 'company',
      tier = 'standard',
      paymentTerms = '30',
      currency,
      // extras to attach to the new client
      contacts,
      addresses,
      bankAccounts,
      creditLimit,
      openingBalance,
      taxExempt,
      industry,
      accountManager,
      // optional: link to an existing client instead of creating a new one
      existingClientId,
    } = req.body || {};

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    if (lead.status === 'won' && lead.clientId) {
      res.status(400).json({
        success: false,
        message: 'Lead is already converted',
      });
      return;
    }

    // ── Permission check ────────────────────────────────────────────────
    const isMainAdmin = req.user!.isMainAdmin;
    const canConvert = await req.user!.can('leads', 'edit');
const canCreateClient = await req.user!.can('clients', 'add');
    if (!isMainAdmin && !(canConvert && canCreateClient)) {
      res.status(403).json({
        success: false,
        message: 'You cannot convert leads',
      });
      return;
    }

    // ── Resolve target client ───────────────────────────────────────────
    let clientId: mongoose.Types.ObjectId;

    if (existingClientId) {
      if (!mongoose.Types.ObjectId.isValid(String(existingClientId))) {
        res.status(400).json({ success: false, message: 'Invalid existingClientId' });
        return;
      }
      const existing = await Client.findOne({
        _id: existingClientId,
        isDeleted: false,
      }).select('_id');
      if (!existing) {
        res.status(400).json({
          success: false,
          message: 'existingClientId not found',
        });
        return;
      }
      clientId = existing._id;
    } else {
      // Create a fresh Client from the Lead snapshot
      const newClient = new Client({
        name: lead.companyName || lead.name,
        clientType,
        displayName: lead.companyName ? lead.name : undefined,
        email: lead.email,
        phoneNo: lead.phoneNo,
        alternatePhoneNo: lead.alternatePhoneNo,
        website: lead.website,

        industry,
        tier,

        contacts: contacts ?? [],
        addresses: addresses ?? [],
        bankAccounts: bankAccounts ?? [],

        creditLimit: creditLimit !== undefined ? Number(creditLimit) : 0,
        openingBalance: openingBalance !== undefined ? Number(openingBalance) : 0,
        currentBalance: openingBalance !== undefined ? Number(openingBalance) : 0,
        currency: currency
          ? String(currency).toUpperCase()
          : lead.currency || 'PKR',
        paymentTerms,
        taxExempt: taxExempt === true,

        status: 'active',
        accountManager: accountManager || null,
      });

      await newClient.save();
      clientId = newClient._id;
    }

    // ── Update the lead ─────────────────────────────────────────────────
    lead.status = 'won';
    lead.clientId = clientId;
    lead.convertedAt = new Date();
    lead.convertedBy = req.user?._id ?? null;
    lead.lostReason = undefined;

    lead.activities.push({
      type: 'status_change',
      description: existingClientId
        ? `Converted to existing client ${existingClientId}`
        : `Converted to new client ${clientId}`,
      performedBy: req.user?._id ?? null,
      performedAt: new Date(),
    } as any);
    lead.markModified('activities');

    await lead.save();

    const fresh = await Lead.findById(lead._id)
      .populate('assignedTo', 'name employeeId designation department')
      .populate('serviceId', 'name code')
      .populate('clientId', 'clientId name clientType status')
      .populate('convertedBy', 'name employeeId');

    res.json({
      success: true,
      message: existingClientId
        ? 'Lead linked to existing client'
        : 'Lead converted to new client successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('convertLead error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// DELETE (soft) / RESTORE
// ═════════════════════════════════════════════════════════════════════════
export async function deleteLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const idStr = String(leadId);

    const lead = await Lead.findOne(buildLookupQuery(idStr));
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('leads', 'delete'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot delete leads',
        });
        return;
      }
    }

    lead.isDeleted = true;
    await lead.save();

    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err: any) {
    console.error('deleteLead error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function restoreLead(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { leadId } = req.params;
    const idStr = String(leadId);

    const lead = await Lead.findOne({
      ...(mongoose.Types.ObjectId.isValid(idStr)
        ? { _id: idStr }
        : { leadId: idStr }),
    });
    if (!lead) {
      res.status(404).json({ success: false, message: 'Lead not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('leads', 'edit'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot restore leads',
        });
        return;
      }
    }

    lead.isDeleted = false;
    lead.deletedAt = undefined;
    await lead.save();

    res.json({
      success: true,
      message: 'Lead restored successfully',
      data: lead,
    });
  } catch (err: any) {
    console.error('restoreLead error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LEAD STATS
// ═════════════════════════════════════════════════════════════════════════
export async function getLeadStats(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const baseFilter = { isDeleted: false };

    const [
      total,
      open,
      won,
      lost,
      disqualified,
      onHold,
      overdueFollowUps,
      dueToday,
      unassigned,
      byStatusRaw,
      byPriorityRaw,
      bySourceRaw,
      byTemperatureRaw,
      byAssigneeRaw,
      pipelineValueAgg,
      wonValueAgg,
      avgDealSizeAgg,
      conversionRateAgg,
    ] = await Promise.all([
      Lead.countDocuments(baseFilter),

      Lead.countDocuments({ ...baseFilter, status: { $in: OPEN_LEAD_STATUSES } }),
      Lead.countDocuments({ ...baseFilter, status: 'won' }),
      Lead.countDocuments({ ...baseFilter, status: 'lost' }),
      Lead.countDocuments({ ...baseFilter, status: 'disqualified' }),
      Lead.countDocuments({ ...baseFilter, status: 'on_hold' }),

      Lead.countDocuments({
        ...baseFilter,
        status: { $in: OPEN_LEAD_STATUSES },
        nextFollowUpDate: { $lt: new Date() },
      }),

      // due "today" — between start and end of today
      Lead.countDocuments({
        ...baseFilter,
        status: { $in: OPEN_LEAD_STATUSES },
        nextFollowUpDate: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      }),

      Lead.countDocuments({ ...baseFilter, assignedTo: null }),

      Lead.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      Lead.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$priority', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Lead.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Lead.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$temperature', count: { $sum: 1 } } },
      ]),

      // Top performers: leads per assignee (open only), sorted desc
      Lead.aggregate([
        {
          $match: {
            ...baseFilter,
            status: { $in: OPEN_LEAD_STATUSES },
            assignedTo: { $ne: null },
          },
        },
        { $group: { _id: '$assignedTo', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      // Pipeline value = sum of estimatedBudget across open leads
      Lead.aggregate([
        {
          $match: {
            ...baseFilter,
            status: { $in: OPEN_LEAD_STATUSES },
          },
        },
        {
          $group: {
            _id: null,
            pipelineValue: { $sum: '$estimatedBudget' },
            weightedValue: {
              $sum: {
                $multiply: [
                  '$estimatedBudget',
                  { $divide: ['$probability', 100] },
                ],
              },
            },
          },
        },
      ]),

      Lead.aggregate([
        { $match: { ...baseFilter, status: 'won' } },
        {
          $group: {
            _id: null,
            wonValue: { $sum: '$estimatedBudget' },
          },
        },
      ]),

      // Average deal size across won leads
      Lead.aggregate([
        { $match: { ...baseFilter, status: 'won', estimatedBudget: { $gt: 0 } } },
        {
          $group: {
            _id: null,
            avgDealSize: { $avg: '$estimatedBudget' },
          },
        },
      ]),

      // Conversion rate = won / (won + lost + disqualified)
      Lead.aggregate([
        {
          $match: {
            ...baseFilter,
            status: { $in: ['won', 'lost', 'disqualified'] },
          },
        },
        {
          $group: {
            _id: null,
            won: { $sum: { $cond: [{ $eq: ['$status', 'won'] }, 1, 0] } },
            closed: { $sum: 1 },
          },
        },
      ]),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of LEAD_STATUSES) byStatus[s] = 0;
    for (const row of byStatusRaw) {
      const key = String(row._id ?? 'unknown');
      byStatus[key] = (byStatus[key] ?? 0) + row.count;
    }

    const byTemperature: Record<string, number> = {
      cold: 0,
      warm: 0,
      hot: 0,
    };
    for (const row of byTemperatureRaw) {
      const key = String(row._id ?? 'unknown');
      byTemperature[key] = (byTemperature[key] ?? 0) + row.count;
    }

    const pipelineValue = pipelineValueAgg[0]?.pipelineValue ?? 0;
    const weightedValue = pipelineValueAgg[0]?.weightedValue ?? 0;
    const wonValue = wonValueAgg[0]?.wonValue ?? 0;
    const avgDealSize = avgDealSizeAgg[0]?.avgDealSize ?? 0;
    const closedWon = conversionRateAgg[0]?.won ?? 0;
    const closedTotal = conversionRateAgg[0]?.closed ?? 0;
    const conversionRate =
      closedTotal > 0 ? +((closedWon / closedTotal) * 100).toFixed(2) : 0;

    // Populate assignee names for the by-assignee breakdown
    const assigneeIds = byAssigneeRaw.map((r) => r._id);
    const employees = await Employee.find({
      _id: { $in: assigneeIds },
      isDeleted: false,
    }).select('name employeeId designation');
    const empMap = new Map(employees.map((e) => [String(e._id), e]));

    const byAssignee = byAssigneeRaw.map((r) => {
      const emp = empMap.get(String(r._id));
      return {
        assignedTo: r._id,
        name: emp?.name ?? '(unknown)',
        employeeId: emp?.employeeId,
        designation: emp?.designation,
        openLeads: r.count,
      };
    });

    res.json({
      success: true,
      data: {
        total,
        open,
        won,
        lost,
        disqualified,
        onHold,
        unassigned,
        overdueFollowUps,
        dueToday,
        breakdown: {
          byStatus,
          byPriority: byPriorityRaw.map((d) => ({
            priority: d._id || 'medium',
            count: d.count,
          })),
          bySource: bySourceRaw.map((d) => ({
            source: d._id || 'other',
            count: d.count,
          })),
          byTemperature,
          byAssignee,
        },
        financials: {
          pipelineValue: +Number(pipelineValue).toFixed(2),
          weightedValue: +Number(weightedValue).toFixed(2),
          wonValue: +Number(wonValue).toFixed(2),
          avgDealSize: +Number(avgDealSize).toFixed(2),
          conversionRate,
        },
      },
    });
  } catch (err: any) {
    console.error('getLeadStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// PIPELINE (kanban-friendly) — counts + top-N per status
//   GET /api/leads/pipeline
// ═════════════════════════════════════════════════════════════════════════
export async function getLeadPipeline(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { assignedTo, perStatus = '10' } = req.query;

    const baseFilter: any = { isDeleted: false };
    if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(String(assignedTo))) {
        res.status(400).json({ success: false, message: 'Invalid assignedTo id' });
        return;
      }
      baseFilter.assignedTo = assignedTo;
    }

    const perStatusNum = Math.min(50, Math.max(1, parseInt(perStatus as string)));

    const pipeline = await Promise.all(
      LEAD_STATUSES.map(async (s) => {
        const filter = { ...baseFilter, status: s };
        const [count, leads] = await Promise.all([
          Lead.countDocuments(filter),
          Lead.find(filter)
            .sort('-priority -createdAt')
            .limit(perStatusNum)
            .select(
              'leadId name companyName phoneNo email status priority temperature probability estimatedBudget currency nextFollowUpDate assignedTo'
            )
            .populate('assignedTo', 'name employeeId'),
        ]);
        return { status: s, count, leads };
      })
    );

    res.json({
      success: true,
      data: pipeline,
    });
  } catch (err: any) {
    console.error('getLeadPipeline error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}