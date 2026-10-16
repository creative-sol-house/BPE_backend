// controller/leaveController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Employee from '../model/employee';
import EmployeeRequest from '../model/EmployeeRequest';
import { AuthRequest } from '../middleware/auth';
import {
  computeWorkingDays,
  getLeaveBalance,
  groupWorkingDatesByMonth,
  toMidnightUTC,
} from '../services/requestHelpers';

function bad(res: Response, msg: string, code = 400): void {
  res.status(code).json({ success: false, message: msg });
}

// ══════════════════════════════════════════════════════════════════════════
// DIRECT ASSIGN  — POST /api/leaves/assign
// ══════════════════════════════════════════════════════════════════════════
export async function assignLeaveDirectly(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { employeeId, leaveType, fromDate, toDate, halfDay = null, reason } = req.body;

    if (!employeeId) {
      bad(res, 'employeeId is required');
      return;
    }
    if (!leaveType || !String(leaveType).trim()) {
      bad(res, 'leaveType is required');
      return;
    }
    if (!fromDate || !toDate) {
      bad(res, 'fromDate and toDate are required');
      return;
    }

    const idStr = String(employeeId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };
    const employee = await Employee.findOne(query);
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (from > to) {
      bad(res, 'fromDate cannot be after toDate');
      return;
    }

    const wd = await computeWorkingDays(from, to);
    if (wd.workingDays === 0) {
      bad(res, 'Range contains no working days');
      return;
    }

    const isHalf = halfDay != null;
    if (isHalf && wd.workingDays !== 1) {
      bad(res, 'Half-day requires a single working day');
      return;
    }
    const effectiveDates = isHalf ? [wd.workingDates[0]] : wd.workingDates;
    const effectiveDays = isHalf ? 0.5 : wd.workingDays;

    // ── 1. Bump `used` on matching leaveAllocations rows ─────────────────
    const groups = groupWorkingDatesByMonth(effectiveDates);
    const typeKey = String(leaveType).trim().toLowerCase();
    let touched = 0;

    for (const g of groups) {
      const idx = employee.leaveAllocations.findIndex(
        (a) =>
          a.type.trim().toLowerCase() === typeKey &&
          a.year === g.year &&
          a.month === g.month
      );
      if (idx !== -1) {
        const daysToAdd = isHalf ? 0.5 : g.days;
        const slot = employee.leaveAllocations[idx];
        slot.used = +(slot.used + daysToAdd).toFixed(2);
        touched++;
      }
    }

    if (touched > 0) {
      employee.markModified('leaveAllocations');
      await employee.save();
    }

    // ── 2. Create approved EmployeeRequest (audit trail) ─────────────────
    const audit = new EmployeeRequest({
      employee: employee._id,
      user: employee.user ?? null,
      type: 'leave',
      status: 'approved',
      source: 'direct_hr',
      subject: `HR-Assigned Leave: ${leaveType}`,
      data: {
        leaveType: String(leaveType).trim(),
        fromDate: from,
        toDate: to,
        days: effectiveDays,
        halfDay,
        reason: reason ? String(reason).trim().slice(0, 1000) : undefined,
      },
      decidedBy: req.user!._id,
      decidedByName: req.user!.name ?? '',
      decidedAt: new Date(),
      decisionNote: 'Directly assigned by HR',
    });
    await audit.save();

    // ── 3. Attendance rows ────────────────────────────────────────────────
    try {
      const Attendance: any = mongoose.model('Attendance');

      let created = 0;
      let updated = 0;

      for (const d of effectiveDates) {
        const date = toMidnightUTC(d);

        const existing = await Attendance.findOne({
          employee: employee._id,
          date,
          isDeleted: false,
        });

        // Don't clobber holiday/weekend rows
        if (existing && (existing.status === 'holiday' || existing.status === 'weekend')) {
          continue;
        }

        const patch = {
          status: 'leave',
          arrivalAt: null,
          departureAt: null,
          workedHours: 0,
          source: 'auto' as const,
          notes: `Direct HR leave: ${leaveType}`,
        };

        if (existing) {
          Object.assign(existing, patch);
          await existing.save();
          updated++;
        } else {
          await Attendance.create({
            employee: employee._id,
            user: employee.user ?? null,
            employeeId: employee.employeeId,
            employeeName: employee.name,
            department: employee.department ?? '',
            date,
            isDeleted: false,
            ...patch,
          });
          created++;
        }
      }

      audit.appliedEffects = {
        attendanceRowsCreated: created,
        attendanceRowsUpdated: updated,
        leaveAllocationRowsTouched: touched,
        appliedAt: new Date(),
        notes: 'Direct HR assignment',
      };
      await audit.save();
    } catch (e) {
      console.error('assignLeaveDirectly: attendance update failed', e);
    }

    res.status(201).json({
      success: true,
      message: 'Leave assigned directly',
      data: { employee: employee._id, auditRequestId: audit._id, touched },
    });
  } catch (err: any) {
    console.error('assignLeaveDirectly error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// BALANCE  — GET /api/leaves/balance/:employeeId
// ══════════════════════════════════════════════════════════════════════════
export async function getEmployeeLeaveBalance(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { employeeId } = req.params;
    const { year, type } = req.query;

    const idStr = String(employeeId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };
    const employee = await Employee.findOne(query).select('_id');
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const result = await getLeaveBalance(employee._id, {
      year: year ? Number(year) : undefined,
      type: type ? String(type) : undefined,
    });

    res.json({ success: true, data: result });
  } catch (err: any) {
    console.error('getEmployeeLeaveBalance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MY BALANCE  — GET /api/leaves/me/balance
// ══════════════════════════════════════════════════════════════════════════
export async function getMyLeaveBalance(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user!.isEmployee) {
      bad(res, 'You do not have an employee record', 404);
      return;
    }
    const employee = await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id');
    if (!employee) {
      bad(res, 'Employee record not found', 404);
      return;
    }

    const { year, type } = req.query;
    const result = await getLeaveBalance(employee._id, {
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
// LEDGER  — GET /api/leaves/ledger/:employeeId
// ══════════════════════════════════════════════════════════════════════════
export async function getEmployeeLedger(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { employeeId } = req.params;
    const idStr = String(employeeId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };

    const employee = await Employee.findOne(query).select(
      'name employeeId department leaveAllocations leaveSchedules'
    );
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    res.json({ success: true, data: employee });
  } catch (err: any) {
    console.error('getEmployeeLedger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}