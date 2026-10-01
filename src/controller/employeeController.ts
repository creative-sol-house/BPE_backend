// controller/employeeController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Employee, {
  ACTIVE_STATUSES,
  EMPLOYMENT_STATUSES,
  expandScheduleToMonths,
  type EmploymentStatus,
  type ILeaveAllocation,
  type ILeaveSchedule,
} from '../model/employee';
import User from '../model/user';
import Role from '../model/role';
import { AuthRequest } from '../middleware/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function validateTimings(checkIn?: string, checkOut?: string): string | null {
  if (checkIn !== undefined && checkIn !== null && checkIn !== '') {
    if (!TIME_RE.test(String(checkIn))) {
      return 'standardCheckIn must be in HH:mm (24h) format';
    }
  }
  if (checkOut !== undefined && checkOut !== null && checkOut !== '') {
    if (!TIME_RE.test(String(checkOut))) {
      return 'standardCheckOut must be in HH:mm (24h) format';
    }
  }
  if (checkIn && checkOut) {
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    if (toMin(checkOut) <= toMin(checkIn)) {
      return 'standardCheckOut must be later than standardCheckIn';
    }
  }
  return null;
}

// ─── Leave schedule validation (the "ranges" HR types) ────────────────────
interface ParsedSchedule {
  type: string;
  daysPerMonth: number;
  startYear: number;
  startMonth: number;
  endYear?: number;
  endMonth?: number;
  notes?: string;
}

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
    if (!type) {
      return { ok: false, error: `leaveSchedules[${i}].type is required` };
    }
    if (type.length > 40) {
      return {
        ok: false,
        error: `leaveSchedules[${i}].type is too long (max 40)`,
      };
    }

    const daysPerMonth = Number(raw.daysPerMonth ?? 0);
    if (
      !Number.isFinite(daysPerMonth) ||
      daysPerMonth < 0 ||
      daysPerMonth > 31
    ) {
      return {
        ok: false,
        error: `leaveSchedules[${i}].daysPerMonth must be 0–31`,
      };
    }

    const startYear = Number(raw.startYear);
    if (!Number.isInteger(startYear) || startYear < 2000 || startYear > 2100) {
      return {
        ok: false,
        error: `leaveSchedules[${i}].startYear must be a 4-digit year`,
      };
    }

    const startMonth = Number(raw.startMonth);
    if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
      return {
        ok: false,
        error: `leaveSchedules[${i}].startMonth must be 1–12`,
      };
    }

    // Optional end. If both are missing → continue (open-ended)
    let endYear: number | undefined;
    let endMonth: number | undefined;
    const rawEndY = raw.endYear;
    const rawEndM = raw.endMonth;
    const hasEnd =
      rawEndY !== undefined &&
      rawEndY !== null &&
      rawEndY !== '' &&
      rawEndM !== undefined &&
      rawEndM !== null &&
      rawEndM !== '';

    if (hasEnd) {
      endYear = Number(rawEndY);
      endMonth = Number(rawEndM);
      if (!Number.isInteger(endYear) || endYear < 2000 || endYear > 2100) {
        return {
          ok: false,
          error: `leaveSchedules[${i}].endYear must be a 4-digit year`,
        };
      }
      if (!Number.isInteger(endMonth) || endMonth < 1 || endMonth > 12) {
        return {
          ok: false,
          error: `leaveSchedules[${i}].endMonth must be 1–12`,
        };
      }
      if (
        endYear < startYear ||
        (endYear === startYear && endMonth < startMonth)
      ) {
        return {
          ok: false,
          error: `leaveSchedules[${i}]: end must not precede start`,
        };
      }
    }

    const key = `${type.toLowerCase()}::${startYear}-${startMonth}`;
    if (seen.has(key)) {
      return {
        ok: false,
        error: `Duplicate schedule for "${type}" starting ${startYear}-${String(
          startMonth
        ).padStart(2, '0')}`,
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

// ─── Expand schedules → monthly rows, preserving existing usage ───────────
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
      // Preserve existing used / carriedForward if the row already exists
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

// ═════════════════════════════════════════════════════════════════════════
// CREATE EMPLOYEE
//   POST /api/employees
// ═════════════════════════════════════════════════════════════════════════
export async function createEmployee(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      isUser,
      // ─── always required ───
      name,
      dob,
      gender,
      cnic,
      phoneNo,
      designation,
      dateOfJoining,
      // ─── optional ───
      department,
      address,
      profileImage,
      // ─── standard timings ───
      standardCheckIn,
      standardCheckOut,
      // ─── leave schedule RANGES ───
      leaveSchedules,
      // ─── user-only ───
      username,
      email,
      password,
      role: roleId,
      permissions,
      permissionMode,
    } = req.body;

    // ── 1. Required fields ───────────────────────────────────────────────
    const required: Record<string, any> = {
      name,
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

    // ── 1b. Validate timings ─────────────────────────────────────────────
    const timingError = validateTimings(standardCheckIn, standardCheckOut);
    if (timingError) {
      res.status(400).json({ success: false, message: timingError });
      return;
    }

    // ── 1c. Validate leave schedules and expand to monthly rows ──────────
    // 👇 No seeding — if HR sends nothing, employee starts with zero leaves.
    const leaveRes = validateLeaveSchedules(leaveSchedules);
    if (!leaveRes.ok) {
      res.status(400).json({ success: false, message: leaveRes.error });
      return;
    }
    const parsedSchedules: ParsedSchedule[] = leaveRes.parsed ?? [];

    const expandedAllocations = expandAndMerge(
      parsedSchedules,
      [],
      new Date().getFullYear()
    );

    // ── 2. User-only requirements ────────────────────────────────────────
    if (isUser === true) {
      const userRequired = { username, email, password };
      const userMissing = Object.entries(userRequired)
        .filter(([, v]) => v === undefined || v === null || v === '')
        .map(([k]) => k);

      if (userMissing.length) {
        res.status(400).json({
          success: false,
          message: `When "isUser" is true, these are required: ${userMissing.join(', ')}`,
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
    }

    // ── 3. Path A: user → hook creates Employee ──────────────────────────
    if (isUser === true) {
      const normalizedEmail = String(email).trim().toLowerCase();
      const normalizedUsername = String(username).trim().toLowerCase();

      const [existingUser, existingPending] = await Promise.all([
        User.findOne({
          $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
        }),
        mongoose.model('PendingUser').findOne({
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

      const existingCnic = await User.findOne({ cnic });
      if (existingCnic) {
        res.status(409).json({
          success: false,
          message: 'CNIC is already registered',
        });
        return;
      }

      // Permission escalation check
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

      // Validate role/department
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
        isEmployee: true,
        createdBy: req.user!._id,
      });

      await user.save(); // hook auto-creates Employee

      const employee = await Employee.findOne({
        user: user._id,
        isDeleted: false,
      });

      if (employee) {
        if (standardCheckIn !== undefined) employee.standardCheckIn = standardCheckIn;
        if (standardCheckOut !== undefined) employee.standardCheckOut = standardCheckOut;

        employee.leaveSchedules = parsedSchedules as ILeaveSchedule[];
        employee.leaveAllocations = expandedAllocations;
        employee.markModified('leaveSchedules');
        employee.markModified('leaveAllocations');

        await employee.save();
      }

      res.status(201).json({
        success: true,
        message: 'Employee (with user account) created',
        data: { user: user.toJSON(), employee },
      });
      return;
    }

    // ── 4. Path B: standalone employee ───────────────────────────────────
    const employee = new Employee({
      user: null,
      name: String(name).trim(),
      email: email ? String(email).trim().toLowerCase() : undefined,
      dob,
      gender,
      cnic,
      phoneNo,
      designation,
      dateOfJoining,
      department: department || '',
      address: address || undefined,
      profileImage: profileImage || null,

      standardCheckIn: standardCheckIn || '09:00',
      standardCheckOut: standardCheckOut || '18:00',

      leaveSchedules: parsedSchedules,
      leaveAllocations: expandedAllocations,

      employmentStatus: 'active',
      isActive: true,
      isDeleted: false,
    });

    await employee.save();

    res.status(201).json({
      success: true,
      message: 'Employee created without user account',
      data: { user: null, employee },
    });
  } catch (err: any) {
    console.error('createEmployee error:', err);

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

// ─── List Employees ───────────────────────────────────────────────────────
export async function listEmployees(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      department,
      designation,
      isActive,
      employmentStatus,
      hasUserAccount,
      search,
      page = '1',
      limit = '20',
      sort = '-createdAt',
    } = req.query;

    const filter: any = { isDeleted: false };

    if (department) filter.department = department;
    if (designation) filter.designation = designation;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    if (hasUserAccount !== undefined) {
      filter.user = hasUserAccount === 'true' ? { $ne: null } : null;
    }

    if (employmentStatus) {
      const list = String(employmentStatus)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is EmploymentStatus =>
          (EMPLOYMENT_STATUSES as string[]).includes(s)
        );

      if (list.length === 1) {
        filter.employmentStatus = list[0];
      } else if (list.length > 1) {
        filter.employmentStatus = { $in: list };
      }
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
        { cnic: { $regex: search, $options: 'i' } },
        { phoneNo: { $regex: search, $options: 'i' } },
        { standardCheckIn: { $regex: search, $options: 'i' } },
        { standardCheckOut: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [employees, total] = await Promise.all([
      Employee.find(filter)
        .populate(
          'user',
          'username status isActive isEmailVerified role department'
        )
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Employee.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: employees,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listEmployees error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get Employee By ID ───────────────────────────────────────────────────
export async function getEmployee(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { employeeId } = req.params;
    const { from, to, live } = req.query;
    const idStr = String(employeeId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };

    const employee = await Employee.findOne(query).populate(
      'user',
      'username status isActive isEmailVerified role department permissions permissionMode isMainAdmin'
    );

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const payload: any = employee.toJSON();

    // Optional live recompute from attendance: ?live=true[&from=&to=]
    if (String(live) === 'true') {
      const fromDate = from ? new Date(String(from)) : undefined;
      const toDate = to ? new Date(String(to)) : undefined;
      const liveTotal = await Employee.recomputeTotalWorkingHours(
        employee._id,
        fromDate,
        toDate
      );
      payload.totalWorkingHours = liveTotal;
      payload.totalWorkingHoursRange = {
        from: fromDate ?? null,
        to: toDate ?? null,
      };
    }

    res.json({ success: true, data: payload });
  } catch (err: any) {
    console.error('getEmployee error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get Employee By User ID ──────────────────────────────────────────────
export async function getEmployeeByUserId(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { userId } = req.params;

    const employee = await Employee.findOne({
      user: userId,
      isDeleted: false,
    }).populate(
      'user',
      'username status isActive isEmailVerified role department'
    );

    if (!employee) {
      res.status(404).json({
        success: false,
        message: 'Employee record not found for this user',
      });
      return;
    }

    res.json({ success: true, data: employee });
  } catch (err: any) {
    console.error('getEmployeeByUserId error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get My Employee Record (self-service) ────────────────────────────────
export async function getMyEmployeeRecord(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated' });
      return;
    }

    if (!req.user.isEmployee) {
      res.status(404).json({
        success: false,
        message: 'You do not have an employee record',
      });
      return;
    }

    const employee = await Employee.findOne({
      user: req.user._id,
      isDeleted: false,
    });

    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee record not found' });
      return;
    }

    res.json({ success: true, data: employee });
  } catch (err: any) {
    console.error('getMyEmployeeRecord error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Update Employee ──────────────────────────────────────────────────────
export async function updateEmployee(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { employeeId } = req.params;
    const idStr = String(employeeId);

    const {
      name,
      phoneNo,
      address,
      email,
      gender,
      dob,
      cnic,
      designation,
      department,
      dateOfJoining,
      profileImage,
      employmentStatus,
      statusReason,
      isActive,

      // ONLY these two are editable for timings
      standardCheckIn,
      standardCheckOut,
      refreshTotalWorkingHours, // optional: force recompute from attendance

      // leave schedule RANGES (full replace)
      leaveSchedules,

      // user-account toggle flows
      createUserAccount,
      removeUserAccount,
      username,
      password,
    } = req.body;

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };

    const employee = await Employee.findOne(query);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const linkedUser = employee.user
      ? await User.findOne({ _id: employee.user, isDeleted: false })
      : null;

    // ── Permission check ────────────────────────────────────────────────
    const isMainAdmin = req.user!.isMainAdmin;
    const canEditOthers = await req.user!.can('employees', 'edit');

    if (!isMainAdmin && !canEditOthers) {
      res.status(403).json({
        success: false,
        message: 'You cannot edit employees',
      });
      return;
    }

    // ═════════════════════════════════════════════════════════════════════
    // FLOW A — ATTACH a user account
    // ═════════════════════════════════════════════════════════════════════
    if (createUserAccount === true) {
      if (employee.user) {
        res.status(409).json({
          success: false,
          message: 'This employee already has a user account',
        });
        return;
      }

      const missing: string[] = [];
      if (!username) missing.push('username');
      if (!password) missing.push('password');
      if (!email) missing.push('email');

      if (missing.length) {
        res.status(400).json({
          success: false,
          message: `Required to create user account: ${missing.join(', ')}`,
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

      const normalizedEmail = String(email).trim().toLowerCase();
      const normalizedUsername = String(username).trim().toLowerCase();

      const [existingUser, existingPending] = await Promise.all([
        User.findOne({
          $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
        }),
        mongoose.model('PendingUser').findOne({
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

      const existingCnic = await User.findOne({ cnic: employee.cnic });
      if (existingCnic) {
        res.status(409).json({
          success: false,
          message: 'CNIC is already registered to another user',
        });
        return;
      }

      const newUser = new User({
        name: employee.name,
        username: normalizedUsername,
        email: normalizedEmail,
        password,
        dob: employee.dob,
        gender: employee.gender,
        cnic: employee.cnic,
        phoneNo: employee.phoneNo,
        designation: employee.designation,
        dateOfJoining: employee.dateOfJoining,
        address: employee.address,
        profileImage: employee.profileImage ?? null,
        role: null,
        department: employee.department || '',
        permissions: [],
        permissionMode: 'override',
        status: 'active',
        isEmailVerified: true,
        isActive: true,
        isEmployee: true,
        createdBy: req.user!._id,
      });

      await newUser.save();

      await Employee.deleteOne({
        user: newUser._id,
        _id: { $ne: employee._id },
      });

      employee.user = newUser._id;
      employee.email = normalizedEmail;
      await employee.save();

      try {
        const { sendUserCreatedEmail } = await import('../services/emailService');
        await sendUserCreatedEmail(
          newUser.email,
          newUser.name,
          newUser.username,
          password,
          undefined,
          newUser.department
        );
      } catch (emailErr) {
        console.error('attach: welcome email failed:', emailErr);
      }

      const fresh = await Employee.findById(employee._id);
      res.json({
        success: true,
        message: 'User account created and linked. Credentials emailed.',
        data: fresh,
      });
      return;
    }

    // ═════════════════════════════════════════════════════════════════════
    // FLOW B — DETACH a linked user
    // ═════════════════════════════════════════════════════════════════════
    if (removeUserAccount === true) {
      if (!employee.user) {
        res.status(400).json({
          success: false,
          message: 'This employee has no linked user account',
        });
        return;
      }

      if (linkedUser && !linkedUser.isMainAdmin) {
        linkedUser.isEmployee = false;
        linkedUser.isActive = false;
        if (linkedUser.status === 'active') {
          linkedUser.status = 'blocked';
        }
        await linkedUser.save();
      }

      employee.user = null;
      await employee.save();

      const fresh = await Employee.findById(employee._id);
      res.json({
        success: true,
        message: 'User account detached. Employee is now standalone.',
        data: fresh,
      });
      return;
    }

    // ═════════════════════════════════════════════════════════════════════
    // Regular field-update flow
    // ═════════════════════════════════════════════════════════════════════

    // ── Validation ──────────────────────────────────────────────────────
    if (employmentStatus !== undefined) {
      if (!(EMPLOYMENT_STATUSES as string[]).includes(employmentStatus)) {
        res.status(400).json({
          success: false,
          message: `Invalid employmentStatus. Allowed: ${EMPLOYMENT_STATUSES.join(', ')}`,
        });
        return;
      }
    }

    if (gender !== undefined && !['male', 'female'].includes(gender)) {
      res.status(400).json({
        success: false,
        message: 'Invalid gender. Allowed: male, female',
      });
      return;
    }

    if (cnic !== undefined && !/^\d{5}-\d{7}-\d{1}$/.test(String(cnic))) {
      res.status(400).json({
        success: false,
        message: 'Invalid CNIC format. Expected: 12345-1234567-1',
      });
      return;
    }

    if (email !== undefined && email) {
      if (!/^\S+@\S+\.\S+$/.test(String(email))) {
        res.status(400).json({ success: false, message: 'Invalid email format' });
        return;
      }
    }

    // Validate timing edits
    const timingError = validateTimings(
      standardCheckIn !== undefined ? standardCheckIn : employee.standardCheckIn,
      standardCheckOut !== undefined ? standardCheckOut : employee.standardCheckOut
    );
    if (timingError) {
      res.status(400).json({ success: false, message: timingError });
      return;
    }

    // Validate & expand leave schedules
    let parsedSchedules: ParsedSchedule[] | undefined;
    let expandedAllocations: ILeaveAllocation[] | undefined;
    if (leaveSchedules !== undefined) {
      const leaveRes = validateLeaveSchedules(leaveSchedules);
      if (!leaveRes.ok) {
        res.status(400).json({ success: false, message: leaveRes.error });
        return;
      }
      parsedSchedules = leaveRes.parsed ?? [];
      expandedAllocations = expandAndMerge(
        parsedSchedules,
        employee.leaveAllocations ?? [],
        new Date().getFullYear()
      );
    }

    // Uniqueness against other users (only when email is changing)
    if (email !== undefined && email !== employee.email) {
      const normalized = String(email).trim().toLowerCase();

      if (linkedUser) {
        const dupUser = await User.findOne({
          _id: { $ne: linkedUser._id },
          email: normalized,
        });
        if (dupUser) {
          res.status(409).json({
            success: false,
            message: 'Email is already registered to another user',
          });
          return;
        }
      } else {
        const dupEmp = await Employee.findOne({
          _id: { $ne: employee._id },
          email: normalized,
          user: null,
        });
        if (dupEmp) {
          res.status(409).json({
            success: false,
            message: 'Email is already used by another employee',
          });
          return;
        }
      }
    }

    // CNIC uniqueness (only when linked)
    if (cnic !== undefined && cnic !== employee.cnic && linkedUser) {
      const dupUser = await User.findOne({ _id: { $ne: linkedUser._id }, cnic });
      if (dupUser) {
        res.status(409).json({
          success: false,
          message: 'CNIC is already registered to another user',
        });
        return;
      }
    }

    // Department validation
    if (
      department !== undefined &&
      linkedUser &&
      department !== linkedUser.department &&
      linkedUser.role
    ) {
      const roleDoc: any = await Role.findById(linkedUser.role);
      if (roleDoc) {
        const hasDept = roleDoc.departments?.some(
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

    // ── Apply changes to Employee ───────────────────────────────────────
    if (name !== undefined) employee.name = name;
    if (phoneNo !== undefined) employee.phoneNo = phoneNo;
    if (address !== undefined) employee.address = address;
    if (email !== undefined) employee.email = email || undefined;
    if (gender !== undefined) employee.gender = gender;
    if (dob !== undefined) employee.dob = dob;
    if (cnic !== undefined) employee.cnic = cnic;
    if (designation !== undefined) employee.designation = designation;
    if (department !== undefined) employee.department = department;
    if (dateOfJoining !== undefined) employee.dateOfJoining = dateOfJoining;
    if (profileImage !== undefined) employee.profileImage = profileImage;

    // Only the two timing strings are editable.
    if (standardCheckIn !== undefined) employee.standardCheckIn = standardCheckIn;
    if (standardCheckOut !== undefined) employee.standardCheckOut = standardCheckOut;

    // Replace the leave schedule + allocation list atomically
    if (parsedSchedules !== undefined) {
      employee.leaveSchedules = parsedSchedules as ILeaveSchedule[];
      employee.leaveAllocations = expandedAllocations ?? [];
      employee.markModified('leaveSchedules');
      employee.markModified('leaveAllocations');
    }

    if (employmentStatus !== undefined) {
      employee.employmentStatus = employmentStatus as EmploymentStatus;
      if (statusReason !== undefined) {
        employee.statusReason = statusReason;
      }
    } else if (isActive !== undefined) {
      if (isActive === false && employee.employmentStatus === 'active') {
        employee.employmentStatus = 'suspended';
      } else if (
        isActive === true &&
        !ACTIVE_STATUSES.includes(employee.employmentStatus)
      ) {
        employee.employmentStatus = 'active';
      }
    }

    await employee.save();

    // Optional: refresh cached total from attendance (server-triggered only)
    if (refreshTotalWorkingHours === true) {
      await Employee.recomputeTotalWorkingHours(employee._id);
    }

    // ── Mirror shared fields back to User ───────────────────────────────
    if (linkedUser) {
      const mirrored: Record<string, any> = {};
      if (name !== undefined) mirrored.name = name;
      if (phoneNo !== undefined) mirrored.phoneNo = phoneNo;
      if (address !== undefined) mirrored.address = address;
      if (email !== undefined) mirrored.email = email || undefined;
      if (gender !== undefined) mirrored.gender = gender;
      if (dob !== undefined) mirrored.dob = dob;
      if (cnic !== undefined) mirrored.cnic = cnic;
      if (designation !== undefined) mirrored.designation = designation;
      if (department !== undefined) mirrored.department = department;
      if (profileImage !== undefined) mirrored.profileImage = profileImage;

      if (Object.keys(mirrored).length) {
        Object.assign(linkedUser, mirrored);
        await linkedUser.save();
      }
    }

    const fresh = await Employee.findById(employee._id);

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('updateEmployee error:', err);

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
// ADJUST LEAVE USED
//   POST /api/employees/:employeeId/leave-used
//   body: { type, year, month, delta }
//   delta = +1 to consume one day, -1 to give one back (revert)
// ═════════════════════════════════════════════════════════════════════════
export async function adjustLeaveUsed(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { employeeId } = req.params;
    const { type, year, month, delta } = req.body;

    // Free-form type — just require a non-empty trimmed string
    const leaveType = String(type || '').trim();
    if (!leaveType) {
      res.status(400).json({
        success: false,
        message: 'Leave type is required',
      });
      return;
    }

    const y = Number(year);
    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      res.status(400).json({ success: false, message: 'Invalid year' });
      return;
    }

    const m = Number(month);
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      res.status(400).json({ success: false, message: 'month must be 1–12' });
      return;
    }

    const d = Number(delta);
    if (!Number.isFinite(d) || d === 0) {
      res.status(400).json({ success: false, message: 'delta must be non-zero' });
      return;
    }

    const idStr = String(employeeId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };

    const employee = await Employee.findOne(query);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    const needle = leaveType.toLowerCase();

    // Match on type + year + month (case-insensitive on type)
    const idx = employee.leaveAllocations.findIndex(
      (a) =>
        a.type.trim().toLowerCase() === needle &&
        a.year === y &&
        a.month === m
    );

    if (idx === -1) {
      res.status(404).json({
        success: false,
        message: `No allocation exists for "${leaveType}" ${y}-${String(m).padStart(
          2,
          '0'
        )}`,
      });
      return;
    }

    const slot = employee.leaveAllocations[idx];
    const nextUsed = +(slot.used + d).toFixed(2);

    if (nextUsed < 0) {
      res.status(400).json({
        success: false,
        message: 'used would go negative',
      });
      return;
    }

    slot.used = nextUsed;
    employee.markModified('leaveAllocations');
    await employee.save();

    res.json({
      success: true,
      message: 'Leave usage adjusted',
      data: employee.leaveAllocations,
    });
  } catch (err: any) {
    console.error('adjustLeaveUsed error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// EXTEND ALL OPEN-ENDED SCHEDULES (cron entry)
//   POST /api/employees/extend-schedules
//   body: { year?: number }
// ═════════════════════════════════════════════════════════════════════════
export async function extendAllSchedules(req: AuthRequest, res: Response): Promise<void> {
  try {
    const year = req.body?.year
      ? Number(req.body.year)
      : new Date().getFullYear();

    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      res.status(400).json({ success: false, message: 'Invalid year' });
      return;
    }

    // Only employees with at least one open-ended schedule
    const employees = await Employee.find({
      isDeleted: false,
      leaveSchedules: { $elemMatch: { endYear: { $exists: false } } },
    });

    let touched = 0;
    for (const emp of employees) {
      const before = emp.leaveAllocations.length;
      await Employee.extendSchedules(emp._id, year);
      const afterDoc = await Employee.findById(emp._id);
      const after = afterDoc?.leaveAllocations.length ?? before;
      if (after > before) touched++;
    }

    res.json({
      success: true,
      message: `Extended schedules for ${touched} employee(s)`,
      data: { touched, year },
    });
  } catch (err: any) {
    console.error('extendAllSchedules error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Delete Employee (soft delete) ────────────────────────────────────────
export async function deleteEmployee(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { employeeId } = req.params;
    const idStr = String(employeeId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };

    const employee = await Employee.findOne(query);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('employees', 'delete'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot delete employees',
        });
        return;
      }
    }

    employee.isDeleted = true;
    employee.isActive = false;
    employee.employmentStatus = 'terminated';
    employee.statusReason = employee.statusReason || 'Soft-deleted';
    employee.statusChangedAt = new Date();
    await employee.save();

    if (employee.user) {
      const linkedUser = await User.findById(employee.user);
      if (linkedUser && !linkedUser.isMainAdmin) {
        linkedUser.isEmployee = false;
        await linkedUser.save();
      }
    }

    res.json({ success: true, message: 'Employee deleted successfully' });
  } catch (err: any) {
    console.error('deleteEmployee error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Restore Employee ─────────────────────────────────────────────────────
export async function restoreEmployee(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { employeeId } = req.params;
    const idStr = String(employeeId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr }
      : { employeeId: idStr };

    const employee = await Employee.findOne(query);
    if (!employee) {
      res.status(404).json({ success: false, message: 'Employee not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('employees', 'edit'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot restore employees',
        });
        return;
      }
    }

    employee.isDeleted = false;
    employee.isActive = true;
    employee.employmentStatus = 'active';
    employee.statusReason = undefined;
    employee.statusChangedAt = new Date();
    await employee.save();

    if (employee.user) {
      const linkedUser = await User.findById(employee.user);
      if (linkedUser) {
        linkedUser.isEmployee = true;
        linkedUser.isActive = true;
        if (linkedUser.status === 'blocked') linkedUser.status = 'active';
        await linkedUser.save();
      }
    }

    res.json({
      success: true,
      message: 'Employee restored successfully',
      data: employee,
    });
  } catch (err: any) {
    console.error('restoreEmployee error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Employee Stats ───────────────────────────────────────────────────────
export async function getEmployeeStats(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const baseFilter = { isDeleted: false };
    const currentYear = new Date().getFullYear();

    const [
      total,
      active,
      onLeave,
      suspended,
      resigned,
      terminated,
      withUser,
      withoutUser,
      onDefaultShift,
      byDepartment,
      byStatusRaw,
      totalLeaveAllocatedAgg,
      totalLeaveUsedAgg,
    ] = await Promise.all([
      Employee.countDocuments(baseFilter),
      Employee.countDocuments({ ...baseFilter, employmentStatus: 'active' }),
      Employee.countDocuments({ ...baseFilter, employmentStatus: 'on_leave' }),
      Employee.countDocuments({ ...baseFilter, employmentStatus: 'suspended' }),
      Employee.countDocuments({ ...baseFilter, employmentStatus: 'resigned' }),
      Employee.countDocuments({ ...baseFilter, employmentStatus: 'terminated' }),
      Employee.countDocuments({ ...baseFilter, user: { $ne: null } }),
      Employee.countDocuments({ ...baseFilter, user: null }),
      Employee.countDocuments({
        ...baseFilter,
        standardCheckIn: '09:00',
        standardCheckOut: '18:00',
      }),
      Employee.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$department', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      Employee.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$employmentStatus', count: { $sum: 1 } } },
      ]),
      // Aggregate total credited leave across all employees for the current year
      Employee.aggregate([
        { $match: baseFilter },
        { $unwind: '$leaveAllocations' },
        { $match: { 'leaveAllocations.year': currentYear } },
        {
          $group: {
            _id: null,
            totalAllocated: {
              $sum: {
                $add: [
                  '$leaveAllocations.days',
                  '$leaveAllocations.carriedForward',
                ],
              },
            },
          },
        },
      ]),
      // Aggregate total used leave across all employees for the current year
      Employee.aggregate([
        { $match: baseFilter },
        { $unwind: '$leaveAllocations' },
        { $match: { 'leaveAllocations.year': currentYear } },
        {
          $group: {
            _id: null,
            totalUsed: { $sum: '$leaveAllocations.used' },
          },
        },
      ]),
    ]);

    const byStatus: Record<EmploymentStatus | 'unknown', number> = {
      active: 0,
      on_leave: 0,
      suspended: 0,
      resigned: 0,
      terminated: 0,
      unknown: 0,
    };
    for (const row of byStatusRaw) {
      const key = (row._id ?? 'unknown') as EmploymentStatus | 'unknown';
      if (key in byStatus) byStatus[key] = row.count;
      else byStatus.unknown += row.count;
    }

    const totalLeaveAllocated = totalLeaveAllocatedAgg[0]?.totalAllocated ?? 0;
    const totalLeaveUsed = totalLeaveUsedAgg[0]?.totalUsed ?? 0;

    res.json({
      success: true,
      data: {
        total,
        active: active + onLeave,
        inactive: suspended + resigned + terminated,
        byDepartment: byDepartment.map((d) => ({
          department: d._id || '(unassigned)',
          count: d.count,
        })),
        breakdown: {
          total,
          active,
          onLeave,
          suspended,
          resigned,
          terminated,
          unknown: byStatus.unknown,
          withUser,
          withoutUser,
          onDefaultShift,
          totalLeaveAllocated,
          totalLeaveUsed,
          totalLeaveRemaining: Math.max(
            0,
            totalLeaveAllocated - totalLeaveUsed
          ),
        },
      },
    });
  } catch (err: any) {
    console.error('getEmployeeStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}