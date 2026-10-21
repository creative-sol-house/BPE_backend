// service/requestHelpers.ts
import mongoose, { Types } from 'mongoose';
import EmployeeRequest from '../model/EmployeeRequest';
import Employee, { type ILeaveAllocation } from '../model/employee';

// ══════════════════════════════════════════════════════════════════════════
// DATE HELPERS
// ══════════════════════════════════════════════════════════════════════════

export function toMidnightUTC(d: Date | string): Date {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

export function eachDayUTC(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  const cur = toMidnightUTC(from);
  const end = toMidnightUTC(to);
  while (cur <= end) {
    out.push(new Date(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export const WEEKEND_DAYS = new Set<number>([0, 6]);

export function isWeekend(d: Date): boolean {
  return WEEKEND_DAYS.has(d.getUTCDay());
}

// ══════════════════════════════════════════════════════════════════════════
// HOLIDAYS
// ══════════════════════════════════════════════════════════════════════════
export async function loadHolidaySet(days: Date[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (days.length === 0) return set;

  let Holiday: any = null;
  try {
    Holiday = mongoose.model('Holiday');
  } catch {
    return set;
  }

  const from = days[0];
  const to = days[days.length - 1];

  const rows = await Holiday.find({
    date: { $gte: from, $lte: to },
    isDeleted: { $ne: true },
  })
    .select('date')
    .lean();

  for (const r of rows) {
    set.add(toMidnightUTC(r.date).toISOString().slice(0, 10));
  }
  return set;
}

// ══════════════════════════════════════════════════════════════════════════
// WORKING-DAY COUNTER
// ══════════════════════════════════════════════════════════════════════════
export interface WorkingDaysResult {
  workingDays: number;
  workingDates: Date[];
  weekendDates: Date[];
  holidayDates: Date[];
}

export async function computeWorkingDays(
  from: Date,
  to: Date
): Promise<WorkingDaysResult> {
  const all = eachDayUTC(from, to);
  const holidaySet = await loadHolidaySet(all);

  const workingDates: Date[] = [];
  const weekendDates: Date[] = [];
  const holidayDates: Date[] = [];

  for (const d of all) {
    const key = d.toISOString().slice(0, 10);
    if (isWeekend(d)) {
      weekendDates.push(d);
    } else if (holidaySet.has(key)) {
      holidayDates.push(d);
    } else {
      workingDates.push(d);
    }
  }

  return {
    workingDays: workingDates.length,
    workingDates,
    weekendDates,
    holidayDates,
  };
}

export function groupWorkingDatesByMonth(
  dates: Date[]
): Array<{ year: number; month: number; days: number }> {
  const map = new Map<string, { year: number; month: number; days: number }>();
  for (const d of dates) {
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const key = `${y}-${m}`;
    const cur = map.get(key) ?? { year: y, month: m, days: 0 };
    cur.days += 1;
    map.set(key, cur);
  }
  return [...map.values()];
}

// ══════════════════════════════════════════════════════════════════════════
// TIME HELPERS  (used by overtime + permission)
// ══════════════════════════════════════════════════════════════════════════
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * Number of hours between two "HH:mm" strings.
 * Returns 0 if either is invalid or if `to` is not after `from`.
 */
export function timeToHours(from: string, to: string): number {
  if (!TIME_RE.test(from) || !TIME_RE.test(to)) return 0;
  const [fh, fm] = from.split(':').map(Number);
  const [th, tm] = to.split(':').map(Number);
  const diff = th * 60 + tm - (fh * 60 + fm);
  return diff > 0 ? +(diff / 60).toFixed(2) : 0;
}

// ══════════════════════════════════════════════════════════════════════════
// LEAVE BALANCE
// ══════════════════════════════════════════════════════════════════════════

async function pendingLeaveDaysForMonth(
  employeeId: Types.ObjectId,
  leaveType: string,
  year: number,
  month: number,
  excludeRequestId?: Types.ObjectId
): Promise<number> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const filter: any = {
    employee: employeeId,
    type: 'leave',
    status: 'pending',
    isDeleted: false,
    'data.leaveType': leaveType,
    'data.fromDate': { $lte: monthEnd },
    'data.toDate': { $gte: monthStart },
  };
  if (excludeRequestId) filter._id = { $ne: excludeRequestId };

  const rows = await EmployeeRequest.find(filter).select('data').lean();

  let total = 0;
  for (const r of rows) {
    const from = r.data?.fromDate ? new Date(r.data.fromDate) : null;
    const to = r.data?.toDate ? new Date(r.data.toDate) : null;
    if (!from || !to) continue;

    const overlapFrom = from > monthStart ? from : monthStart;
    const overlapTo = to < monthEnd ? to : monthEnd;

    const { workingDays } = await computeWorkingDays(overlapFrom, overlapTo);
    total += workingDays;
  }
  return total;
}

export interface LeaveBalanceRow {
  type: string;
  year: number;
  month: number;
  allocated: number;
  used: number;
  pending: number;
  remaining: number;
}

export interface LeaveBalanceSummary {
  year: number;
  totalAllocated: number;
  totalUsed: number;
  totalRemaining: number;
}

export interface LeaveBalance {
  rows: LeaveBalanceRow[];
  totals: { allocated: number; used: number; pending: number; remaining: number };
  types: string[];
  summary: LeaveBalanceSummary | null;
  year: number;
}

export async function getLeaveBalance(
  employeeId: Types.ObjectId,
  opts: { year?: number; type?: string } = {}
): Promise<LeaveBalance> {
  const targetYear = opts.year ?? new Date().getUTCFullYear();

  const employee = await Employee.findOne({
    _id: employeeId,
    isDeleted: false,
  }).select('leaveAllocations');
  if (!employee) {
    return {
      rows: [],
      totals: { allocated: 0, used: 0, pending: 0, remaining: 0 },
      types: [],
      summary: null,
      year: targetYear,
    };
  }

  const allocations = (employee.leaveAllocations ?? []) as ILeaveAllocation[];

  const filtered = allocations.filter((a) => {
    if (opts.year !== undefined && a.year !== opts.year) return false;
    if (opts.type && a.type.trim().toLowerCase() !== opts.type.trim().toLowerCase())
      return false;
    return true;
  });

  const rows: LeaveBalanceRow[] = [];
  for (const a of filtered) {
    const allocated = +(a.days + (a.carriedForward ?? 0)).toFixed(2);
    const used = +(a.used ?? 0).toFixed(2);
    const pending = await pendingLeaveDaysForMonth(
      employeeId,
      a.type,
      a.year,
      a.month
    );
    rows.push({
      type: a.type,
      year: a.year,
      month: a.month,
      allocated,
      used,
      pending: +pending.toFixed(2),
      remaining: +Math.max(0, allocated - used - pending).toFixed(2),
    });
  }

  rows.sort(
    (x, y) => x.year - y.year || x.month - y.month || x.type.localeCompare(y.type)
  );

  const totals = rows.reduce(
    (acc, r) => ({
      allocated: acc.allocated + r.allocated,
      used: acc.used + r.used,
      pending: acc.pending + r.pending,
      remaining: acc.remaining + r.remaining,
    }),
    { allocated: 0, used: 0, pending: 0, remaining: 0 }
  );

  const totalsRounded = {
    allocated: +totals.allocated.toFixed(2),
    used: +totals.used.toFixed(2),
    pending: +totals.pending.toFixed(2),
    remaining: +totals.remaining.toFixed(2),
  };

  // Derive the extra fields the new callers expect
  const types = [...new Set(rows.map((r) => r.type))].sort();
  const summary: LeaveBalanceSummary | null =
    rows.length > 0
      ? {
          year: targetYear,
          totalAllocated: totalsRounded.allocated,
          totalUsed: totalsRounded.used,
          totalRemaining: totalsRounded.remaining,
        }
      : null;

  return {
    rows,
    totals: totalsRounded,
    types,
    summary,
    year: targetYear,
  };
}

export async function checkLeaveFits(
  employeeId: Types.ObjectId,
  leaveType: string,
  workingDates: Date[],
  excludeRequestId?: Types.ObjectId
): Promise<{
  ok: boolean;
  deficits: Array<{ year: number; month: number; needed: number; remaining: number }>;
}> {
  const grouped = groupWorkingDatesByMonth(workingDates);
  const balance = await getLeaveBalance(employeeId, { type: leaveType });

  const deficits: Array<{
    year: number;
    month: number;
    needed: number;
    remaining: number;
  }> = [];

  for (const g of grouped) {
    const row = balance.rows.find(
      (r) => r.year === g.year && r.month === g.month
    );

    let pendingWithoutSelf = 0;
    if (excludeRequestId) {
      pendingWithoutSelf = await pendingLeaveDaysForMonth(
        employeeId,
        leaveType,
        g.year,
        g.month,
        excludeRequestId
      );
    }
    const effectiveRemaining = row
      ? +Math.max(0, row.allocated - row.used - pendingWithoutSelf).toFixed(2)
      : 0;

    if (effectiveRemaining + 1e-6 < g.days) {
      deficits.push({
        year: g.year,
        month: g.month,
        needed: +g.days.toFixed(2),
        remaining: +effectiveRemaining.toFixed(2),
      });
    }
  }

  return { ok: deficits.length === 0, deficits };
}

// ══════════════════════════════════════════════════════════════════════════
// ATTENDANCE-DERIVED USAGE
// ══════════════════════════════════════════════════════════════════════════

async function attendanceLeaveDaysForMonth(
  employeeId: Types.ObjectId,
  leaveType: string,
  year: number,
  month: number
): Promise<number> {
  let Attendance: any = null;
  try {
    Attendance = mongoose.model('Attendance');
  } catch {
    return 0;
  }

  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const matchingRequests = await EmployeeRequest.find({
    employee: employeeId,
    type: 'leave',
    isDeleted: false,
    status: 'approved',
    'data.leaveType': leaveType,
  })
    .select('_id')
    .lean();
  const requestIds = matchingRequests.map((r) => r._id);

  const notesPattern = new RegExp(
    `^leave:\\s*${leaveType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
    'i'
  );

  const or: any[] = [{ notes: notesPattern }];
  if (requestIds.length) or.push({ leaveRequestId: { $in: requestIds } });

  const rows = await Attendance.find({
    employee: employeeId,
    isDeleted: false,
    status: 'leave',
    date: { $gte: monthStart, $lte: monthEnd },
    $or: or,
  })
    .select('date')
    .lean();

  return rows.length;
}

// ══════════════════════════════════════════════════════════════════════════
// BALANCE PREVIEW
// ══════════════════════════════════════════════════════════════════════════

export interface BalancePreviewMonthRow {
  year: number;
  month: number;
  allocated: number;
  used: number;
  attendanceUsed: number;
  pending: number;
  remaining: number;
  requested: number;
  afterApproval: number;
  hasAllocation: boolean;
}

export interface BalancePreviewYearSummary {
  year: number;
  allocated: number;
  used: number;
  attendanceUsed: number;
  pending: number;
  remaining: number;
}

export interface BalancePreview {
  leaveType: string;
  yearSummary: BalancePreviewYearSummary;
  perMonth: BalancePreviewMonthRow[];
  totals: {
    requested: number;
    remaining: number;
    afterApproval: number;
    hasAllocation: boolean;
  };
  exceeds: boolean;
}

export async function computeBalancePreview(
  employeeId: Types.ObjectId,
  leaveType: string,
  workingDates: Date[],
  excludeRequestId?: Types.ObjectId
): Promise<BalancePreview> {
  const grouped = groupWorkingDatesByMonth(workingDates);
  const balance = await getLeaveBalance(employeeId, { type: leaveType });

  const year =
    grouped.length > 0
      ? Math.min(...grouped.map((g) => g.year))
      : new Date().getUTCFullYear();

  const yearBalanceRows = balance.rows.filter((r) => r.year === year);
  const yearAllocated = +yearBalanceRows
    .reduce((s, r) => s + r.allocated, 0)
    .toFixed(2);
  const yearUsed = +yearBalanceRows.reduce((s, r) => s + r.used, 0).toFixed(2);

  let yearAttendanceUsed = 0;
  for (let m = 1; m <= 12; m++) {
    yearAttendanceUsed += await attendanceLeaveDaysForMonth(
      employeeId,
      leaveType,
      year,
      m
    );
  }
  yearAttendanceUsed = +yearAttendanceUsed.toFixed(2);

  const perMonth: BalancePreviewMonthRow[] = [];

  for (const g of grouped) {
    const row = balance.rows.find(
      (r) => r.year === g.year && r.month === g.month
    );

    let pendingWithoutSelf = 0;
    if (excludeRequestId) {
      pendingWithoutSelf = await pendingLeaveDaysForMonth(
        employeeId,
        leaveType,
        g.year,
        g.month,
        excludeRequestId
      );
    }

    const allocated = row ? row.allocated : 0;
    const used = row ? row.used : 0;
    const pending = excludeRequestId
      ? +pendingWithoutSelf.toFixed(2)
      : row
      ? row.pending
      : 0;

    const attendanceUsed = await attendanceLeaveDaysForMonth(
      employeeId,
      leaveType,
      g.year,
      g.month
    );

    const effectiveUsed = Math.max(used, attendanceUsed);
    const remaining = +(allocated - effectiveUsed - pending).toFixed(2);
    const requested = +g.days.toFixed(2);
    const afterApproval = +(remaining - requested).toFixed(2);

    perMonth.push({
      year: g.year,
      month: g.month,
      allocated: +allocated.toFixed(2),
      used: +used.toFixed(2),
      attendanceUsed: +attendanceUsed.toFixed(2),
      pending,
      remaining,
      requested,
      afterApproval,
      hasAllocation: !!row,
    });
  }

  let yearPending = 0;
  for (let m = 1; m <= 12; m++) {
    yearPending += await pendingLeaveDaysForMonth(
      employeeId,
      leaveType,
      year,
      m,
      excludeRequestId
    );
  }
  yearPending = +yearPending.toFixed(2);

  const yearEffectiveUsed = Math.max(yearUsed, yearAttendanceUsed);
  const yearRemaining = +(yearAllocated - yearEffectiveUsed - yearPending).toFixed(
    2
  );

  const yearSummary: BalancePreviewYearSummary = {
    year,
    allocated: yearAllocated,
    used: yearUsed,
    attendanceUsed: yearAttendanceUsed,
    pending: yearPending,
    remaining: yearRemaining,
  };

  const totals = perMonth.reduce(
    (acc, m) => ({
      requested: acc.requested + m.requested,
      remaining: acc.remaining + m.remaining,
      afterApproval: acc.afterApproval + m.afterApproval,
      hasAllocation: acc.hasAllocation || m.hasAllocation,
    }),
    { requested: 0, remaining: 0, afterApproval: 0, hasAllocation: false }
  );

  return {
    leaveType,
    yearSummary,
    perMonth,
    totals: {
      requested: +totals.requested.toFixed(2),
      remaining: +totals.remaining.toFixed(2),
      afterApproval: +totals.afterApproval.toFixed(2),
      hasAllocation: totals.hasAllocation,
    },
    exceeds: perMonth.some((m) => m.afterApproval < -1e-6),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// OVERTIME — for payroll consumption
// ══════════════════════════════════════════════════════════════════════════

export interface OvertimePayrollEntry {
  requestId: Types.ObjectId;
  date: Date;
  fromTime?: string;
  toTime?: string;
  hours: number;
  ratePerHour: number;
  amount: number;
  approvedByName: string;
  decisionNote: string;
}

export interface OvertimePayrollSummary {
  employee: Types.ObjectId;
  from: Date;
  to: Date;
  totalHours: number;
  totalAmount: number;
  entries: OvertimePayrollEntry[];
}

export async function getOvertimeForPayroll(
  employeeId: Types.ObjectId | string,
  from: Date,
  to: Date
): Promise<OvertimePayrollSummary> {
  const fromD = toMidnightUTC(from);
  const toD = toMidnightUTC(to);
  const toEnd = new Date(toD);
  toEnd.setUTCHours(23, 59, 59, 999);

  const empId =
    typeof employeeId === 'string'
      ? new Types.ObjectId(employeeId)
      : employeeId;

  const rows = await EmployeeRequest.find({
    employee: empId,
    type: 'overtime',
    status: 'approved',
    isDeleted: false,
    'data.overtimeDate': { $gte: fromD, $lte: toEnd },
  })
    .sort({ 'data.overtimeDate': 1 })
    .lean();

  const entries: OvertimePayrollEntry[] = rows.map((r: any) => {
    const hours =
      r.data?.approvedOvertimeHours ?? r.data?.overtimeHours ?? 0;
    const rate =
      r.data?.approvedOvertimeRatePerHour ?? r.data?.overtimeRatePerHour ?? 0;
    const amount =
      r.data?.approvedOvertimeAmount ?? +(hours * rate).toFixed(2);

    return {
      requestId: r._id,
      date: r.data?.overtimeDate,
      fromTime: r.data?.overtimeFromTime,
      toTime: r.data?.overtimeToTime,
      hours: +Number(hours).toFixed(2),
      ratePerHour: +Number(rate).toFixed(2),
      amount: +Number(amount).toFixed(2),
      approvedByName: r.decidedByName ?? '',
      decisionNote: r.decisionNote ?? '',
    };
  });

  const totalHours = +entries.reduce((s, e) => s + e.hours, 0).toFixed(2);
  const totalAmount = +entries.reduce((s, e) => s + e.amount, 0).toFixed(2);

  return {
    employee: empId,
    from: fromD,
    to: toD,
    totalHours,
    totalAmount,
    entries,
  };
}