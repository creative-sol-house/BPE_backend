// service/requestHandlers.ts
import mongoose, { Types } from 'mongoose';
import {
  type IEmployeeRequest,
  type RequestType,
} from '../model/EmployeeRequest';
import Employee from '../model/employee';
import { computeWorkingDays, toMidnightUTC } from './requestHelpers';

// ══════════════════════════════════════════════════════════════════════════
// ATTENDANCE UPSERT HELPER
// ══════════════════════════════════════════════════════════════════════════

async function loadEmployeeForAttendance(employeeId: Types.ObjectId) {
  const emp = await Employee.findOne({ _id: employeeId, isDeleted: false }).select(
    'employeeId name department user overtimePerHourAmount'
  );
  return emp;
}

async function upsertAttendanceDay(
  employee: any,
  day: Date,
  patch: Record<string, any>
): Promise<'created' | 'updated' | 'skipped'> {
  let Attendance: any;
  try {
    Attendance = mongoose.model('Attendance');
  } catch {
    return 'skipped';
  }

  const date = toMidnightUTC(day);

  const existing = await Attendance.findOne({
    employee: employee._id,
    date,
    isDeleted: false,
  });

  if (existing) {
    if (existing.status === 'holiday' || existing.status === 'weekend') {
      return 'skipped';
    }
    Object.assign(existing, patch);
    await existing.save();
    return 'updated';
  }

  await Attendance.create({
    employee: employee._id,
    user: employee.user ?? null,
    employeeId: employee.employeeId,
    employeeName: employee.name,
    department: employee.department ?? '',
    date,
    arrivalAt: null,
    departureAt: null,
    workedHours: 0,
    isDeleted: false,
    source: 'auto',
    ...patch,
  });
  return 'created';
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: leave  (approved)
// ══════════════════════════════════════════════════════════════════════════
async function applyLeaveEffects(
  req: IEmployeeRequest
): Promise<NonNullable<IEmployeeRequest['appliedEffects']>> {
  const employee = await loadEmployeeForAttendance(req.employee);
  if (!employee) {
    return {
      attendanceRowsCreated: 0,
      attendanceRowsUpdated: 0,
      leaveAllocationRowsTouched: 0,
      appliedAt: new Date(),
      notes: 'Employee not found',
    };
  }

  const { workingDates } = await computeWorkingDays(
    req.data.fromDate!,
    req.data.toDate!
  );

  const halfDay = req.data.halfDay ?? null;
  const isHalfDay = halfDay !== null && workingDates.length === 1;

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const d of workingDates) {
    const res = await upsertAttendanceDay(employee, d, {
      status: 'leave',
      arrivalAt: null,
      departureAt: null,
      workedHours: 0,
      source: 'auto',
      notes: `Leave: ${req.data.leaveType}${
        isHalfDay ? ` (half-day ${halfDay})` : ''
      }`,
    });
    if (res === 'created') created++;
    else if (res === 'updated') updated++;
    else skipped++;
  }

  const fullEmployee = await Employee.findOne({
    _id: req.employee,
    isDeleted: false,
  });
  let touched = 0;

  if (fullEmployee) {
    const type = (req.data.leaveType ?? '').trim().toLowerCase();

    const groups = new Map<
      string,
      { year: number; month: number; days: number }
    >();
    for (const d of workingDates) {
      const y = d.getUTCFullYear();
      const m = d.getUTCMonth() + 1;
      const key = `${y}-${m}`;
      const g = groups.get(key) ?? { year: y, month: m, days: 0 };
      g.days += isHalfDay ? 0.5 : 1;
      groups.set(key, g);
    }

    for (const g of groups.values()) {
      const idx = fullEmployee.leaveAllocations.findIndex(
        (a) =>
          a.type.trim().toLowerCase() === type &&
          a.year === g.year &&
          a.month === g.month
      );
      if (idx !== -1) {
        const slot = fullEmployee.leaveAllocations[idx];
        slot.used = +(slot.used + g.days).toFixed(2);
        touched++;
      }
    }

    if (touched > 0) {
      fullEmployee.markModified('leaveAllocations');
      await fullEmployee.save();
    }
  }

  return {
    attendanceRowsCreated: created,
    attendanceRowsUpdated: updated,
    leaveAllocationRowsTouched: touched,
    appliedAt: new Date(),
    notes: skipped > 0 ? `${skipped} row(s) skipped (holiday/weekend)` : undefined,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: wfh  (approved)
// ══════════════════════════════════════════════════════════════════════════
async function applyWFHEffects(
  req: IEmployeeRequest
): Promise<NonNullable<IEmployeeRequest['appliedEffects']>> {
  const employee = await loadEmployeeForAttendance(req.employee);
  if (!employee) {
    return {
      attendanceRowsCreated: 0,
      attendanceRowsUpdated: 0,
      appliedAt: new Date(),
      notes: 'Employee not found',
    };
  }

  const { workingDates } = await computeWorkingDays(
    req.data.fromDate!,
    req.data.toDate!
  );

  let created = 0;
  let updated = 0;

  for (const d of workingDates) {
    const res = await upsertAttendanceDay(employee, d, {
      status: 'present',
      source: 'auto',
      notes: `WFH approved${
        req.data.reason ? `: ${req.data.reason.slice(0, 180)}` : ''
      }`,
    });
    if (res === 'created') created++;
    else if (res === 'updated') updated++;
  }

  return {
    attendanceRowsCreated: created,
    attendanceRowsUpdated: updated,
    leaveAllocationRowsTouched: 0,
    appliedAt: new Date(),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: permission  (approved)
// ══════════════════════════════════════════════════════════════════════════
async function applyPermissionEffects(
  req: IEmployeeRequest
): Promise<NonNullable<IEmployeeRequest['appliedEffects']>> {
  const employee = await loadEmployeeForAttendance(req.employee);
  if (!employee) {
    return {
      attendanceRowsCreated: 0,
      attendanceRowsUpdated: 0,
      appliedAt: new Date(),
      notes: 'Employee not found',
    };
  }

  const patch = {
    source: 'auto' as const,
    notes: `Permission ${req.data.fromTime}–${req.data.toTime} (${req.data.hours}h)`,
  };

  const res = await upsertAttendanceDay(employee, req.data.permissionDate!, patch);

  return {
    attendanceRowsCreated: res === 'created' ? 1 : 0,
    attendanceRowsUpdated: res === 'updated' ? 1 : 0,
    appliedAt: new Date(),
  };
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: loan  (approved)
// ══════════════════════════════════════════════════════════════════════════
async function applyLoanEffects(
  req: IEmployeeRequest
): Promise<NonNullable<IEmployeeRequest['appliedEffects']>> {
  const employee = await Employee.findOne({
    _id: req.employee,
    isDeleted: false,
  });
  if (!employee) {
    return {
      appliedAt: new Date(),
      notes: 'Employee not found',
    };
  }

  const amount = Number(req.data.amount ?? 0);
  const installmentsCount = Number(req.data.installments ?? 1);
  const startDate = req.data.repaymentStartDate
    ? new Date(req.data.repaymentStartDate)
    : new Date();

  if (amount <= 0 || installmentsCount <= 0) {
    return {
      appliedAt: new Date(),
      notes: 'Invalid loan amount or installments',
    };
  }

  const { buildInstallmentSchedule } = await import('./loanHelpers');
  const schedule = buildInstallmentSchedule(amount, installmentsCount, startDate);

  const LoanModel = (await import('../model/Loan')).default;

  const existing = await LoanModel.findOne({ request: req._id });
  if (existing) {
    return {
      appliedAt: new Date(),
      notes: 'Loan already exists for this request',
    };
  }

  const loan = await LoanModel.create({
    request: req._id,
    employee: employee._id,
    user: employee.user ?? null,
    employeeId: employee.employeeId,
    employeeName: employee.name,
    department: employee.department ?? '',
    principal: amount,
    currency: req.data.currency ?? 'PKR',
    installmentsCount,
    installmentAmount: schedule[0]?.amount ?? amount,
    outstandingAmount: amount,
    totalPaid: 0,
    startDate: schedule[0]?.dueDate ?? new Date(),
    approvedAt: new Date(),
    approvedBy: req.decidedBy ?? req.user ?? employee._id,
    approvedByName: req.decidedByName ?? '',
    installments: schedule,
    status: 'active',
    reason: req.data.reason,
  });

  return {
    appliedAt: new Date(),
    notes: `Loan created (${loan.installmentsCount} installments)`,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: attendance_correction  (approved)
// ══════════════════════════════════════════════════════════════════════════
async function applyAttendanceCorrectionEffects(
  req: IEmployeeRequest
): Promise<NonNullable<IEmployeeRequest['appliedEffects']>> {
  const employee = await loadEmployeeForAttendance(req.employee);
  if (!employee) {
    return {
      attendanceRowsCreated: 0,
      attendanceRowsUpdated: 0,
      appliedAt: new Date(),
      notes: 'Employee not found',
    };
  }

  const date = toMidnightUTC(req.data.correctionDate!);

  let attendance: any;
  try {
    attendance = mongoose.model('Attendance');
  } catch {
    return { attendanceRowsCreated: 0, attendanceRowsUpdated: 0, appliedAt: new Date() };
  }

  const patch: Record<string, any> = {
    status: 'present',
    source: 'manual',
    notes: req.data.correctionNote?.slice(0, 300) || 'Corrected via request',
  };

  if (req.data.claimedCheckIn) {
    const [h, m] = req.data.claimedCheckIn.split(':').map(Number);
    patch.arrivalAt = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m)
    );
  }
  if (req.data.claimedCheckOut) {
    const [h, m] = req.data.claimedCheckOut.split(':').map(Number);
    patch.departureAt = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h, m)
    );
  }

  const existing = await attendance.findOne({
    employee: req.employee,
    date,
    isDeleted: false,
  });

  if (existing) {
    if (patch.arrivalAt) existing.arrivalAt = patch.arrivalAt;
    if (patch.departureAt) existing.departureAt = patch.departureAt;
    existing.status = patch.status;
    existing.source = patch.source;
    existing.notes = patch.notes;

    if (existing.arrivalAt && existing.departureAt) {
      const diffMs =
        new Date(existing.departureAt).getTime() -
        new Date(existing.arrivalAt).getTime();
      existing.workedHours = Math.max(0, +(diffMs / (1000 * 60 * 60)).toFixed(2));
    }

    await existing.save();
    return { attendanceRowsCreated: 0, attendanceRowsUpdated: 1, appliedAt: new Date() };
  }

  const workedHours =
    patch.arrivalAt && patch.departureAt
      ? Math.max(
          0,
          +(
            (patch.departureAt.getTime() - patch.arrivalAt.getTime()) /
            (1000 * 60 * 60)
          ).toFixed(2)
        )
      : 0;

  await attendance.create({
    employee: employee._id,
    user: employee.user ?? null,
    employeeId: employee.employeeId,
    employeeName: employee.name,
    department: employee.department ?? '',
    date,
    arrivalAt: patch.arrivalAt ?? null,
    departureAt: patch.departureAt ?? null,
    workedHours,
    status: patch.status,
    source: patch.source,
    notes: patch.notes,
    isDeleted: false,
  });

  return { attendanceRowsCreated: 1, attendanceRowsUpdated: 0, appliedAt: new Date() };
}

// ══════════════════════════════════════════════════════════════════════════
// HANDLER: overtime  (approved)   ← NEW
//
// Overtime is purely a payroll input. We do NOT touch Attendance here.
// On approval we:
//   1. Ensure approvedOvertimeHours / approvedOvertimeRatePerHour /
//      approvedOvertimeAmount are populated (the controller normally does
//      this, but we defensively fill them in so payroll can rely on them).
//   2. Snapshot the employee's current overtimePerHourAmount if the
//      request had no rate at submit time.
// ══════════════════════════════════════════════════════════════════════════
async function applyOvertimeEffects(
  req: IEmployeeRequest
): Promise<NonNullable<IEmployeeRequest['appliedEffects']>> {
  const employee = await Employee.findOne({
    _id: req.employee,
    isDeleted: false,
  }).select('overtimePerHourAmount');

  if (!employee) {
    return {
      appliedAt: new Date(),
      notes: 'Employee not found',
    };
  }

  // ── Fill in any missing approved values ──────────────────────────────
  let hours = Number(
    req.data.approvedOvertimeHours ?? req.data.overtimeHours ?? 0
  );
  if (!(hours > 0)) {
    const [fh, fm] = (req.data.overtimeFromTime ?? '00:00').split(':').map(Number);
    const [th, tm] = (req.data.overtimeToTime ?? '00:00').split(':').map(Number);
    hours = (th * 60 + tm - (fh * 60 + fm)) / 60;
  }
  hours = +Math.max(0, Math.min(24, hours)).toFixed(2);

  let rate = Number(
    req.data.approvedOvertimeRatePerHour ??
      req.data.overtimeRatePerHour ??
      employee.overtimePerHourAmount ??
      0
  );
  rate = +Math.max(0, rate).toFixed(2);

  req.data.approvedOvertimeHours = hours;
  req.data.approvedOvertimeRatePerHour = rate;
  req.data.approvedOvertimeAmount = +(hours * rate).toFixed(2);

  // markModified so the save triggered by the controller persists these
  (req as any).markModified?.('data');

  return {
    appliedAt: new Date(),
    notes: `Overtime approved: ${hours}h @ ${rate}/h = ${req.data.approvedOvertimeAmount}`,
  };
}

// ══════════════════════════════════════════════════════════════════════════
// REGISTRY
// ══════════════════════════════════════════════════════════════════════════
export const REQUEST_HANDLERS: Partial<
  Record<
    RequestType,
    (req: IEmployeeRequest) => Promise<NonNullable<IEmployeeRequest['appliedEffects']>>
  >
> = {
  leave: applyLeaveEffects,
  wfh: applyWFHEffects,
  permission: applyPermissionEffects,
  attendance_correction: applyAttendanceCorrectionEffects,
  loan: applyLoanEffects,
  overtime: applyOvertimeEffects,   // ← NEW
};

export async function runHandlerForApproval(
  req: IEmployeeRequest
): Promise<NonNullable<IEmployeeRequest['appliedEffects']> | null> {
  const handler = REQUEST_HANDLERS[req.type];
  if (!handler) return null;
  return handler(req);
}