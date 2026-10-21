// controller/meController.ts
// ═══════════════════════════════════════════════════════════════════════════
// EMPLOYEE SELF-SERVICE DASHBOARD
// Every handler resolves the caller's Employee record from req.user._id.
// No employeeId is ever accepted from the client — the route is "me".
// ═══════════════════════════════════════════════════════════════════════════

import { Response } from 'express';
import mongoose from 'mongoose';
import Employee from '../model/employee';
import Attendance from '../model/attendance';
import EmployeeRequest from '../model/EmployeeRequest';
import Loan from '../model/Loan';
import EmployeeBankAccount from '../model/EmployeeBankAccount';
import Project from '../model/project';
import Task, { OPEN_TASK_STATUSES } from '../model/task';
import Holiday from '../model/holiday';
import { AuthRequest } from '../middleware/auth';
import {
  computeProgress,
  totalOutstandingFor,
  installmentsDueInMonth,
} from '../services/loanHelpers';
import { getLeaveBalance } from '../services/requestHelpers';

// ─── Helpers ──────────────────────────────────────────────────────────────

function bad(res: Response, msg: string, code = 400): void {
  res.status(code).json({ success: false, message: msg });
}

function round2(n: number): number {
  return +Number(n).toFixed(2);
}

/** First/last day of a YYYY-MM month, at 00:00 / 23:59:59.999 UTC. */
function monthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

/**
 * The single source of truth for "which employee is this request about".
 * Returns the Employee doc, or writes a 401/404 and returns null.
 */
async function resolveSelf(
  req: AuthRequest,
  res: Response
): Promise<any | null> {
  if (!req.user) {
    bad(res, 'Not authenticated', 401);
    return null;
  }
  if (!req.user.isEmployee) {
    bad(res, 'You do not have an employee record', 404);
    return null;
  }
  const emp = await Employee.findOne({
    user: req.user._id,
    isDeleted: false,
  });
  if (!emp) {
    bad(res, 'Employee record not found', 404);
    return null;
  }
  return emp;
}

/** Parse year/month query params with sane defaults. */
function parseYearMonth(query: any): { year: number; month: number } | null {
  const now = new Date();
  const year = query.year ? Number(query.year) : now.getUTCFullYear();
  const month = query.month ? Number(query.month) : now.getUTCMonth() + 1;

  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

/**
 * Shape of the object returned by `getLeaveBalance()`.
 * Declared locally so this file doesn't need the helper's exported type.
 */
interface LeaveBalanceResult {
  rows: Array<{
    type: string;
    year: number;
    month: number;
    allocated: number;
    used: number;
    pending: number;
    remaining: number;
  }>;
  totals: {
    allocated: number;
    used: number;
    pending: number;
    remaining: number;
  };
  types: string[];
  summary: {
    year: number;
    totalAllocated: number;
    totalUsed: number;
    totalRemaining: number;
  } | null;
  year: number;
}

/** Safe wrapper — returns `null` instead of throwing. */
async function safeLeaveBalance(
  employeeId: any,
  year: number
): Promise<LeaveBalanceResult | null> {
  try {
    return (await getLeaveBalance(employeeId, { year })) as LeaveBalanceResult;
  } catch (err) {
    console.warn('getLeaveBalance failed (non-fatal):', err);
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 1. FULL DASHBOARD — GET /api/me
//
// One request returns everything the dashboard page needs:
//   profile, today's attendance, this month's attendance summary, leave
//   balance, loans, pending requests, bank accounts, projects, task counts,
//   and upcoming holidays.
// ══════════════════════════════════════════════════════════════════════════

export async function getDashboard(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const baseEmp = await resolveSelf(req, res);
    if (!baseEmp) return;

    // Populate `user` so the profile block can include username
    const emp = (await Employee.findById(baseEmp._id)
      .populate('user', 'username email')
      .lean()) as any;

    const now = new Date();
    const today = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
    );
    const { start: monthStart, end: monthEnd } = monthBounds(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1
    );

    // ── Fire all lookups in parallel ────────────────────────────────────
    const [
      todayAttendance,
      monthAttendance,
      thisMonthLeaveBalance,
      activeLoans,
      loanOutstanding,
      pendingRequests,
      bankAccounts,
      projects,
      taskCounts,
      dueThisMonth,
      upcomingHolidays,
    ] = await Promise.all([
      // Today's attendance row (may be null if not yet marked)
      Attendance.findOne({
        employee: emp._id,
        date: today,
        isDeleted: false,
      }).lean(),

      // This month's attendance rows
      Attendance.find({
        employee: emp._id,
        date: { $gte: monthStart, $lte: monthEnd },
        isDeleted: false,
      })
        .select('date status arrivalAt departureAt workedHours source')
        .sort({ date: 1 })
        .lean(),

      // Leave balance for the current year (safe wrapper)
      safeLeaveBalance(emp._id, now.getUTCFullYear()),

      // Active loans
      Loan.find({
        employee: emp._id,
        status: 'active',
        isDeleted: false,
      })
        .sort({ createdAt: -1 })
        .lean(),

      // Total outstanding across all loans
      totalOutstandingFor(emp._id).catch(() => 0),

      // Pending requests awaiting HR
      EmployeeRequest.find({
        employee: emp._id,
        status: 'pending',
        isDeleted: false,
      })
        .select('type subject data createdAt')
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),

      // Bank accounts
      EmployeeBankAccount.find({
        employee: emp._id,
        isDeleted: false,
      })
        .select(
          'bankName accountTitle accountNumber accountType branchName iban currency isPrimary status verifiedAt rejectionReason'
        )
        .sort({ isPrimary: -1, createdAt: -1 })
        .lean(),

      // Projects where the employee is on the team or is the manager
      Project.find({
        isDeleted: false,
        $or: [{ projectManager: emp._id }, { teamMembers: emp._id }],
      })
        .populate('projectManager', 'name employeeId')
        .select(
          'projectId name status priority progress deadline projectType projectManager'
        )
        .sort({ status: 1, deadline: 1 })
        .limit(50)
        .lean(),

      // Task counts: [open, overdue, done, dueToday]
      Promise.all([
        Task.countDocuments({
          assignedTo: emp._id,
          isDeleted: false,
          status: { $in: OPEN_TASK_STATUSES },
        }),
        Task.countDocuments({
          assignedTo: emp._id,
          isDeleted: false,
          status: { $in: OPEN_TASK_STATUSES },
          dueDate: { $lt: now },
        }),
        Task.countDocuments({
          assignedTo: emp._id,
          isDeleted: false,
          status: 'done',
        }),
        Task.countDocuments({
          assignedTo: emp._id,
          isDeleted: false,
          status: { $in: OPEN_TASK_STATUSES },
          dueDate: {
            $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)),
            $lte: new Date(new Date().setUTCHours(23, 59, 59, 999)),
          },
        }),
      ]),

      // Loan installments due this month
      installmentsDueInMonth(
        emp._id,
        now.getUTCFullYear(),
        now.getUTCMonth() + 1
      ).catch(() => []),

      // Upcoming holidays in the next 30 days
      Holiday.find({
        isDeleted: false,
        isActive: true,
        date: {
          $gte: today,
          $lte: new Date(today.getTime() + 30 * 86_400_000),
        },
      })
        .select('name date pattern')
        .sort({ date: 1 })
        .limit(5)
        .lean(),
    ]);

    // ── Attendance summary for the month ────────────────────────────────
    const byStatus: Record<string, number> = {
      present: 0,
      absent: 0,
      late: 0,
      half_day: 0,
      leave: 0,
      holiday: 0,
      weekend: 0,
      wfh: 0,
    };
    let totalWorkedHours = 0;
    for (const a of monthAttendance) {
      const s = String(a.status ?? 'unknown');
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      totalWorkedHours += a.workedHours || 0;
    }

    const daysElapsed = Math.min(
      now.getUTCDate(),
      new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 0).getDate()
    );
    const workingDaysElapsed = monthAttendance.filter(
      (a) => a.status !== 'weekend' && a.status !== 'holiday'
    ).length;

    // ── Loan summary ────────────────────────────────────────────────────
    const loanSummary = activeLoans.map((l: any) => {
      const obj = typeof l.toObject === 'function' ? l.toObject() : l;
      return {
        _id: obj._id,
        loanId: obj.loanId,
        principal: obj.principal,
        outstandingAmount: obj.outstandingAmount,
        totalPaid: obj.totalPaid,
        installmentAmount: obj.installmentAmount,
        installmentsCount: obj.installments?.length ?? 0,
        installmentsPaid:
          obj.installments?.filter((i: any) => i.status === 'paid').length ?? 0,
        approvedAt: obj.approvedAt,
        status: obj.status,
        progress: computeProgress(l),
      };
    });

    const dueThisMonthSummary = (dueThisMonth as any[]).map((d) => ({
      loanId: d.loanId,
      seq: d.installment.seq,
      dueDate: d.installment.dueDate,
      amount: d.installment.amount,
      status: d.installment.status,
    }));

    // ── Leave balance block (safe defaults when helper returned null) ──
    const leaveBalanceBlock = thisMonthLeaveBalance
      ? {
          year: thisMonthLeaveBalance.year ?? now.getUTCFullYear(),
          types: thisMonthLeaveBalance.types ?? [],
          summary: thisMonthLeaveBalance.summary ?? null,
        }
      : {
          // Helper failed — send an empty shape so the UI doesn't break
          year: now.getUTCFullYear(),
          types: [],
          summary: null,
        };

    // ── Response ────────────────────────────────────────────────────────
    res.json({
      success: true,
      data: {
        profile: {
          _id: emp._id,
          employeeId: emp.employeeId,
          name: emp.name,
          email: emp.email,
          phoneNo: emp.phoneNo,
          cnic: emp.cnic,
          designation: emp.designation,
          department: emp.department,
          employmentStatus: emp.employmentStatus,
          dateOfJoining: emp.dateOfJoining,
          standardCheckIn: emp.standardCheckIn,
          standardCheckOut: emp.standardCheckOut,
          profileImage: emp.profileImage,
          salaryStructure: emp.salaryStructure,
          basicSalary: emp.basicSalary,
          pieceRateSalary: emp.pieceRateSalary,
          overtimePerHourAmount: emp.overtimePerHourAmount,
          editableFields: [
            'phoneNo',
            'address',
            'profileImage',
            'emergencyContact',
          ],
        },

        today: {
          attendance: todayAttendance,
          isMarked: !!todayAttendance,
          isWeekend:
            today.getUTCDay() === 0 || today.getUTCDay() === 6,
        },

        attendanceThisMonth: {
          year: now.getUTCFullYear(),
          month: now.getUTCMonth() + 1,
          daysElapsed,
          workingDaysElapsed,
          markedDays: monthAttendance.length,
          byStatus,
          totalWorkedHours: round2(totalWorkedHours),
          recent: monthAttendance.slice(-10).reverse(),
        },

        leaveBalance: leaveBalanceBlock,

        loans: {
          activeCount: activeLoans.length,
          totalOutstanding: round2(loanOutstanding),
          activeLoans: loanSummary,
          dueThisMonth: dueThisMonthSummary,
        },

        pendingRequests: pendingRequests.map((r: any) => ({
          _id: r._id,
          type: r.type,
          subject: r.subject,
          data: r.data,
          createdAt: r.createdAt,
        })),

        bankAccounts: bankAccounts.map((b: any) => ({
          _id: b._id,
          bankName: b.bankName,
          accountTitle: b.accountTitle,
          accountNumber: b.accountNumber,
          accountType: b.accountType,
          branchName: b.branchName,
          iban: b.iban,
          currency: b.currency,
          isPrimary: b.isPrimary,
          status: b.status,
          verifiedAt: b.verifiedAt,
          rejectionReason: b.rejectionReason,
        })),

        projects: projects.map((p: any) => ({
          _id: p._id,
          projectId: p.projectId,
          name: p.name,
          status: p.status,
          priority: p.priority,
          progress: p.progress,
          deadline: p.deadline,
          projectType: p.projectType,
          isManager:
            String(p.projectManager?._id ?? p.projectManager) ===
            String(emp._id),
          projectManager: p.projectManager,
        })),

        tasks: {
          open: taskCounts[0],
          overdue: taskCounts[1],
          done: taskCounts[2],
          dueToday: taskCounts[3],
        },

        upcomingHolidays: upcomingHolidays.map((h: any) => ({
          _id: h._id,
          name: h.name,
          date: h.date,
          pattern: h.pattern,
        })),
      },
    });
  } catch (err: any) {
    console.error('getDashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 2. PROFILE — GET /api/me/profile
// ══════════════════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════════════════
// 2. PROFILE — GET /api/me/profile
// ══════════════════════════════════════════════════════════════════════════

export async function getMyProfile(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    // Populate `user` so the frontend can read `employee.user.username`.
    // `virtuals/getters` keeps any derived fields working after lean().
    const hydrated = await Employee.findById(emp._id)
      .populate({ path: 'user', select: 'username email' })
      .lean({ virtuals: true, getters: true });

    res.json({ success: true, data: hydrated });
  } catch (err: any) {
    console.error('getMyProfile error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 3. EDIT PROFILE — PATCH /api/me/profile
//
// Employees may only change a safe subset of their own record.
// ══════════════════════════════════════════════════════════════════════════

const SELF_EDITABLE_FIELDS = [
  'phoneNo',
  'address',
  'profileImage',
  'emergencyContact',
] as const;

export async function updateMyProfile(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const body = req.body || {};
    const attempted = Object.keys(body).filter(
      (k) => !SELF_EDITABLE_FIELDS.includes(k as any) && body[k] !== undefined
    );

    if (attempted.length) {
      bad(
        res,
        `These fields cannot be edited by the employee: ${attempted.join(
          ', '
        )}. Allowed: ${SELF_EDITABLE_FIELDS.join(', ')}`
      );
      return;
    }

    if (body.phoneNo !== undefined) {
      const p = String(body.phoneNo).trim();
      if (!p) {
        bad(res, 'phoneNo cannot be empty');
        return;
      }
      emp.phoneNo = p;
    }
    if (body.address !== undefined) {
      emp.address = body.address ? String(body.address).trim() : undefined;
    }
    if (body.profileImage !== undefined) {
      emp.profileImage = body.profileImage || null;
    }
    if (body.emergencyContact !== undefined) {
      // Employee model may not have this field — store defensively
      (emp as any).emergencyContact = body.emergencyContact || undefined;
      emp.markModified('emergencyContact');
    }

    await emp.save();

    // Mirror back to User so the profile stays in sync
    try {
      const User = mongoose.model('User');
      const userPatch: any = {};
      if (body.phoneNo !== undefined) userPatch.phoneNo = emp.phoneNo;
      if (body.address !== undefined) userPatch.address = emp.address;
      if (body.profileImage !== undefined)
        userPatch.profileImage = emp.profileImage;
      if (body.emergencyContact !== undefined)
        userPatch.emergencyContact = (emp as any).emergencyContact;

      if (Object.keys(userPatch).length && emp.user) {
        await User.updateOne({ _id: emp.user }, { $set: userPatch });
      }
    } catch (mirrorErr) {
      console.warn('updateMyProfile: mirror to User failed', mirrorErr);
    }

    res.json({
      success: true,
      message: 'Profile updated',
      data: {
        editableFields: SELF_EDITABLE_FIELDS,
        employee: emp,
      },
    });
  } catch (err: any) {
    console.error('updateMyProfile error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 4. ATTENDANCE — GET /api/me/attendance
//
// Query:
//   ?year=&month=       single month (defaults to current)
//   ?from=&to=          explicit range (overrides year/month)
//   ?page=&limit=       pagination when no range given
// ══════════════════════════════════════════════════════════════════════════

export async function getMyAttendance(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const { from, to, page = '1', limit = '100' } = req.query;

    let start: Date;
    let end: Date;

    if (from || to) {
      start = from
        ? new Date(String(from))
        : new Date(Date.UTC(2000, 0, 1));
      end = to ? new Date(String(to)) : new Date();
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        bad(res, 'Invalid from/to dates');
        return;
      }
      start.setUTCHours(0, 0, 0, 0);
      end.setUTCHours(23, 59, 59, 999);
    } else {
      const ym = parseYearMonth(req.query);
      if (!ym) {
        bad(res, 'year must be 2000-2100, month must be 1-12');
        return;
      }
      const bounds = monthBounds(ym.year, ym.month);
      start = bounds.start;
      end = bounds.end;
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));

    const filter = {
      employee: emp._id,
      isDeleted: false,
      date: { $gte: start, $lte: end },
    };

    const rows = await Attendance.find(filter)
      .select(
        'date status arrivalAt departureAt workedHours source notes markedBy'
      )
      .populate('markedBy', 'name')
      .sort({ date: 1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    const total = await Attendance.countDocuments(filter);

    const byStatus: Record<string, number> = {};
    let totalWorkedHours = 0;
    for (const a of rows) {
      const s = String(a.status ?? 'unknown');
      byStatus[s] = (byStatus[s] ?? 0) + 1;
      totalWorkedHours += a.workedHours || 0;
    }

    res.json({
      success: true,
      data: {
        employee: {
          _id: emp._id,
          name: emp.name,
          employeeId: emp.employeeId,
          department: emp.department,
        },
        range: { from: start, to: end },
        rows,
        summary: {
          total: rows.length,
          byStatus,
          totalWorkedHours: round2(totalWorkedHours),
        },
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          pages: Math.ceil(total / limitNum) || 1,
        },
      },
    });
  } catch (err: any) {
    console.error('getMyAttendance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 5. REQUESTS — GET /api/me/requests
// ══════════════════════════════════════════════════════════════════════════

export async function getMyRequests(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const { type, status, page = '1', limit = '30' } = req.query;

    const filter: any = { employee: emp._id, isDeleted: false };
    if (type) filter.type = String(type);
    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));

    const [rows, total] = await Promise.all([
      EmployeeRequest.find(filter)
        .populate('decidedBy', 'name')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      EmployeeRequest.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err: any) {
    console.error('getMyRequests error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 6. LEAVE BALANCE — GET /api/me/leave-balance?year=
// ══════════════════════════════════════════════════════════════════════════

export async function getMyLeaveBalance(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const { year, type } = req.query;
    const result = await getLeaveBalance(emp._id, {
      year: year ? Number(year) : undefined,
      type: type ? String(type) : undefined,
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('getMyLeaveBalance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 7. LOANS — GET /api/me/loans
// ══════════════════════════════════════════════════════════════════════════

export async function getMyLoans(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const { status, page = '1', limit = '20' } = req.query;

    const filter: any = { employee: emp._id, isDeleted: false };
    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));

    const [rows, total, outstanding] = await Promise.all([
      Loan.find(filter)
        .populate('request', 'subject data.fromDate data.toDate')
        .sort({ createdAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum),
      Loan.countDocuments(filter),
      totalOutstandingFor(emp._id),
    ]);

    const decorated = rows.map((l) => ({
      ...l.toObject(),
      progress: computeProgress(l),
    }));

    res.json({
      success: true,
      data: {
        totalOutstanding: round2(outstanding),
        activeCount: decorated.filter((l: any) => l.status === 'active').length,
        loans: decorated,
      },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err: any) {
    console.error('getMyLoans error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 8. BANK ACCOUNTS — GET /api/me/bank-accounts
// ══════════════════════════════════════════════════════════════════════════

export async function getMyBankAccounts(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const accounts = await EmployeeBankAccount.find({
      employee: emp._id,
      isDeleted: false,
    })
      .select(
        'bankName accountTitle accountNumber accountType branchName branchCode iban swiftCode routingNumber currency isPrimary status verifiedAt rejectionReason notes createdAt'
      )
      .sort({ isPrimary: -1, createdAt: -1 })
      .lean();

    res.json({ success: true, data: accounts });
  } catch (err: any) {
    console.error('getMyBankAccounts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 10. TASKS — GET /api/me/tasks
// ══════════════════════════════════════════════════════════════════════════

export async function getMyTasks(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const {
      status,
      priority,
      hasProject,
      overdue,
      search,
      page = '1',
      limit = '50',
      sort = 'dueDate',
    } = req.query;

    const filter: any = { assignedTo: emp._id, isDeleted: false };

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = list.length === 1 ? list[0] : { $in: list };
    } else {
      filter.status = { $in: OPEN_TASK_STATUSES };
    }

    if (priority) filter.priority = String(priority);

    if (hasProject === 'true') filter.projectId = { $ne: null };
    else if (hasProject === 'false') filter.projectId = null;

    if (overdue === 'true') {
      filter.dueDate = { $lt: new Date() };
      if (!status) filter.status = { $in: OPEN_TASK_STATUSES };
    }

    if (search) {
      filter.$or = [
        { title: { $regex: String(search), $options: 'i' } },
        { taskId: { $regex: String(search), $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .populate('projectId', 'projectId name status')
        .populate('assignedBy', 'name employeeId')
        .sort(sort as string)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .lean(),
      Task.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: tasks,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err: any) {
    console.error('getMyTasks error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 11. STATS — GET /api/me/stats
//
// Compact counts for dashboard widgets.
// ══════════════════════════════════════════════════════════════════════════

export async function getMyStats(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const now = new Date();
    const { start: monthStart, end: monthEnd } = monthBounds(
      now.getUTCFullYear(),
      now.getUTCMonth() + 1
    );

    const [
      attendanceMonth,
      pendingRequests,
      openTasks,
      overdueTasks,
      doneTasks,
      dueTodayTasks,
      activeLoans,
      outstanding,
    ] = await Promise.all([
      Attendance.countDocuments({
        employee: emp._id,
        isDeleted: false,
        date: { $gte: monthStart, $lte: monthEnd },
      }),
      EmployeeRequest.countDocuments({
        employee: emp._id,
        status: 'pending',
        isDeleted: false,
      }),
      Task.countDocuments({
        assignedTo: emp._id,
        status: { $in: OPEN_TASK_STATUSES },
        isDeleted: false,
      }),
      Task.countDocuments({
        assignedTo: emp._id,
        status: { $in: OPEN_TASK_STATUSES },
        isDeleted: false,
        dueDate: { $lt: now },
      }),
      Task.countDocuments({
        assignedTo: emp._id,
        status: 'done',
        isDeleted: false,
      }),
      Task.countDocuments({
        assignedTo: emp._id,
        status: { $in: OPEN_TASK_STATUSES },
        isDeleted: false,
        dueDate: {
          $gte: new Date(new Date().setUTCHours(0, 0, 0, 0)),
          $lte: new Date(new Date().setUTCHours(23, 59, 59, 999)),
        },
      }),
      Loan.countDocuments({
        employee: emp._id,
        status: 'active',
        isDeleted: false,
      }),
      totalOutstandingFor(emp._id),
    ]);

    res.json({
      success: true,
      data: {
        attendanceDaysMarkedThisMonth: attendanceMonth,
        pendingRequests,
        tasks: {
          open: openTasks,
          overdue: overdueTasks,
          done: doneTasks,
          dueToday: dueTodayTasks,
        },
        loans: {
          activeCount: activeLoans,
          totalOutstanding: round2(outstanding),
        },
      },
    });
  } catch (err: any) {
    console.error('getMyStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 9. MY PROJECTS — GET /api/me/projects
//    Projects where the caller is the manager OR a team member.
//    Returns myRole + canEditAsPM so the frontend can gate UI.
// ══════════════════════════════════════════════════════════════════════════
export async function getMyProjectsSelf(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const {
      status,
      priority,
      projectType,
      search,
      sort = '-createdAt',
      page = '1',
      limit = '50',
    } = req.query;

    const filter: any = {
      isDeleted: false,
      $or: [{ projectManager: emp._id }, { teamMembers: emp._id }],
    };

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }
    if (priority) filter.priority = String(priority);
    if (projectType) filter.projectType = String(projectType);

    if (search) {
      filter.$and = [
        {
          $or: [
            { name: { $regex: String(search), $options: 'i' } },
            { projectId: { $regex: String(search), $options: 'i' } },
            { description: { $regex: String(search), $options: 'i' } },
          ],
        },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [projects, total] = await Promise.all([
      Project.find(filter)
        .populate('clientId', 'clientId name clientType status')
        .populate('projectManager', 'name employeeId designation department')
        .populate('teamMembers', 'name employeeId designation department')
        .select(
          'projectId name description status priority progress deadline projectType budget currency department taskCategories projectManager teamMembers milestones totalEstimatedHours totalActualHours totalTasks completedTasks createdAt updatedAt'
        )
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Project.countDocuments(filter),
    ]);

    const myId = String(emp._id);

    const decorated = projects.map((p: any) => {
      const milestones = p.milestones ?? [];
      const pmId = String(
        p.projectManager && typeof p.projectManager === 'object'
          ? p.projectManager._id
          : p.projectManager ?? ''
      );
      const isManager = pmId === myId;

      return {
        ...p,
        myRole: isManager ? 'manager' : 'member',
        canEditAsPM: isManager,
        milestoneStats: {
          total: milestones.length,
          completed: milestones.filter((m: any) => m.isCompleted).length,
        },
      };
    });

    res.json({
      success: true,
      data: decorated,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum) || 1,
      },
    });
  } catch (err: any) {
    console.error('getMyProjectsSelf error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 10. MY PROJECT DETAIL — GET /api/me/projects/:projectId
//     Only accessible if the caller is the PM or a team member.
//     Hardened against null/undefined/string/ObjectId inconsistencies.
// ══════════════════════════════════════════════════════════════════════════
export async function getMyProjectDetail(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const emp = await resolveSelf(req, res);
    if (!emp) return;

    const { projectId } = req.params;
    const idStr = String(projectId);

    const base = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr }
      : { projectId: idStr };

    const project = await Project.findOne({ ...base, isDeleted: false })
      .populate('clientId', 'clientId name clientType status email phoneNo')
      .populate('leadId', 'leadId name companyName email phoneNo status')
      .populate(
        'projectManager',
        'name employeeId designation department phoneNo email'
      )
      .populate('teamMembers', 'name employeeId designation department')
      .populate('createdBy', 'name employeeId')
      .populate('activities.performedBy', 'name employeeId')
      .populate('attachments.uploadedBy', 'name employeeId')
      .lean();

    if (!project) {
      res.status(404).json({ success: false, message: 'Project not found' });
      return;
    }

    // ── Hardened membership check ────────────────────────────────────
    const myId = String(emp._id);

    const pmRaw: any = (project as any).projectManager;
    const pmId = String(
      pmRaw && typeof pmRaw === 'object' ? pmRaw._id : pmRaw ?? ''
    );

    const teamArr: any[] = Array.isArray((project as any).teamMembers)
      ? (project as any).teamMembers
      : [];

    const isManager = pmId === myId;
    const isMember = teamArr.some((m: any) => {
      const mId = String(m && typeof m === 'object' ? m._id : m ?? '');
      return mId === myId;
    });

    // Extra safety: also accept if employee.user matches createdBy.user etc.
    // (not needed — but the above is already robust)

    console.log(
      `[getMyProjectDetail] emp=${myId} pm=${pmId} teamSize=${teamArr.length} isManager=${isManager} isMember=${isMember}`
    );

    if (!isManager && !isMember) {
      res.status(403).json({
        success: false,
        message:
          'You do not have access to this project. Ask your project manager to add you to the team.',
      });
      return;
    }

    const permissions = {
      canEdit: isManager,
      canChangeStatus: isManager,
      canManageTeam: isManager,
      canManageMilestones: isManager,
      canManageCategories: false,
      canRecomputeProgress: isManager,
      canDelete: false,
      canViewAllTasks: true,
      canCreateTasks: true,
      canManageTasks: isManager,
    };

    res.json({
      success: true,
      data: {
        ...project,
        myRole: isManager ? 'manager' : 'member',
        permissions,
      },
    });
  } catch (err: any) {
    console.error('getMyProjectDetail error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}