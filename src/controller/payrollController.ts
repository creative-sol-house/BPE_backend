// controller/payrollController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Employee from '../model/employee';
import Attendance from '../model/attendance';
import EmployeeRequest from '../model/EmployeeRequest';
import Loan from '../model/Loan';
import { AuthRequest } from '../middleware/auth';
import {
  installmentsDueInMonth,
  markInstallmentPaid,
} from '../services/loanHelpers';

// ══════════════════════════════════════════════════════════════════════════
// Config
// ══════════════════════════════════════════════════════════════════════════
const WEEKEND_DAYS = new Set([0, 6]); // Sun, Sat (JS getUTCDay(): 0=Sun)
const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// ══════════════════════════════════════════════════════════════════════════
// Small helpers
// ══════════════════════════════════════════════════════════════════════════
function bad(res: Response, msg: string, code = 400): void {
  res.status(code).json({ success: false, message: msg });
}

function round2(n: number): number {
  return +Number(n).toFixed(2);
}

/** First day of month at 00:00 UTC, last day at 23:59:59.999 UTC. */
function monthBounds(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return { start, end };
}

/** YYYY-MM-DD key from a Date (UTC). */
function dayKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Enumerate every date (UTC midnight) between bounds inclusive. */
function* daysBetween(start: Date, end: Date): Generator<Date> {
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  while (cur <= end) {
    yield new Date(cur);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
}

/**
 * Look up the Holiday model lazily. If it isn't registered in the project,
 * we degrade gracefully (all weekends treated as holidays, no extra holidays).
 */
function getHolidayModel(): any {
  try {
    return mongoose.model('Holiday');
  } catch {
    return null;
  }
}

/**
 * Determine the set of holiday dates (YYYY-MM-DD) within the month.
 * Combines:
 *   - weekend days (Sat/Sun)   [always]
 *   - Holiday collection docs, if the model exists
 */
async function getHolidayKeys(
  year: number,
  month: number
): Promise<Set<string>> {
  const keys = new Set<string>();
  const { start, end } = monthBounds(year, month);

  // Weekends
  for (const d of daysBetween(start, end)) {
    if (WEEKEND_DAYS.has(d.getUTCDay())) keys.add(dayKey(d));
  }

  // Holiday model (best-effort)
  const Holiday = getHolidayModel();
  if (Holiday) {
    try {
      const rows = await Holiday.find({
        date: { $gte: start, $lte: end },
        isDeleted: { $ne: true },
      })
        .select('date')
        .lean();
      for (const r of rows) {
        if (r?.date) keys.add(dayKey(new Date(r.date)));
      }
    } catch {
      // ignore — fall back to weekends only
    }
  }

  return keys;
}


/**
 * Determine if a single Attendance row represents a full, half, or absent day.
 * Returns { credit, reason } where credit is 0, 0.5, or 1.
 *
 * Rules (in order):
 *   - If `halfDay === true` or `status === 'half_day'` → 0.5
 *   - If `status === 'holiday'` or `isHoliday === true` → 1.0 (credited)
 *   - If `status === 'leave'` → 1.0 (leave ledger already deducted)
 *   - If `status === 'absent'` → 0
 *   - If arrivalAt & departureAt both set → 1.0 (present)
 *   - Else → 0
 */


/**
 * Total *working* (non-holiday, non-weekend) days in the target month.
 * Used as the divisor for the daily rate.
 */
async function countWorkingDays(year: number, month: number): Promise<number> {
  const holidays = await getHolidayKeys(year, month);
  const { start, end } = monthBounds(year, month);

  let count = 0;
  for (const d of daysBetween(start, end)) {
    if (!holidays.has(dayKey(d))) count++;
  }
  return count;
}

/**
 * Total calendar days in the target month (28–31).
 * This is the correct divisor for a monthly salary — a full month of
 * credited days (weekdays + holiday-credited weekends) equals one month's
 * base pay, no matter how many weekend days fall in it.
 */
function countCalendarDays(year: number, month: number): number {
  // new Date(Date.UTC(year, month, 0)) → last day of the month
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function attendanceCredit(row: any): { credit: number; reason: string } {
  if (!row) return { credit: 0, reason: 'no_attendance_row' };

  const status = String(row.status ?? '').toLowerCase();

  if (row.halfDay === true || status === 'half_day' || status === 'half-day') {
    return { credit: 0.5, reason: 'half_day' };
  }
  if (status === 'holiday' || row.isHoliday === true) {
    return { credit: 1, reason: 'holiday' };
  }
  if (status === 'leave' || status === 'on_leave') {
    return { credit: 1, reason: 'leave' };
  }
  if (status === 'absent') {
    return { credit: 0, reason: 'absent' };
  }
  if (status === 'present' || (row.arrivalAt && row.departureAt)) {
    return { credit: 1, reason: 'present' };
  }
  return { credit: 0, reason: 'unknown' };
}

// ══════════════════════════════════════════════════════════════════════════
// Core computation
// ══════════════════════════════════════════════════════════════════════════
interface PayrollBreakdown {
  employee: {
    _id: string;
    name: string;
    employeeId: string;
    department: string;
    designation: string;
  };
  period: { year: number; month: number; label: string };

  salaryStructure: 'fixed' | 'piece_rate';
  rates: {
    basicSalary: number;
    pieceRateSalary: number;
    overtimePerHourAmount: number;
  };

  // ── Fixed salary breakdown ──
  workingDaysInMonth: number;
    calendarDaysInMonth: number;              // 👈 NEW

  attendedFullDays: number;
  attendedHalfDays: number;
  holidayDaysCredited: number;
  leaveDaysCredited: number;
  absentDays: number;
  earnedDays: number;
  dailyRate: number;
  grossEarned: number;

  // ── Absence detail ──
  absences: { date: string; reason: string }[];

  // ── Overtime (approved only) ──
  overtimeRequests: any[];
  overtimeHoursApproved: number;
  overtimeAmountApproved: number;

  // ── Piece rate (hooks for future) ──
  pieceCount: number | null;
  pieceAmount: number;

  // ── Loan recovery ──
  loanDeductions: {
    loanId: string;
    employeeId: string;
    seq: number;
    dueDate: Date;
    amount: number;
    status: 'paid' | 'pending' | 'unpaid';
    loanStatus: string;
  }[];
  loanRecovery: number;
  loanRecoveryOriginal: number;
  loanCapped: boolean;

  // ── Deductions breakdown ──
  deductions: {
    loans: number;
    others: number;
    total: number;
  };

  // ── Totals ──
  grossPay: number;
  netPay: number;

  generatedAt: Date;
  generatedBy?: { _id: string; name: string };
}

async function computePayroll(
  employee: any,
  year: number,
  month: number,
  opts: {
    includeOvertimeRequests?: boolean;
    includeLoanDetails?: boolean;
    applyLoanRecovery?: boolean;       // 👈 set true when finalizing payroll
    finalizedBy?: { _id: any; name: string };
  } = {}
): Promise<PayrollBreakdown> {
  const { start, end } = monthBounds(year, month);
  const holidayKeys = await getHolidayKeys(year, month);
  const workingDaysInMonth = await countWorkingDays(year, month);
  const calendarDaysInMonth = countCalendarDays(year, month);

  // ── 1. Attendance rows for the month ─────────────────────────────────
  const attendances = await Attendance.find({
    employee: employee._id,
    isDeleted: false,
    date: { $gte: start, $lte: end },
  })
    .select(
      'date status halfDay isHoliday arrivalAt departureAt workedHours isDeleted'
    )
    .lean();

  const attByDay = new Map<string, any>();
  for (const a of attendances) {
    attByDay.set(dayKey(new Date(a.date)), a);
  }

  let attendedFullDays = 0;
  let attendedHalfDays = 0;
  let holidayDaysCredited = 0;
  let leaveDaysCredited = 0;
  let absentDays = 0;
  let earnedDays = 0;
  const absences: { date: string; reason: string }[] = [];

  for (const d of daysBetween(start, end)) {
    const k = dayKey(d);
    const row = attByDay.get(k);
    const isHoliday = holidayKeys.has(k);

    if (!row) {
      // No attendance row.
      // - If the day is a weekend/holiday → no credit, no absence.
      // - If it's a working day → absence (unpaid).
      if (!isHoliday) {
        absentDays += 1;
        absences.push({ date: k, reason: 'no_attendance_row' });
      }
      continue;
    }

    const { credit, reason } = attendanceCredit(row);
    earnedDays += credit;

    if (credit === 1) {
      if (reason === 'holiday') holidayDaysCredited += 1;
      else if (reason === 'leave') leaveDaysCredited += 1;
      else attendedFullDays += 1;
    } else if (credit === 0.5) {
      attendedHalfDays += 1;
    } else {
      absentDays += 1;
      absences.push({ date: k, reason });
    }
  }

  earnedDays = round2(earnedDays);

  // ── 2. Rates ─────────────────────────────────────────────────────────
  const salaryStructure: 'fixed' | 'piece_rate' =
    employee.salaryStructure === 'piece_rate' ? 'piece_rate' : 'fixed';

  const basicSalary = round2(Number(employee.basicSalary ?? 0));
  const pieceRateSalary = round2(Number(employee.pieceRateSalary ?? 0));
  const overtimePerHourAmount = round2(
    Number(employee.overtimePerHourAmount ?? 0)
  );

  // ── 3. Fixed-salary gross ────────────────────────────────────────────
  // The daily rate uses CALENDAR days (28–31), not working days. This
  // ensures that a fully-credited month pays exactly one month's salary,
  // regardless of how many weekends fall inside it.
  //
  //   dailyRate   = basicSalary / calendarDaysInMonth
  //   grossEarned = dailyRate * earnedDays
  //
  // Where `earnedDays` = count of days credited (present + half + holiday-
  // credited weekends + leave days). A full month credits all days →
  // grossEarned = basicSalary. An absence just removes one calendar day's
  // worth of pay.
  // Compute daily rate at full precision — do NOT round the divisor result,
  // otherwise a rounded dailyRate * 31 reintroduces error (e.g. 12000 → 12000.1).
  const rawDailyRate =
    salaryStructure === 'fixed' && calendarDaysInMonth > 0
      ? basicSalary / calendarDaysInMonth
      : 0;

  // Keep an exposed (rounded) version for display / reporting.
  const dailyRate = round2(rawDailyRate);

  let grossEarned = 0;
  if (salaryStructure === 'fixed') {
    // Use the raw rate for the multiplication, round ONLY the final result.
    grossEarned = round2(rawDailyRate * earnedDays);

    // 🎁 Snap to basicSalary when the employee earned the whole month.
    // This is what keeps payslips clean: 31/31 days → exactly 12000.
    if (earnedDays >= calendarDaysInMonth) {
      grossEarned = basicSalary;
    }
  } else {
    grossEarned = 0;
  }

  // ── 4. Overtime — approved only ──────────────────────────────────────
  const overtimeFilter: any = {
    employee: employee._id,
    type: 'overtime',
    status: 'approved',
    isDeleted: false,
    'data.overtimeDate': { $gte: start, $lte: end },
  };

  const overtimeDocs = await EmployeeRequest.find(overtimeFilter)
    .populate('decidedBy', 'name')
    .sort({ 'data.overtimeDate': 1 })
    .lean();

  let overtimeHoursApproved = 0;
  let overtimeAmountApproved = 0;
  const overtimeRequests = overtimeDocs.map((r: any) => {
    const d = r.data || {};
    const hours =
      Number(d.approvedOvertimeHours ?? d.overtimeHours ?? 0) || 0;
    const rate =
      Number(
        d.approvedOvertimeRatePerHour ??
          d.overtimeRatePerHour ??
          employee.overtimePerHourAmount ??
          0
      ) || 0;
    const amount =
      Number(
        d.approvedOvertimeAmount ??
          (d.overtimeAmount !== undefined
            ? d.overtimeAmount
            : hours * rate)
      ) || 0;

    overtimeHoursApproved += hours;
    overtimeAmountApproved += amount;

    return {
      _id: r._id,
      date: d.overtimeDate,
      fromTime: d.overtimeFromTime,
      toTime: d.overtimeToTime,
      hours: round2(hours),
      rate: round2(rate),
      amount: round2(amount),
      status: r.status,
      note: d.overtimeNote ?? '',
      decidedBy: r.decidedBy
        ? { _id: r.decidedBy._id, name: r.decidedBy.name }
        : null,
      decidedAt: r.decidedAt ?? null,
    };
  });

  overtimeHoursApproved = round2(overtimeHoursApproved);
  overtimeAmountApproved = round2(overtimeAmountApproved);

  // ── 5. Loan recovery ─────────────────────────────────────────────────
  // Pull every installment due in the target month across all active loans.
  let loanDeductions: PayrollBreakdown['loanDeductions'] = [];
  let loanRecoveryOriginal = 0;

  try {
    const dueRows = await installmentsDueInMonth(employee._id, year, month);

    // Build a loanId -> status map so we can report loan status.
    const loanIds = [...new Set((dueRows as any[]).map((d) => String(d.loanId)))];
    const loans = loanIds.length
      ? await Loan.find({ _id: { $in: loanIds }, isDeleted: false })
          .select('_id status')
          .lean()
      : [];
    const loanStatusById = new Map<string, string>();
    for (const l of loans) loanStatusById.set(String(l._id), l.status);

    for (const d of dueRows as any[]) {
      // Safety net: skip already-paid installments
      if (d.installment?.status === 'paid') continue;

      const amount = round2(Number(d.installment.amount ?? 0));
      loanRecoveryOriginal += amount;
      loanDeductions.push({
        loanId: String(d.loanId),
        employeeId: String(employee._id),
        seq: Number(d.installment.seq),
        dueDate: d.installment.dueDate,
        amount,
        status: d.installment.status,
        loanStatus: loanStatusById.get(String(d.loanId)) ?? 'unknown',
      });
    }
  } catch (e) {
    console.error('computePayroll: loan lookup failed', e);
  }

  loanRecoveryOriginal = round2(loanRecoveryOriginal);

  // ── 6. Cap loan recovery against gross earnings ──────────────────────
  // We never let a single month's loan recovery push net below 0.
  // Any shortfall naturally rolls into the next month since the
  // installment stays unpaid.
  const grossPay = round2(grossEarned + overtimeAmountApproved);

  let loanRecovery = loanRecoveryOriginal;
  let loanCapped = false;

  if (loanRecovery > grossPay) {
    loanRecovery = grossPay;
    loanCapped = true;
  }

  const otherDeductions = 0; // hook for future (tax, PF, etc.)
  const deductionsTotal = round2(loanRecovery + otherDeductions);
  const netPay = round2(grossPay - deductionsTotal);

  // ── 7. Optionally commit the recovery (mark installments paid) ───────
  // We only do this when the caller explicitly opts in (finalize payroll).
  if (opts.applyLoanRecovery && loanRecovery > 0) {
    let remaining = loanRecovery;
    // Sort by due date so oldest installments clear first.
    const sorted = [...loanDeductions].sort(
      (a, b) =>
        new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    );

    for (const d of sorted) {
      if (remaining <= 0) break;
      if (d.status === 'paid') continue;

      const payAmount = Math.min(d.amount, remaining);
      if (payAmount <= 0) continue;

      try {
        await markInstallmentPaid(d.loanId as any, d.seq, {
          paidAmount: payAmount,
          paidAt: new Date(),
          payrollId: null,
          notes: `Payroll recovery ${MONTH_LABELS[month - 1]} ${year}`,
        });
        remaining = round2(remaining - payAmount);
      } catch (e) {
        console.error(
          `computePayroll: failed to mark installment paid for loan ${d.loanId} seq ${d.seq}`,
          e
        );
      }
    }
  }

  // ── 8. Return ────────────────────────────────────────────────────────
  return {
    employee: {
      _id: String(employee._id),
      name: employee.name,
      employeeId: employee.employeeId,
      department: employee.department ?? '',
      designation: employee.designation ?? '',
    },
    period: {
      year,
      month,
      label: `${MONTH_LABELS[month - 1]} ${year}`,
    },
    salaryStructure,
    rates: { basicSalary, pieceRateSalary, overtimePerHourAmount },

       workingDaysInMonth,
    calendarDaysInMonth,                    // 👈 NEW
    attendedFullDays,
    attendedHalfDays,
    holidayDaysCredited,
    leaveDaysCredited,
    absentDays,
    earnedDays,
    dailyRate,
    grossEarned,

    absences,

    overtimeRequests:
      opts.includeOvertimeRequests === false ? [] : overtimeRequests,
    overtimeHoursApproved,
    overtimeAmountApproved,

    pieceCount: null,
    pieceAmount: 0,

    loanDeductions:
      opts.includeLoanDetails === false ? [] : loanDeductions,
    loanRecovery,
    loanRecoveryOriginal,
    loanCapped,

    grossPay,
    deductions: {
      loans: loanRecovery,
      others: otherDeductions,
      total: deductionsTotal,
    },
    netPay,

    generatedAt: new Date(),
    generatedBy: opts.finalizedBy,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// PREVIEW  — GET /api/payroll/preview/:employeeId?year=&month=
// ══════════════════════════════════════════════════════════════════════════
export async function previewPayroll(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { employeeId } = req.params;
    const { year, month } = req.query;

    const y = Number(year);
    const m = Number(month);

    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      bad(res, 'year must be between 2000 and 2100');
      return;
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      bad(res, 'month must be 1–12');
      return;
    }

    const idStr = String(employeeId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };

    const employee = await Employee.findOne(query).lean();
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const breakdown = await computePayroll(employee, y, m, {
      includeOvertimeRequests: true,
      includeLoanDetails: true,
    });
    breakdown.generatedBy = req.user
      ? { _id: String(req.user._id), name: req.user.name ?? '' }
      : undefined;

    res.json({ success: true, data: breakdown });
  } catch (err: any) {
    console.error('previewPayroll error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// BATCH  — GET /api/payroll/batch?year=&month=&department=&search=&page=&limit=
// ══════════════════════════════════════════════════════════════════════════
export async function batchPayroll(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      year,
      month,
      department,
      search,
      page = '1',
      limit = '50',
    } = req.query;

    const y = Number(year);
    const m = Number(month);

    if (!Number.isInteger(y) || y < 2000 || y > 2100) {
      bad(res, 'year must be between 2000 and 2100');
      return;
    }
    if (!Number.isInteger(m) || m < 1 || m > 12) {
      bad(res, 'month must be 1–12');
      return;
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = { isDeleted: false, isActive: true };
    if (department) filter.department = department;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { employeeId: { $regex: search, $options: 'i' } },
      ];
    }

    const [employees, total] = await Promise.all([
      Employee.find(filter)
        .sort({ employeeId: 1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Employee.countDocuments(filter),
    ]);

    // Compute each payroll sequentially to avoid hammering Mongo.
    const rows: PayrollBreakdown[] = [];
    for (const emp of employees) {
      rows.push(
        await computePayroll(emp, y, m, {
          includeOvertimeRequests: false,
          includeLoanDetails: true,
        })
      );
    }

    const totals = {
      grossPay: round2(rows.reduce((s, r) => s + r.grossPay, 0)),
      netPay: round2(rows.reduce((s, r) => s + r.netPay, 0)),
      overtimeAmount: round2(
        rows.reduce((s, r) => s + r.overtimeAmountApproved, 0)
      ),
      loanRecovery: round2(
        rows.reduce((s, r) => s + r.loanRecovery, 0)
      ),
      absentDays: rows.reduce((s, r) => s + r.absentDays, 0),
      employees: rows.length,
    };

    res.json({
      success: true,
      data: rows,
      totals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('batchPayroll error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// FINALIZE  — POST /api/payroll/finalize/:employeeId
// Body: { year, month }
//
// This is the *committing* step. It:
//   - recomputes payroll
//   - marks all due loan installments as paid (capped at gross)
//   - returns the final breakdown
//
// Calling this twice for the same month is idempotent for loan installments
// (already-paid ones are skipped).
// ══════════════════════════════════════════════════════════════════════════
export async function finalizePayroll(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { employeeId } = req.params;
    const { year, month } = req.body;

    const y = Number(year);
    const m = Number(month);
    if (
      !Number.isInteger(y) || y < 2000 || y > 2100 ||
      !Number.isInteger(m) || m < 1 || m > 12
    ) {
      bad(res, 'Valid year and month are required');
      return;
    }

    const idStr = String(employeeId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };

    const employee = await Employee.findOne(query).lean();
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const breakdown = await computePayroll(employee, y, m, {
      includeOvertimeRequests: true,
      includeLoanDetails: true,
      applyLoanRecovery: true,           // 👈 commit
      finalizedBy: req.user
        ? { _id: req.user._id, name: req.user.name ?? '' }
        : undefined,
    });

    res.json({
      success: true,
      message: `Payroll finalized for ${breakdown.period.label}`,
      data: breakdown,
    });
  } catch (err: any) {
    console.error('finalizePayroll error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// OVERTIME LIST  — GET /api/payroll/overtime/:employeeId?year=&month=&status=
// Returns ALL overtime requests (any status) so the payroll UI can manage them.
// ══════════════════════════════════════════════════════════════════════════
export async function listOvertimeForEmployee(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { employeeId } = req.params;
    const { year, month, status } = req.query;

    const idStr = String(employeeId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };

    const employee = await Employee.findOne(query).select(
      '_id name employeeId overtimePerHourAmount'
    );
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const filter: any = {
      employee: employee._id,
      type: 'overtime',
      isDeleted: false,
    };

    if (year && month) {
      const y = Number(year);
      const m = Number(month);
      if (
        !Number.isInteger(y) || y < 2000 || y > 2100 ||
        !Number.isInteger(m) || m < 1 || m > 12
      ) {
        bad(res, 'Invalid year or month');
        return;
      }
      const { start, end } = monthBounds(y, m);
      filter['data.overtimeDate'] = { $gte: start, $lte: end };
    }

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (list.length) filter.status = { $in: list };
    }

    const rows = await EmployeeRequest.find(filter)
      .populate('decidedBy', 'name')
      .sort({ 'data.overtimeDate': -1, createdAt: -1 })
      .lean();

    const decorated = rows.map((r: any) => {
      const d = r.data || {};
      const hours = Number(d.approvedOvertimeHours ?? d.overtimeHours ?? 0);
      const rate = Number(
        d.approvedOvertimeRatePerHour ??
          d.overtimeRatePerHour ??
          employee.overtimePerHourAmount ??
          0
      );
      const amount = Number(
        d.approvedOvertimeAmount ??
          d.overtimeAmount ??
          hours * rate
      );

      return {
        _id: r._id,
        employee: {
          _id: String(employee._id),
          name: employee.name,
          employeeId: employee.employeeId,
        },
        date: d.overtimeDate,
        fromTime: d.overtimeFromTime,
        toTime: d.overtimeToTime,
        hours: round2(hours),
        rate: round2(rate),
        amount: round2(amount),
        note: d.overtimeNote ?? '',
        status: r.status,
        source: r.source,
        subject: r.subject,
        decisionNote: r.decisionNote ?? '',
        decidedBy: r.decidedBy
          ? { _id: r.decidedBy._id, name: r.decidedBy.name }
          : null,
        decidedAt: r.decidedAt ?? null,
        createdAt: r.createdAt,
        comments: r.comments ?? [],
      };
    });

    const counts = {
      pending: decorated.filter((r) => r.status === 'pending').length,
      approved: decorated.filter((r) => r.status === 'approved').length,
      rejected: decorated.filter((r) => r.status === 'rejected').length,
      cancelled: decorated.filter((r) => r.status === 'cancelled').length,
    };

    res.json({ success: true, data: decorated, counts });
  } catch (err: any) {
    console.error('listOvertimeForEmployee error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// OVERTIME APPROVE  — POST /api/payroll/overtime/:requestId/approve
// Body: { approvedOvertimeHours?, approvedOvertimeRatePerHour?,
//         approvedOvertimeFromTime?, approvedOvertimeToTime?, note? }
// ══════════════════════════════════════════════════════════════════════════

export async function approveOvertime(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { requestId } = req.params;
    const {
      approvedOvertimeHours,
      approvedOvertimeRatePerHour,
      approvedOvertimeFromTime,
      approvedOvertimeToTime,
      note,
    } = req.body;

    const doc = await EmployeeRequest.findOne({
      _id: requestId,
      type: 'overtime',
      isDeleted: false,
    });
    if (!doc) {
      bad(res, 'Overtime request not found', 404);
      return;
    }
    if (doc.status !== 'pending') {
      bad(res, `Cannot approve a ${doc.status} request`);
      return;
    }

    // Apply timing overrides
    if (
      typeof approvedOvertimeFromTime === 'string' &&
      /^([01]\d|2[0-3]):([0-5]\d)$/.test(approvedOvertimeFromTime)
    ) {
      doc.data.overtimeFromTime = approvedOvertimeFromTime;
    }
    if (
      typeof approvedOvertimeToTime === 'string' &&
      /^([01]\d|2[0-3]):([0-5]\d)$/.test(approvedOvertimeToTime)
    ) {
      doc.data.overtimeToTime = approvedOvertimeToTime;
    }

    // Compute hours
    let hours: number;
    if (
      approvedOvertimeHours !== undefined &&
      approvedOvertimeHours !== null &&
      !Number.isNaN(Number(approvedOvertimeHours))
    ) {
      hours = Number(approvedOvertimeHours);
    } else {
      const [fh, fm] = (doc.data.overtimeFromTime ?? '00:00')
        .split(':')
        .map(Number);
      const [th, tm] = (doc.data.overtimeToTime ?? '00:00')
        .split(':')
        .map(Number);
      hours = (th * 60 + tm - (fh * 60 + fm)) / 60;
    }

    if (!(hours > 0) || hours > 24) {
      bad(res, 'approved hours must be between 0 and 24');
      return;
    }
    doc.data.approvedOvertimeHours = round2(hours);

    // Compute rate
    let rate: number;
    if (
      approvedOvertimeRatePerHour !== undefined &&
      approvedOvertimeRatePerHour !== null &&
      !Number.isNaN(Number(approvedOvertimeRatePerHour))
    ) {
      rate = Number(approvedOvertimeRatePerHour);
    } else if (
      doc.data.overtimeRatePerHour &&
      doc.data.overtimeRatePerHour > 0
    ) {
      rate = Number(doc.data.overtimeRatePerHour);
    } else {
      const emp = await Employee.findById(doc.employee).select(
        'overtimePerHourAmount'
      );
      rate = Number(emp?.overtimePerHourAmount ?? 0);
    }

    if (rate < 0) {
      bad(res, 'rate cannot be negative');
      return;
    }
    doc.data.approvedOvertimeRatePerHour = round2(rate);
    doc.data.approvedOvertimeAmount = round2(hours * rate);

    doc.markModified('data');

    doc.status = 'approved';
    doc.decidedBy = req.user!._id;
    doc.decidedByName = req.user!.name ?? '';
    doc.decidedAt = new Date();
    doc.decisionNote = note ? String(note).trim() : '';

    await doc.save();

    res.json({
      success: true,
      message: 'Overtime approved',
      data: doc,
    });
  } catch (err: any) {
    console.error('approveOvertime error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// OVERTIME REJECT  — POST /api/payroll/overtime/:requestId/reject
// Body: { note? }
// ══════════════════════════════════════════════════════════════════════════
export async function rejectOvertime(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { requestId } = req.params;
    const { note } = req.body;

    const doc = await EmployeeRequest.findOne({
      _id: requestId,
      type: 'overtime',
      isDeleted: false,
    });
    if (!doc) {
      bad(res, 'Overtime request not found', 404);
      return;
    }
    if (doc.status !== 'pending') {
      bad(res, `Cannot reject a ${doc.status} request`);
      return;
    }

    doc.status = 'rejected';
    doc.decidedBy = req.user!._id;
    doc.decidedByName = req.user!.name ?? '';
    doc.decidedAt = new Date();
    doc.decisionNote = note ? String(note).trim() : '';
    await doc.save();

    res.json({
      success: true,
      message: 'Overtime rejected',
      data: doc,
    });
  } catch (err: any) {
    console.error('rejectOvertime error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// OVERTIME CANCEL  — POST /api/payroll/overtime/:requestId/cancel
// ══════════════════════════════════════════════════════════════════════════
export async function cancelOvertime(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { requestId } = req.params;

    const doc = await EmployeeRequest.findOne({
      _id: requestId,
      type: 'overtime',
      isDeleted: false,
    });
    if (!doc) {
      bad(res, 'Overtime request not found', 404);
      return;
    }
    if (doc.status !== 'pending' && !req.user!.isMainAdmin) {
      bad(res, 'Only pending requests can be cancelled');
      return;
    }

    doc.status = 'cancelled';
    doc.cancelledBy = req.user!._id;
    doc.cancelledAt = new Date();
    await doc.save();

    res.json({
      success: true,
      message: 'Overtime cancelled',
      data: doc,
    });
  } catch (err: any) {
    console.error('cancelOvertime error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// SUMMARY  — GET /api/payroll/summary?year=&month=
// Aggregates totals across all active employees.
// ══════════════════════════════════════════════════════════════════════════
export async function payrollSummary(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { year, month } = req.query;

    const y = Number(year);
    const m = Number(month);
    if (
      !Number.isInteger(y) || y < 2000 || y > 2100 ||
      !Number.isInteger(m) || m < 1 || m > 12
    ) {
      bad(res, 'Valid year and month are required');
      return;
    }

    const employees = await Employee.find({
      isDeleted: false,
      isActive: true,
    }).lean();

    let totalGross = 0;
    let totalNet = 0;
    let totalOvertime = 0;
    let totalOvertimeHours = 0;
    let totalAbsentDays = 0;
    let totalLoanRecovery = 0;

    for (const emp of employees) {
      const breakdown = await computePayroll(emp, y, m, {
        includeOvertimeRequests: false,
        includeLoanDetails: false,
      });
      totalGross += breakdown.grossPay;
      totalNet += breakdown.netPay;
      totalOvertime += breakdown.overtimeAmountApproved;
      totalOvertimeHours += breakdown.overtimeHoursApproved;
      totalAbsentDays += breakdown.absentDays;
      totalLoanRecovery += breakdown.loanRecovery;
    }

    res.json({
      success: true,
      data: {
        period: { year: y, month: m, label: `${MONTH_LABELS[m - 1]} ${y}` },
        employeeCount: employees.length,
        totalGrossPay: round2(totalGross),
        totalNetPay: round2(totalNet),
        totalOvertimeHours: round2(totalOvertimeHours),
        totalOvertimeAmount: round2(totalOvertime),
        totalLoanRecovery: round2(totalLoanRecovery),
        totalAbsentDays,
      },
    });
  } catch (err: any) {
    console.error('payrollSummary error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// controller/payrollController.ts
export async function getMyPayroll(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user?.isEmployee) {
      return bad(res, 'You do not have an employee record', 404);
    }
    const emp = await Employee.findOne({ user: req.user._id, isDeleted: false });
    if (!emp) return bad(res, 'Employee record not found', 404);

    const { year, month } = req.query;
    const y = Number(year) || new Date().getUTCFullYear();
    const m = Number(month) || new Date().getUTCMonth() + 1;

    if (!Number.isInteger(y) || y < 2000 || y > 2100) return bad(res, 'Invalid year');
    if (!Number.isInteger(m) || m < 1 || m > 12) return bad(res, 'Invalid month');

    // Compute but DO NOT apply loan recovery (no side effects for a view)
    const breakdown = await computePayroll(emp, y, m, {
      includeOvertimeRequests: true,
      includeLoanDetails: true,
      applyLoanRecovery: false,          // ← critical
    });

    res.json({ success: true, data: breakdown });
  } catch (err: any) {
    console.error('getMyPayroll error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}