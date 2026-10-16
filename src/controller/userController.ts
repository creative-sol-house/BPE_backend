// controller/userController.ts
import { Response } from 'express';
import User from '../model/user';
import PendingUser from '../model/pendingUser';
import Role from '../model/role';
import '../model/employee';                                 // 👈 register Employee model for hooks
import Employee, {
  SALARY_STRUCTURES,
  expandScheduleToMonths,
  type ILeaveAllocation,
  type ILeaveSchedule,
  type SalaryStructure,
} from '../model/employee';                                 // 👈 typed access
import { AuthRequest } from '../middleware/auth';
import {
  sendApprovalEmail,
  sendBlockedEmail,
  sendRejectionEmail,
  sendUserCreatedEmail,
} from '../services/emailService';

// ─── Shared helpers (salary / timings / leave) ────────────────────────────
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

interface ExtrasInput {
  salaryStructure?: any;
  basicSalary?: any;
  pieceRateSalary?: any;
  overtimePerHourAmount?: any;
  standardCheckIn?: any;
  standardCheckOut?: any;
  leaveSchedules?: any;
}

interface ParsedSchedule {
  type: string;
  daysPerMonth: number;
  startYear: number;
  startMonth: number;
  endYear?: number;
  endMonth?: number;
  notes?: string;
}

/**
 * Validate the leaveSchedules array. Mirrors employeeController's validator
 * so both entry points behave identically.
 */
function validateLeaveSchedules(input: any): {
  ok: boolean;
  error?: string;
  parsed?: ParsedSchedule[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: 'leaveSchedules must be an array' };
  }
  if (input.length > 50) {
    return { ok: false, error: 'Too many leave schedules (max 50)' };
  }

  const parsed: ParsedSchedule[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: `leaveSchedules[${i}] is invalid` };
    }

    const type = String(raw.type || '').trim();
    if (!type) return { ok: false, error: `leaveSchedules[${i}].type is required` };
    if (type.length > 40) {
      return { ok: false, error: `leaveSchedules[${i}].type is too long (max 40)` };
    }

    const daysPerMonth = Number(raw.daysPerMonth ?? 0);
    if (!Number.isFinite(daysPerMonth) || daysPerMonth < 0 || daysPerMonth > 31) {
      return { ok: false, error: `leaveSchedules[${i}].daysPerMonth must be 0–31` };
    }

    const startYear = Number(raw.startYear);
    if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100) {
      return { ok: false, error: `leaveSchedules[${i}].startYear must be a 4-digit year` };
    }

    const startMonth = Number(raw.startMonth);
    if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
      return { ok: false, error: `leaveSchedules[${i}].startMonth must be 1–12` };
    }

    let endYear: number | undefined;
    let endMonth: number | undefined;
    const hasEnd =
      raw.endYear !== undefined && raw.endYear !== null && raw.endYear !== '' &&
      raw.endMonth !== undefined && raw.endMonth !== null && raw.endMonth !== '';

    if (hasEnd) {
      endYear = Number(raw.endYear);
      endMonth = Number(raw.endMonth);
      if (!Number.isInteger(endYear) || endYear < 2000 || endYear > 2100) {
        return { ok: false, error: `leaveSchedules[${i}].endYear must be a 4-digit year` };
      }
      if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) {
        return { ok: false, error: `leaveSchedules[${i}].endMonth must be 1–12` };
      }
      if (endYear < startYear || (endYear === startYear && endMonth < startMonth)) {
        return { ok: false, error: `leaveSchedules[${i}]: end must not precede start` };
      }
    }

    const key = `${type.toLowerCase()}::${startYear}-${startMonth}`;
    if (seen.has(key)) {
      return {
        ok: false,
        error: `Duplicate schedule for "${type}" starting ${startYear}-${String(startMonth).padStart(2, '0')}`,
      };
    }
    seen.add(key);

    parsed.push({
      type,
      daysPerMonth: +daysPerMonth.toFixed(2),
      startYear,
      startMonth,
      endYear,
      endMonth,
      notes: raw.notes ? String(raw.notes).trim().slice(0, 250) : undefined,
    });
  }

  return { ok: true, parsed };
}

/** Expand parsed schedules to monthly rows, preserving existing usage. */
function expandAndMerge(
  schedules: ParsedSchedule[],
  existing: ILeaveAllocation[],
  fallbackEndYear: number = new Date().getFullYear()
): ILeaveAllocation[] {
  const result: ILeaveAllocation[] = [];

  for (const s of schedules) {
    const asSchedule: ILeaveSchedule = {
      type: s.type,
      daysPerMonth: s.daysPerMonth,
      startYear: s.startYear,
      startMonth: s.startMonth,
      endYear: s.endYear,
      endMonth: s.endMonth,
      notes: s.notes,
    };

    const rows = expandScheduleToMonths(asSchedule, fallbackEndYear);

    for (const r of rows) {
      const prev = existing.find(
        (a) =>
          a.type.trim().toLowerCase() === r.type.trim().toLowerCase() &&
          a.year === r.year &&
          a.month === r.month
      );
      result.push({
        ...r,
        used: prev ? Number(prev.used) || 0 : 0,
        carriedForward: prev ? Number(prev.carriedForward) || 0 : 0,
      });
    }
  }
  return result;
}

/**
 * Wait for the Employee record to exist. The User `post('save')` hook
 * creates it asynchronously, so we poll briefly.
 */
async function findEmployeeForUser(userId: any): Promise<any | null> {
  for (let i = 0; i < 20; i++) {
    const emp = await Employee.findOne({ user: userId });
    if (emp) return emp;
    await new Promise((r) => setTimeout(r, 25));
  }
  return null;
}

/**
 * Apply salary + timings + leave schedules to the linked Employee.
 * Returns an error string if validation failed, otherwise null.
 *
 * Salary lives on Employee, not User. This helper bridges the two.
 * All fields are optional — omitted fields are left untouched.
 */
async function applyEmployeeExtras(
  userId: any,
  input: ExtrasInput
): Promise<{ ok: boolean; error?: string }> {
  const employee = await findEmployeeForUser(userId);
  if (!employee) {
    // No Employee yet — the User hook may have failed, or isEmployee is false.
    return { ok: true };
  }

  let dirty = false;

  // ── Salary structure ──────────────────────────────────────────────────
  if (input.salaryStructure !== undefined && input.salaryStructure !== null) {
    const s = String(input.salaryStructure).trim();
    if (!(SALARY_STRUCTURES as string[]).includes(s)) {
      return {
        ok: false,
        error: `salaryStructure must be one of: ${SALARY_STRUCTURES.join(', ')}`,
      };
    }
    if ((employee as any).salaryStructure !== s) {
      (employee as any).salaryStructure = s as SalaryStructure;
      dirty = true;
    }
  }

  const parseMoney = (raw: any): number | null => {
    if (raw === undefined || raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return null;
    return +n.toFixed(2);
  };

  if (input.basicSalary !== undefined) {
    const v = parseMoney(input.basicSalary);
    if (v === null) return { ok: false, error: 'basicSalary must be a non-negative number' };
    if ((employee as any).basicSalary !== v) {
      (employee as any).basicSalary = v;
      dirty = true;
    }
  }

  if (input.pieceRateSalary !== undefined) {
    const v = parseMoney(input.pieceRateSalary);
    if (v === null) return { ok: false, error: 'pieceRateSalary must be a non-negative number' };
    if ((employee as any).pieceRateSalary !== v) {
      (employee as any).pieceRateSalary = v;
      dirty = true;
    }
  }

  if (input.overtimePerHourAmount !== undefined) {
    const v = parseMoney(input.overtimePerHourAmount);
    if (v === null) return { ok: false, error: 'overtimePerHourAmount must be a non-negative number' };
    if ((employee as any).overtimePerHourAmount !== v) {
      (employee as any).overtimePerHourAmount = v;
      dirty = true;
    }
  }

  // ── Standard timings ──────────────────────────────────────────────────
  if (input.standardCheckIn !== undefined && input.standardCheckIn !== null && input.standardCheckIn !== '') {
    const v = String(input.standardCheckIn);
    if (!TIME_RE.test(v)) {
      return { ok: false, error: 'standardCheckIn must be in HH:mm (24h) format' };
    }
    if ((employee as any).standardCheckIn !== v) {
      (employee as any).standardCheckIn = v;
      dirty = true;
    }
  }

  if (input.standardCheckOut !== undefined && input.standardCheckOut !== null && input.standardCheckOut !== '') {
    const v = String(input.standardCheckOut);
    if (!TIME_RE.test(v)) {
      return { ok: false, error: 'standardCheckOut must be in HH:mm (24h) format' };
    }
    if ((employee as any).standardCheckOut !== v) {
      (employee as any).standardCheckOut = v;
      dirty = true;
    }
  }

  // Cross-check timings if either was set
  if (
    (input.standardCheckIn !== undefined || input.standardCheckOut !== undefined) &&
    (employee as any).standardCheckIn &&
    (employee as any).standardCheckOut
  ) {
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    if (toMin((employee as any).standardCheckOut) <= toMin((employee as any).standardCheckIn)) {
      return { ok: false, error: 'standardCheckOut must be later than standardCheckIn' };
    }
  }

  // ── Leave schedules ───────────────────────────────────────────────────
  if (input.leaveSchedules !== undefined) {
    const leaveRes = validateLeaveSchedules(input.leaveSchedules);
    if (!leaveRes.ok) return { ok: false, error: leaveRes.error };

    const parsed = leaveRes.parsed ?? [];
    const expanded = expandAndMerge(
      parsed,
      (employee as any).leaveAllocations ?? [],
      new Date().getFullYear()
    );

    (employee as any).leaveSchedules = parsed as ILeaveSchedule[];
    (employee as any).leaveAllocations = expanded;
    employee.markModified('leaveSchedules');
    employee.markModified('leaveAllocations');
    dirty = true;
  }

  if (dirty) {
    await employee.save();
  }

  return { ok: true };
}

// ─── List Pending Registrations ───────────────────────────────────────────
export async function listPendingUsers(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const pending = await PendingUser.find({ isEmailVerified: true })
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: pending });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Approve User ─────────────────────────────────────────────────────────
export async function approveUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      pendingUserId,
      roleId,
      department,
      permissions,
      permissionMode,
      isEmployee,
      isMainAdmin,                                  // 👈 main admin flag

      // 👇 extras (salary / timings / leave)
      salaryStructure,
      basicSalary,
      pieceRateSalary,
      overtimePerHourAmount,
      standardCheckIn,
      standardCheckOut,
      leaveSchedules,
    } = req.body;

    const pending = await PendingUser.findById(pendingUserId).select('+password');
    if (!pending) {
      res.status(404).json({ success: false, message: 'Pending user not found' });
      return;
    }

    if (!pending.isEmailVerified) {
      res.status(400).json({ success: false, message: 'User has not verified their email' });
      return;
    }

    const existing = await User.findOne({ email: pending.email });
    if (existing) {
      res.status(409).json({ success: false, message: 'User already approved' });
      return;
    }

    // ── Cannot grant permissions the actor doesn't hold (non-admins) ──
    if (permissions && permissions.length && !req.user!.isMainAdmin) {
      for (const p of permissions) {
        for (const a of p.actions) {
          if (!(await req.user!.can(p.module, a))) {
            res.status(403).json({
              success: false,
              message: `You cannot grant "${a}" on "${p.module}"`,
            });
            return;
          }
        }
      }
    }

    // Only a main admin can approve someone AS a main admin
    if (isMainAdmin === true && !req.user!.isMainAdmin) {
      res.status(403).json({
        success: false,
        message: 'Only a main admin can approve as main admin',
      });
      return;
    }

    // Validate role & department
    let roleDoc: any = null;
    if (roleId) {
      roleDoc = await Role.findOne({ _id: roleId, isDeleted: false, isActive: true });
      if (!roleDoc) {
        res.status(400).json({ success: false, message: 'Invalid role' });
        return;
      }
      if (department) {
        const hasDept = roleDoc.departments.some(
          (d: any) => d.name.trim().toLowerCase() === department.trim().toLowerCase()
        );
        if (!hasDept) {
          res.status(400).json({
            success: false,
            message: `Department "${department}" is not defined in role "${roleDoc.name}"`,
          });
          return;
        }
      }
    }

    // Create user from pending (password is already bcrypt-hashed)
    const user = new User({
      name: pending.name,
      username: pending.username,
      email: pending.email,
      password: pending.password,
      dob: pending.dob,
      gender: pending.gender,
      cnic: pending.cnic,
      phoneNo: pending.phoneNo,
      designation: pending.designation,
      dateOfJoining: pending.dateOfJoining,
      address: pending.address,
      profileImage: pending.profileImage,
      role: roleId || null,
      department: department || '',
      permissions: permissions || [],
      permissionMode: permissionMode || 'override',
      status: 'active',
      isEmailVerified: true,
      isActive: true,
      isEmployee: isEmployee !== undefined ? Boolean(isEmployee) : true,
      isMainAdmin: isMainAdmin === true,
      createdBy: req.user!._id,
    });

    await user.save();

    await PendingUser.deleteOne({ _id: pending._id });

    // ── Apply salary / timings / leave if provided ──
    const hasExtras =
      salaryStructure !== undefined ||
      basicSalary !== undefined ||
      pieceRateSalary !== undefined ||
      overtimePerHourAmount !== undefined ||
      standardCheckIn !== undefined ||
      standardCheckOut !== undefined ||
      leaveSchedules !== undefined;

    if (hasExtras && user.isEmployee) {
      const extrasRes = await applyEmployeeExtras(user._id, {
        salaryStructure,
        basicSalary,
        pieceRateSalary,
        overtimePerHourAmount,
        standardCheckIn,
        standardCheckOut,
        leaveSchedules,
      });

      if (!extrasRes.ok) {
        // Roll back so admin can retry cleanly
        await User.deleteOne({ _id: user._id });
        await Employee.deleteOne({ user: user._id });
        res.status(400).json({ success: false, message: extrasRes.error });
        return;
      }
    }

    await sendApprovalEmail(
      user.email,
      user.name,
      department || 'N/A',
      roleDoc?.name || 'N/A'
    );

    // Return the linked Employee record (may be null if isEmployee === false)
    const employee = user.isEmployee
      ? await Employee.findOne({ user: user._id, isDeleted: false })
      : null;

    res.json({
      success: true,
      message: 'User approved successfully',
      data: { user: user.toJSON(), employee },
    });
  } catch (err: any) {
    console.error('Approve error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Reject User ──────────────────────────────────────────────────────────
export async function rejectUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { pendingUserId, reason } = req.body;

    const pending = await PendingUser.findById(pendingUserId);
    if (!pending) {
      res.status(404).json({ success: false, message: 'Pending user not found' });
      return;
    }

    await PendingUser.deleteOne({ _id: pending._id });
    await sendRejectionEmail(pending.email, pending.name, reason);

    res.json({ success: true, message: 'User registration rejected' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Block User ───────────────────────────────────────────────────────────
export async function blockUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const { reason } = req.body;

    // Can't block yourself
    if (String(req.user!._id) === String(userId)) {
      res.status(403).json({ success: false, message: 'You cannot block yourself.' });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (user.isMainAdmin) {
      res.status(403).json({ success: false, message: 'Cannot block main admin' });
      return;
    }

    user.status = 'blocked';
    user.isActive = false;
    await user.save();                                        // 👈 post('save') hook syncs Employee → isActive:false

    await sendBlockedEmail(user.email, user.name, reason);

    const employee = user.isEmployee
      ? await Employee.findOne({ user: user._id })
      : null;

    res.json({
      success: true,
      message: 'User blocked successfully',
      data: { user: user.toJSON(), employee },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Unblock User ─────────────────────────────────────────────────────────
export async function unblockUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    user.status = 'active';
    user.isActive = true;
    await user.save();                                        // 👈 post('save') hook syncs Employee → isActive:true

    const employee = user.isEmployee
      ? await Employee.findOne({ user: user._id })
      : null;

    res.json({
      success: true,
      message: 'User unblocked successfully',
      data: { user: user.toJSON(), employee },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── List Users ───────────────────────────────────────────────────────────
export async function listUsers(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      status,
      department,
      role,
      search,
      isEmployee,
      page = '1',
      limit = '20',
    } = req.query;

    const filter: any = { isDeleted: false };
    if (status) filter.status = status;
    if (department) filter.department = department;
    if (role) filter.role = role;
    if (isEmployee !== undefined) filter.isEmployee = isEmployee === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { username: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [users, total] = await Promise.all([
      User.find(filter)
        .populate('role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: users,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get User By ID ───────────────────────────────────────────────────────
export async function getUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const user = await User.findOne({
      _id: req.params.userId,
      isDeleted: false,
    }).populate('role');

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const [effectivePermissions, employee] = await Promise.all([
      user.getEffectivePermissions(),
      user.isEmployee
        ? Employee.findOne({ user: user._id, isDeleted: false })
        : Promise.resolve(null),
    ]);

    res.json({
      success: true,
      data: { user, effectivePermissions, employee },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get Current User (self-service) ──────────────────────────────────────
export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const [effectivePermissions, employee] = await Promise.all([
      req.user.getEffectivePermissions(),
      req.user.isEmployee
        ? Employee.findOne({ user: req.user._id, isDeleted: false })
        : Promise.resolve(null),
    ]);

    res.json({
      success: true,
      data: {
        user: req.user.toJSON(),
        effectivePermissions,
        employee,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Update Own Profile (self-service, no permission needed) ─────────────
export async function updateMyProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    const { name, phoneNo, address, profileImage, emergencyContact } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    if (name !== undefined) user.name = name;
    if (phoneNo !== undefined) user.phoneNo = phoneNo;
    if (address !== undefined) user.address = address;
    if (profileImage !== undefined) user.profileImage = profileImage;
    if (emergencyContact !== undefined) user.emergencyContact = emergencyContact;

    await user.save();                                        // 👈 post('save') hook syncs Employee

    const [effectivePermissions, employee] = await Promise.all([
      user.getEffectivePermissions(),
      user.isEmployee
        ? Employee.findOne({ user: user._id, isDeleted: false })
        : Promise.resolve(null),
    ]);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user: user.toJSON(), effectivePermissions, employee },
    });
  } catch (err: any) {
    console.error('updateMyProfile error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Update User ──────────────────────────────────────────────────────────
export async function updateUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;
    const {
      name,
      username,
      email,
      phoneNo,
      address,
      designation,
      gender,
      dob,
      cnic,
      role,
      department,
      permissions,
      permissionMode,
      isActive,
      status,
      emergencyContact,
      isEmployee,
      isMainAdmin,

      // 👇 salary
      salaryStructure,
      basicSalary,
      pieceRateSalary,
      overtimePerHourAmount,

      // 👇 timings + leave (NEW)
      standardCheckIn,
      standardCheckOut,
      leaveSchedules,
    } = req.body;

    // ── Password changes are not allowed via this endpoint ──
    if (req.body.password !== undefined) {
      res.status(400).json({
        success: false,
        message: 'Password cannot be changed here. Use the password reset flow.',
      });
      return;
    }

    // ── Self-edit must go through /users/me ──
    if (String(req.user!._id) === String(userId)) {
      res.status(403).json({
        success: false,
        message: 'Use /users/me to update your own profile.',
      });
      return;
    }

    const user = await User.findOne({ _id: userId, isDeleted: false });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    // ── Can't touch main admin unless you are main admin ──
    if (user.isMainAdmin && !req.user!.isMainAdmin) {
      res.status(403).json({ success: false, message: 'Cannot modify main admin' });
      return;
    }

    // ── Only a main admin can change the isMainAdmin flag ──
    if (isMainAdmin !== undefined && !req.user!.isMainAdmin) {
      res.status(403).json({
        success: false,
        message: 'Only a main admin can change the main-admin flag',
      });
      return;
    }

    // ── A main admin cannot demote themselves ──
    if (
      isMainAdmin === false &&
      user.isMainAdmin &&
      String(user._id) === String(req.user!._id)
    ) {
      res.status(403).json({
        success: false,
        message: 'You cannot remove your own main-admin status',
      });
      return;
    }

    // ── Can't grant permissions you don't hold (non-admins) ──
    if (permissions && permissions.length && !req.user!.isMainAdmin) {
      for (const p of permissions) {
        for (const a of p.actions) {
          if (!(await req.user!.can(p.module, a))) {
            res.status(403).json({
              success: false,
              message: `You cannot grant "${a}" on "${p.module}"`,
            });
            return;
          }
        }
      }
    }

    // ── Changing role/department requires roles:edit (non-admins) ──
    if ((role !== undefined || department !== undefined) && !req.user!.isMainAdmin) {
      if (!(await req.user!.can('roles', 'edit'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot change role/department without roles:edit',
        });
        return;
      }
    }

    // ── Validate role & department pairing ──
    if (role !== undefined || department !== undefined) {
      const newRole = role ?? user.role;
      const newDept = department ?? user.department;

      if (newRole) {
        const roleDoc = await Role.findOne({
          _id: newRole,
          isDeleted: false,
          isActive: true,
        });
        if (!roleDoc) {
          res.status(400).json({ success: false, message: 'Invalid role' });
          return;
        }
        const hasDept = roleDoc.departments.some(
          (d: any) =>
            d.name.trim().toLowerCase() ===
            String(newDept).trim().toLowerCase()
        );
        if (!hasDept) {
          res.status(400).json({
            success: false,
            message: `Department "${newDept}" is not defined in role "${roleDoc.name}"`,
          });
          return;
        }
      }
    }

    // ── Username validation + uniqueness ──
    if (username !== undefined && username !== user.username) {
      const normalizedUsername = String(username).trim().toLowerCase();

      if (normalizedUsername.length < 3 || normalizedUsername.length > 30) {
        res.status(400).json({
          success: false,
          message: 'Username must be 3–30 characters',
        });
        return;
      }

      if (!/^[a-z0-9._]+$/.test(normalizedUsername)) {
        res.status(400).json({
          success: false,
          message: 'Invalid username format. Allowed: lowercase letters, digits, dot, underscore',
        });
        return;
      }

      const dup = await User.findOne({
        _id: { $ne: user._id },
        username: normalizedUsername,
      });
      if (dup) {
        res.status(409).json({
          success: false,
          message: 'Username is already taken',
        });
        return;
      }
    }

    // ── Email validation + uniqueness ──
    if (email !== undefined && email) {
      const normalizedEmail = String(email).trim().toLowerCase();

      if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
        res.status(400).json({ success: false, message: 'Invalid email format' });
        return;
      }

      if (normalizedEmail !== user.email) {
        const dup = await User.findOne({
          _id: { $ne: user._id },
          email: normalizedEmail,
        });
        if (dup) {
          res.status(409).json({
            success: false,
            message: 'Email is already registered to another user',
          });
          return;
        }
      }
    }

    // ── Gender validation ──
    if (gender !== undefined && !['male', 'female'].includes(gender)) {
      res.status(400).json({
        success: false,
        message: 'Invalid gender. Allowed: male, female',
      });
      return;
    }

    // ── CNIC validation + uniqueness ──
    if (cnic !== undefined && !/^\d{5}-\d{7}-\d{1}$/.test(String(cnic))) {
      res.status(400).json({
        success: false,
        message: 'Invalid CNIC format. Expected: 12345-1234567-1',
      });
      return;
    }
    if (cnic !== undefined && cnic !== user.cnic) {
      const dup = await User.findOne({ _id: { $ne: user._id }, cnic });
      if (dup) {
        res.status(409).json({
          success: false,
          message: 'CNIC is already registered',
        });
        return;
      }
    }

    // ── Apply User fields ──
    if (name !== undefined) user.name = name;
    if (username !== undefined && username !== user.username) {
      user.username = String(username).trim().toLowerCase();
    }
    if (email !== undefined && email) {
      user.email = String(email).trim().toLowerCase();
    }
    if (phoneNo !== undefined) user.phoneNo = phoneNo;
    if (address !== undefined) user.address = address;
    if (designation !== undefined) user.designation = designation;
    if (gender !== undefined) user.gender = gender;
    if (dob !== undefined) user.dob = dob;
    if (cnic !== undefined) user.cnic = cnic;
    if (role !== undefined) user.role = role;
    if (department !== undefined) user.department = department;
    if (permissions !== undefined) user.permissions = permissions;
    if (permissionMode !== undefined) user.permissionMode = permissionMode;
    if (isActive !== undefined) user.isActive = isActive;
    if (status !== undefined) user.status = status;
    if (emergencyContact !== undefined) user.emergencyContact = emergencyContact;
    if (isEmployee !== undefined) user.isEmployee = Boolean(isEmployee);
    if (isMainAdmin !== undefined) user.isMainAdmin = Boolean(isMainAdmin);

    await user.save();     // hook mirrors shared fields to Employee

    // ── Salary + timings + leave → write to linked Employee ─────────────
    const hasExtras =
      salaryStructure !== undefined ||
      basicSalary !== undefined ||
      pieceRateSalary !== undefined ||
      overtimePerHourAmount !== undefined ||
      standardCheckIn !== undefined ||
      standardCheckOut !== undefined ||
      leaveSchedules !== undefined;

    if (hasExtras && user.isEmployee && !user.isDeleted) {
      const extrasRes = await applyEmployeeExtras(user._id, {
        salaryStructure,
        basicSalary,
        pieceRateSalary,
        overtimePerHourAmount,
        standardCheckIn,
        standardCheckOut,
        leaveSchedules,
      });

      if (!extrasRes.ok) {
        res.status(400).json({ success: false, message: extrasRes.error });
        return;
      }
    }

    const [effectivePermissions, employee] = await Promise.all([
      user.getEffectivePermissions(),
      user.isEmployee
        ? Employee.findOne({ user: user._id, isDeleted: false })
        : Promise.resolve(null),
    ]);

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: user.toJSON(), effectivePermissions, employee },
    });
  } catch (err: any) {
    console.error('updateUser error:', err);

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

// ─── Delete User ──────────────────────────────────────────────────────────
export async function deleteUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;

    // ── Can't delete yourself ──
    if (String(req.user!._id) === String(userId)) {
      res.status(403).json({ success: false, message: 'You cannot delete yourself.' });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }
    if (user.isMainAdmin) {
      res.status(403).json({ success: false, message: 'Cannot delete main admin' });
      return;
    }

    user.isDeleted = true;
    user.status = 'blocked';
    user.isActive = false;
    await user.save();                                        // 👈 post('save') hook marks Employee isDeleted:true

    // 👈 belt-and-suspenders: ensure Employee is flagged even if hook silently failed
    await Employee.updateOne(
      { user: user._id },
      { $set: { isDeleted: true, isActive: false } }
    );

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Create User (direct — admin adds someone without registration) ──────
export async function createUser(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      name,
      username,
      email,
      password,
      dob,
      gender,
      cnic,
      phoneNo,
      designation,
      dateOfJoining,
      address,
      profileImage,
      role: roleId,
      department,
      permissions,
      permissionMode,
      isEmployee,
      isMainAdmin,

      // 👇 salary
      salaryStructure,
      basicSalary,
      pieceRateSalary,
      overtimePerHourAmount,

      // 👇 timings + leave
      standardCheckIn,
      standardCheckOut,
      leaveSchedules,
    } = req.body;

    // ── 1. Required fields ───────────────────────────────────────────────
    const required = {
      name,
      username,
      email,
      password,
      dob,
      gender,
      cnic,
      phoneNo,
      designation,
      dateOfJoining,
    };
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

    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters',
      });
      return;
    }

    // ── 2. Uniqueness checks (case-insensitive) ──────────────────────────
    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedUsername = String(username).trim().toLowerCase();

    const [existingUser, existingPending] = await Promise.all([
      User.findOne({
        $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
      }),
      PendingUser.findOne({
        $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
      }),
    ]);

    if (existingUser || existingPending) {
      res.status(409).json({
        success: false,
        message: 'Email or username is already registered',
      });
      return;
    }

    // Guard CNIC separately (unique index would otherwise throw a 500)
    const existingCnic = await User.findOne({ cnic });
    if (existingCnic) {
      res.status(409).json({
        success: false,
        message: 'CNIC is already registered',
      });
      return;
    }

    // ── 3. Can't grant permissions you don't hold (non-admins) ───────────
    if (permissions && permissions.length && !req.user!.isMainAdmin) {
      for (const p of permissions) {
        for (const a of p.actions) {
          if (!(await req.user!.can(p.module, a))) {
            res.status(403).json({
              success: false,
              message: `You cannot grant "${a}" on "${p.module}"`,
            });
            return;
          }
        }
      }
    }

    // Only a main admin can create another main admin
    if (isMainAdmin === true && !req.user!.isMainAdmin) {
      res.status(403).json({
        success: false,
        message: 'Only a main admin can create another main admin',
      });
      return;
    }

    // ── 4. Assigning role/department requires roles:edit (non-admins) ────
    if ((roleId || department) && !req.user!.isMainAdmin) {
      if (!(await req.user!.can('roles', 'edit'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot assign role/department without roles:edit',
        });
        return;
      }
    }

    // ── 5. Validate role + department pairing ────────────────────────────
    let roleDoc: any = null;
    if (roleId) {
      roleDoc = await Role.findOne({
        _id: roleId,
        isDeleted: false,
        isActive: true,
      });
      if (!roleDoc) {
        res.status(400).json({ success: false, message: 'Invalid role' });
        return;
      }
      if (department) {
        const hasDept = roleDoc.departments.some(
          (d: any) =>
            d.name.trim().toLowerCase() ===
            String(department).trim().toLowerCase()
        );
        if (!hasDept) {
          res.status(400).json({
            success: false,
            message: `Department "${department}" is not defined in role "${roleDoc.name}"`,
          });
          return;
        }
      }
    }

    // ── 6. Create the user ───────────────────────────────────────────────
    const user = new User({
      name: String(name).trim(),
      username: normalizedUsername,
      email: normalizedEmail,
      password,
      dob,
      gender,
      cnic,
      phoneNo,
      designation,
      dateOfJoining,
      address: address || undefined,
      profileImage: profileImage || null,
      role: roleId || null,
      department: department || '',
      permissions: permissions || [],
      permissionMode: permissionMode || 'override',
      status: 'active',
      isEmailVerified: true,
      isActive: true,
      isEmployee: isEmployee !== undefined ? Boolean(isEmployee) : true,
      isMainAdmin: isMainAdmin === true,
      createdBy: req.user!._id,
    });

    await user.save(); // post('save') hook creates Employee if isEmployee

    // ── 6b. Apply salary / timings / leave to the freshly-created Employee ─
    const hasExtras =
      salaryStructure !== undefined ||
      basicSalary !== undefined ||
      pieceRateSalary !== undefined ||
      overtimePerHourAmount !== undefined ||
      standardCheckIn !== undefined ||
      standardCheckOut !== undefined ||
      leaveSchedules !== undefined;

    if (hasExtras && user.isEmployee) {
      const extrasRes = await applyEmployeeExtras(user._id, {
        salaryStructure,
        basicSalary,
        pieceRateSalary,
        overtimePerHourAmount,
        standardCheckIn,
        standardCheckOut,
        leaveSchedules,
      });

      if (!extrasRes.ok) {
        // Roll back the user so the admin can retry cleanly
        await User.deleteOne({ _id: user._id });
        await Employee.deleteOne({ user: user._id });
        res.status(400).json({ success: false, message: extrasRes.error });
        return;
      }
    }

    // ── 7. Send welcome email (best-effort — never fail the request) ─────
    try {
      await sendUserCreatedEmail(
        user.email,
        user.name,
        user.username,
        password,
        roleDoc?.name,
        department
      );
    } catch (emailErr) {
      console.error('createUser: welcome email failed:', emailErr);
    }

    // Return the linked Employee record
    const employee = user.isEmployee
      ? await Employee.findOne({ user: user._id, isDeleted: false })
      : null;

    res.status(201).json({
      success: true,
      message: 'User created and credentials emailed',
      data: { user: user.toJSON(), employee },
    });
  } catch (err: any) {
    console.error('createUser error:', err);

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