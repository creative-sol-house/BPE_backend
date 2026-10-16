// controller/requestController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import EmployeeRequest, {
  REQUEST_TYPES,
  type RequestType,
} from '../model/EmployeeRequest';
import Employee from '../model/employee';
import { AuthRequest } from '../middleware/auth';
import {
  computeWorkingDays,
  checkLeaveFits,
  computeBalancePreview,
} from '../services/requestHelpers';

// ══════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════
function bad(res: Response, msg: string, code = 400): void {
  res.status(code).json({ success: false, message: msg });
}

function requireType(t: any): t is RequestType {
  return typeof t === 'string' && (REQUEST_TYPES as string[]).includes(t);
}

function defaultSubject(type: RequestType): string {
  const map: Record<RequestType, string> = {
    leave: 'Leave Request',
    attendance_correction: 'Attendance Correction Request',
    salary_certificate: 'Salary Certificate Request',
    advance: 'Salary Advance Request',
    loan: 'Loan Request',
    asset: 'Asset Request',
    experience_letter: 'Experience Letter Request',
    permission: 'Permission Request',
    wfh: 'Work From Home Request',
    overtime: 'Overtime Request',                 // ← NEW
  };
  return map[type];
}

async function findEmployee(idOrCode: string) {
  const idStr = String(idOrCode);
  const query = mongoose.Types.ObjectId.isValid(idStr)
    ? { _id: idStr, isDeleted: false }
    : { employeeId: idStr, isDeleted: false };
  return Employee.findOne(query);
}

async function decorateWithLoanPreview(doc: any): Promise<any> {
  try {
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    if (obj.type !== 'loan') return obj;

    const d = obj.data || {};
    const amount = Number(d.amount ?? 0);
    const installments = Number(d.installments ?? 1);

    const employeeRef =
      obj.employee && typeof obj.employee === 'object'
        ? obj.employee._id
        : obj.employee;
    if (!employeeRef) return obj;

    const LoanModel = (await import('../model/Loan')).default;

    const [currentOutstanding, activeLoanCount] = await Promise.all([
      LoanModel.outstandingFor(employeeRef),
      LoanModel.countDocuments({
        employee: employeeRef,
        status: 'active',
        isDeleted: false,
      }),
    ]);

    const preview = {
      currentOutstanding: +currentOutstanding.toFixed(2),
      activeLoanCount,
      thisRequest: { amount, installments },
      projectedTotalOutstanding: +(currentOutstanding + amount).toFixed(2),
      projectedActiveCount: activeLoanCount + 1,
    };

    return { ...obj, loanPreview: preview };
  } catch {
    return typeof doc.toObject === 'function' ? doc.toObject() : doc;
  }
}

async function decorateWithBalancePreview(doc: any): Promise<any> {
  try {
    const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
    if (obj.type !== 'leave') return obj;

    const d = obj.data || {};
    if (!d.fromDate || !d.toDate || !d.leaveType) return obj;

    const employeeRef =
      obj.employee && typeof obj.employee === 'object'
        ? obj.employee._id
        : obj.employee;
    if (!employeeRef) return obj;

    const wd = await computeWorkingDays(
      new Date(d.fromDate),
      new Date(d.toDate)
    );
    const dates = d.halfDay ? [wd.workingDates[0]] : wd.workingDates;

    const preview = await computeBalancePreview(
      employeeRef,
      String(d.leaveType).trim(),
      dates,
      obj._id
    );

    return { ...obj, balancePreview: preview };
  } catch (e) {
    return typeof doc.toObject === 'function' ? doc.toObject() : doc;
  }
}

async function decorateRequest(doc: any): Promise<any> {
  const withBalance = await decorateWithBalancePreview(doc);
  return decorateWithLoanPreview(withBalance);
}

// ══════════════════════════════════════════════════════════════════════════
// SUBMIT  — POST /api/requests
// ══════════════════════════════════════════════════════════════════════════
export async function submitRequest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { type, subject, data, forEmployeeId } = req.body;

    if (!requireType(type)) {
      bad(res, `Invalid type. Allowed: ${REQUEST_TYPES.join(', ')}`);
      return;
    }
    if (!data || typeof data !== 'object') {
      bad(res, 'data is required');
      return;
    }

    let employee: any = null;
    let source: 'self' | 'on_behalf' = 'self';

    if (forEmployeeId) {
      const canOnBehalf = await req.user!.can('requests', 'edit');
      if (!canOnBehalf && !req.user!.isMainAdmin) {
        bad(res, 'You cannot submit requests on behalf of others', 403);
        return;
      }
      employee = await findEmployee(String(forEmployeeId));
      if (!employee) {
        bad(res, 'Target employee not found', 404);
        return;
      }
      source = 'on_behalf';
    } else {
      if (!req.user!.isEmployee) {
        bad(res, 'You do not have an employee record', 403);
        return;
      }
      employee = await Employee.findOne({ user: req.user!._id, isDeleted: false });
      if (!employee) {
        bad(res, 'Employee record not found', 404);
        return;
      }
    }

    const normalized: any = { ...data };
    let warning: string | undefined;

    if (type === 'leave' || type === 'wfh') {
      if (!normalized.fromDate || !normalized.toDate) {
        bad(res, `${type}: fromDate and toDate are required`);
        return;
      }
      normalized.fromDate = new Date(normalized.fromDate);
      normalized.toDate = new Date(normalized.toDate);

      if (normalized.fromDate > normalized.toDate) {
        bad(res, `${type}: fromDate cannot be after toDate`);
        return;
      }

      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      if (source === 'self' && normalized.fromDate < today) {
        bad(res, 'Backdated requests are not allowed for self-submission');
        return;
      }

      const overlap = await EmployeeRequest.hasOverlap(
        employee._id,
        type,
        normalized.fromDate,
        normalized.toDate
      );
      if (overlap) {
        bad(
          res,
          `You already have a pending or approved ${type} request overlapping this range`
        );
        return;
      }

      const wd = await computeWorkingDays(normalized.fromDate, normalized.toDate);
      if (wd.workingDays === 0) {
        bad(res, 'Selected range contains no working days');
        return;
      }
      normalized.days = wd.workingDays;

      if (normalized.halfDay) {
        if (wd.workingDays !== 1) {
          bad(res, 'Half-day is only allowed for a single-day leave');
          return;
        }
        normalized.days = 0.5;
      }

      if (type === 'leave') {
        if (!normalized.leaveType || !String(normalized.leaveType).trim()) {
          bad(res, 'leave: leaveType is required');
          return;
        }
        const dates = normalized.halfDay ? [wd.workingDates[0]] : wd.workingDates;
        const check = await checkLeaveFits(
          employee._id,
          String(normalized.leaveType).trim(),
          dates
        );
        if (!check.ok) {
          const detail = check.deficits
            .map(
              (d) =>
                `${d.year}-${String(d.month).padStart(2, '0')} needs ${d.needed}, ${d.remaining} available`
            )
            .join('; ');
          warning = `Requested days exceed available balance (${detail}). Approval is at HR's discretion.`;
        }
      }
    }

    if (type === 'permission') {
      if (!normalized.permissionDate || !normalized.fromTime || !normalized.toTime) {
        bad(res, 'permission: permissionDate, fromTime, toTime are required');
        return;
      }
      const [fh, fm] = normalized.fromTime.split(':').map(Number);
      const [th, tm] = normalized.toTime.split(':').map(Number);
      const hours = (th * 60 + tm - (fh * 60 + fm)) / 60;
      if (hours <= 0) {
        bad(res, 'permission: toTime must be after fromTime');
        return;
      }
      normalized.hours = +hours.toFixed(2);
    }

    // ── OVERTIME (NEW) ────────────────────────────────────────────────────
    if (type === 'overtime') {
      if (!normalized.overtimeDate || !normalized.overtimeFromTime || !normalized.overtimeToTime) {
        bad(res, 'overtime: overtimeDate, overtimeFromTime, overtimeToTime are required');
        return;
      }

      normalized.overtimeDate = new Date(normalized.overtimeDate);
      if (Number.isNaN(normalized.overtimeDate.getTime())) {
        bad(res, 'overtime: invalid overtimeDate');
        return;
      }

      const [fh, fm] = normalized.overtimeFromTime.split(':').map(Number);
      const [th, tm] = normalized.overtimeToTime.split(':').map(Number);
      const hours = (th * 60 + tm - (fh * 60 + fm)) / 60;
      if (hours <= 0) {
        bad(res, 'overtime: overtimeToTime must be after overtimeFromTime');
        return;
      }
      if (hours > 24) {
        bad(res, 'overtime: duration cannot exceed 24 hours');
        return;
      }
      normalized.overtimeHours = +hours.toFixed(2);

      // Snapshot the employee's configured rate
      const rate = Number(employee.overtimePerHourAmount ?? 0);
      normalized.overtimeRatePerHour = +rate.toFixed(2);
      normalized.overtimeAmount = +(normalized.overtimeHours * rate).toFixed(2);

      if (rate <= 0) {
        warning = 'Your overtime-per-hour rate is not set on your employee record. HR will fix it on approval.';
      }

      // Prevent duplicate same-day overtime requests (pending or approved)
      const dayStart = new Date(normalized.overtimeDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const dayEnd = new Date(normalized.overtimeDate);
      dayEnd.setUTCHours(23, 59, 59, 999);

      const dup = await EmployeeRequest.findOne({
        employee: employee._id,
        type: 'overtime',
        status: { $in: ['pending', 'approved'] },
        isDeleted: false,
        'data.overtimeDate': { $gte: dayStart, $lte: dayEnd },
      })
        .select('_id')
        .lean();

      if (dup) {
        bad(res, 'You already have a pending or approved overtime request for this day');
        return;
      }
    }

    if (type === 'attendance_correction') {
      if (!normalized.correctionDate) {
        bad(res, 'attendance_correction: correctionDate is required');
        return;
      }
      if (!normalized.claimedCheckIn && !normalized.claimedCheckOut) {
        bad(
          res,
          'attendance_correction: provide at least one of claimedCheckIn / claimedCheckOut'
        );
        return;
      }
    }

    if (type === 'loan') {
      const amt = Number(normalized.amount ?? 0);
      if (!amt || amt <= 0) {
        bad(res, 'loan: amount must be greater than 0');
        return;
      }
      const insts = Number(normalized.installments ?? 0);
      if (!insts || insts < 1 || insts > 120) {
        bad(res, 'loan: installments must be between 1 and 120');
        return;
      }
      normalized.amount = amt;
      normalized.installments = insts;
    }

    const doc = new EmployeeRequest({
      employee: employee._id,
      user: employee.user ?? null,
      type,
      status: 'pending',
      source,
      subject: subject ? String(subject).trim() : defaultSubject(type),
      data: normalized,
    });

    await doc.save();

    const decorated = await decorateRequest(doc);

    res.status(201).json({
      success: true,
      message: warning
        ? 'Request submitted — HR will review'
        : 'Request submitted',
      warning,
      data: decorated,
    });
  } catch (err: any) {
    console.error('submitRequest error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EDIT  — PATCH /api/requests/:requestId
// ══════════════════════════════════════════════════════════════════════════
export async function editRequest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { requestId } = req.params;
    const { subject, data } = req.body;

    const doc = await EmployeeRequest.findOne({
      _id: requestId,
      isDeleted: false,
    });
    if (!doc) {
      bad(res, 'Request not found', 404);
      return;
    }
    if (doc.status !== 'pending') {
      bad(res, 'Only pending requests can be edited');
      return;
    }

    const ownEmployee = req.user!.isEmployee
      ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
      : null;
    const isSubmitter =
      ownEmployee && String(ownEmployee._id) === String(doc.employee);
    const canManage =
      req.user!.isMainAdmin || (await req.user!.can('requests', 'edit'));

    if (!isSubmitter && !canManage) {
      bad(res, 'You cannot edit this request', 403);
      return;
    }

    if (subject !== undefined) doc.subject = String(subject).trim();

    if (data !== undefined && typeof data === 'object') {
      Object.assign(doc.data, data);

      if (doc.type === 'leave' || doc.type === 'wfh') {
        if (doc.data.fromDate && doc.data.toDate) {
          const from = new Date(doc.data.fromDate);
          const to = new Date(doc.data.toDate);
          if (from > to) {
            bad(res, 'fromDate cannot be after toDate');
            return;
          }

          const overlap = await EmployeeRequest.hasOverlap(
            doc.employee,
            doc.type,
            from,
            to,
            doc._id
          );
          if (overlap) {
            bad(res, 'Overlaps another pending/approved request');
            return;
          }

          const wd = await computeWorkingDays(from, to);
          if (wd.workingDays === 0) {
            bad(res, 'No working days in range');
            return;
          }
          doc.data.days = doc.data.halfDay ? 0.5 : wd.workingDays;
        }
      }

      if (doc.type === 'loan') {
        const amt = Number(doc.data.amount ?? 0);
        if (!amt || amt <= 0) {
          bad(res, 'loan: amount must be greater than 0');
          return;
        }
        const insts = Number(doc.data.installments ?? 0);
        if (!insts || insts < 1 || insts > 120) {
          bad(res, 'loan: installments must be between 1 and 120');
          return;
        }
      }

      // ── OVERTIME (NEW) ────────────────────────────────────────────────
      if (doc.type === 'overtime') {
        if (doc.data.overtimeFromTime && doc.data.overtimeToTime) {
          const [fh, fm] = doc.data.overtimeFromTime.split(':').map(Number);
          const [th, tm] = doc.data.overtimeToTime.split(':').map(Number);
          const hours = (th * 60 + tm - (fh * 60 + fm)) / 60;
          if (hours <= 0 || hours > 24) {
            bad(res, 'overtime: invalid time range');
            return;
          }
          doc.data.overtimeHours = +hours.toFixed(2);

          // Re-snapshot rate/amount from employee record
          const emp = await Employee.findById(doc.employee).select('overtimePerHourAmount');
          if (emp) {
            const rate = Number(emp.overtimePerHourAmount ?? 0);
            doc.data.overtimeRatePerHour = +rate.toFixed(2);
            doc.data.overtimeAmount = +(doc.data.overtimeHours * rate).toFixed(2);
          }
        }
      }

      doc.markModified('data');
    }

    await doc.save();

    const decorated = await decorateRequest(doc);

    res.json({ success: true, message: 'Request updated', data: decorated });
  } catch (err: any) {
    console.error('editRequest error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CANCEL  — POST /api/requests/:requestId/cancel
// ══════════════════════════════════════════════════════════════════════════
export async function cancelRequest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { requestId } = req.params;

    const doc = await EmployeeRequest.findOne({
      _id: requestId,
      isDeleted: false,
    });
    if (!doc) {
      bad(res, 'Request not found', 404);
      return;
    }
    if (doc.status !== 'pending') {
      bad(res, 'Only pending requests can be cancelled');
      return;
    }

    const ownEmployee = req.user!.isEmployee
      ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
      : null;
    const isSubmitter =
      ownEmployee && String(ownEmployee._id) === String(doc.employee);
    const canManage =
      req.user!.isMainAdmin || (await req.user!.can('requests', 'edit'));

    if (!isSubmitter && !canManage) {
      bad(res, 'You cannot cancel this request', 403);
      return;
    }

    doc.status = 'cancelled';
    doc.cancelledBy = req.user!._id;
    doc.cancelledAt = new Date();
    await doc.save();

    res.json({ success: true, message: 'Request cancelled', data: doc });
  } catch (err: any) {
    console.error('cancelRequest error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// APPROVE  — POST /api/requests/:requestId/approve
//
// For overtime requests the approver may pass:
//   approvedOvertimeHours         (number)  — override hours
//   approvedOvertimeRatePerHour   (number)  — override rate
//   approvedOvertimeFromTime      (string)  — override start time
//   approvedOvertimeToTime        (string)  — override end time
//   note                          (string)  — decision note
// ══════════════════════════════════════════════════════════════════════════
export async function approveRequest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { requestId } = req.params;
    const {
      note,
      approvedOvertimeHours,
      approvedOvertimeRatePerHour,
      approvedOvertimeFromTime,
      approvedOvertimeToTime,
    } = req.body;

    const doc = await EmployeeRequest.findOne({
      _id: requestId,
      isDeleted: false,
    });
    if (!doc) {
      bad(res, 'Request not found', 404);
      return;
    }
    if (doc.status !== 'pending') {
      bad(res, `Cannot approve a ${doc.status} request`);
      return;
    }

    // ── OVERTIME: apply approver overrides before running handler ──────
    if (doc.type === 'overtime') {
      // timing override
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

      // recompute hours from (possibly overridden) times unless explicitly given
      let hours: number;
      if (
        approvedOvertimeHours !== undefined &&
        approvedOvertimeHours !== null &&
        !Number.isNaN(Number(approvedOvertimeHours))
      ) {
        hours = Number(approvedOvertimeHours);
      } else {
        const [fh, fm] = (doc.data.overtimeFromTime ?? '00:00').split(':').map(Number);
        const [th, tm] = (doc.data.overtimeToTime ?? '00:00').split(':').map(Number);
        hours = (th * 60 + tm - (fh * 60 + fm)) / 60;
      }

      if (!(hours > 0) || hours > 24) {
        bad(res, 'overtime: approved hours must be between 0 and 24');
        return;
      }
      doc.data.approvedOvertimeHours = +hours.toFixed(2);

      // rate override → else keep submitted snapshot → else pull from employee
      let rate: number;
      if (
        approvedOvertimeRatePerHour !== undefined &&
        approvedOvertimeRatePerHour !== null &&
        !Number.isNaN(Number(approvedOvertimeRatePerHour))
      ) {
        rate = Number(approvedOvertimeRatePerHour);
      } else if (doc.data.overtimeRatePerHour && doc.data.overtimeRatePerHour > 0) {
        rate = Number(doc.data.overtimeRatePerHour);
      } else {
        const emp = await Employee.findById(doc.employee).select('overtimePerHourAmount');
        rate = Number(emp?.overtimePerHourAmount ?? 0);
      }

      if (rate < 0) {
        bad(res, 'overtime: rate cannot be negative');
        return;
      }
      doc.data.approvedOvertimeRatePerHour = +rate.toFixed(2);
      doc.data.approvedOvertimeAmount = +(
        doc.data.approvedOvertimeHours * rate
      ).toFixed(2);

      doc.markModified('data');
    }

    const { runHandlerForApproval } = await import('../services/requestHandlers');

    let effects: any = null;
    try {
      effects = await runHandlerForApproval(doc);
    } catch (e: any) {
      console.error('approveRequest: handler failed', e);
      res.status(500).json({
        success: false,
        message: `Failed to apply request effects: ${e.message}`,
      });
      return;
    }

    doc.status = 'approved';
    doc.decidedBy = req.user!._id;
    doc.decidedByName = req.user!.name ?? '';
    doc.decidedAt = new Date();
    doc.decisionNote = note ? String(note).trim() : '';
    if (effects) doc.appliedEffects = effects;

    await doc.save();

    const decorated = await decorateRequest(doc);

    res.json({ success: true, message: 'Request approved', data: decorated });
  } catch (err: any) {
    console.error('approveRequest error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// REJECT  — POST /api/requests/:requestId/reject
// ══════════════════════════════════════════════════════════════════════════
export async function rejectRequest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { requestId } = req.params;
    const { note } = req.body;

    const doc = await EmployeeRequest.findOne({
      _id: requestId,
      isDeleted: false,
    });
    if (!doc) {
      bad(res, 'Request not found', 404);
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

    res.json({ success: true, message: 'Request rejected', data: doc });
  } catch (err: any) {
    console.error('rejectRequest error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// LIST  — GET /api/requests
// ══════════════════════════════════════════════════════════════════════════
export async function listRequests(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      type,
      status,
      employeeId,
      scope = 'mine',
      search,
      from,
      to,
      page = '1',
      limit = '20',
    } = req.query;

    const filter: any = { isDeleted: false };

    if (type && (REQUEST_TYPES as string[]).includes(String(type))) {
      filter.type = type;
    }
    if (status) {
      filter.status = { $in: String(status).split(',').map((s) => s.trim()) };
    }

    const canManage =
      req.user!.isMainAdmin || (await req.user!.can('requests', 'edit'));

    if (scope === 'all') {
      if (!canManage) {
        bad(res, 'You cannot view all requests', 403);
        return;
      }
      if (employeeId) filter.employee = employeeId;
    } else {
      const ownEmployee = req.user!.isEmployee
        ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
        : null;
      if (!ownEmployee) {
        res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 0, total: 0, pages: 0 },
        });
        return;
      }
      filter.employee = ownEmployee._id;
    }

    if (search) {
      const s = String(search).trim();
      if (s) {
        const rx = {
          $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          $options: 'i',
        };
        const matchedEmployees = await Employee.find({
          isDeleted: false,
          $or: [{ name: rx }, { employeeId: rx }],
        })
          .select('_id')
          .lean();
        const empIds = matchedEmployees.map((e) => e._id);

        const orClauses: any[] = [{ subject: rx }];
        if (empIds.length) orClauses.push({ employee: { $in: empIds } });

        if (filter.$or) {
          filter.$and = [{ $or: filter.$or }, { $or: orClauses }];
          delete filter.$or;
        } else {
          filter.$or = orClauses;
        }
      }
    }

    if (from || to) {
      filter.createdAt = {};
      if (from) {
        const f = new Date(String(from));
        f.setUTCHours(0, 0, 0, 0);
        filter.createdAt.$gte = f;
      }
      if (to) {
        const t = new Date(String(to));
        t.setUTCHours(23, 59, 59, 999);
        filter.createdAt.$lte = t;
      }
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      EmployeeRequest.find(filter)
        .populate('employee', 'name employeeId designation department profileImage')
        .populate('decidedBy', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      EmployeeRequest.countDocuments(filter),
    ]);

    const decorated = await Promise.all(
      rows.map(async (r: any) => {
        const withBalance = await decorateWithBalancePreview(r);
        return decorateWithLoanPreview(withBalance);
      })
    );

    res.json({
      success: true,
      data: decorated,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listRequests error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// GET ONE  — GET /api/requests/:requestId
// ══════════════════════════════════════════════════════════════════════════
export async function getRequest(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { requestId } = req.params;
    const doc = await EmployeeRequest.findOne({ _id: requestId, isDeleted: false })
      .populate('employee', 'name employeeId designation department profileImage email')
      .populate('decidedBy', 'name');

    if (!doc) {
      bad(res, 'Request not found', 404);
      return;
    }

    const ownEmployee = req.user!.isEmployee
      ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
      : null;
    const isSubmitter =
      ownEmployee && String(ownEmployee._id) === String(doc.employee?._id ?? doc.employee);
    const canManage =
      req.user!.isMainAdmin || (await req.user!.can('requests', 'edit'));

    if (!isSubmitter && !canManage) {
      bad(res, 'You cannot view this request', 403);
      return;
    }

    const decorated = await decorateRequest(doc);

    res.json({ success: true, data: decorated });
  } catch (err: any) {
    console.error('getRequest error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ADD COMMENT  — POST /api/requests/:requestId/comments
// ══════════════════════════════════════════════════════════════════════════
export async function addComment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { requestId } = req.params;
    const { message } = req.body;

    if (!message || !String(message).trim()) {
      bad(res, 'message is required');
      return;
    }

    const doc = await EmployeeRequest.findOne({ _id: requestId, isDeleted: false });
    if (!doc) {
      bad(res, 'Request not found', 404);
      return;
    }

    const ownEmployee = req.user!.isEmployee
      ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
      : null;
    const isSubmitter =
      ownEmployee && String(ownEmployee._id) === String(doc.employee);
    const canManage =
      req.user!.isMainAdmin || (await req.user!.can('requests', 'edit'));

    if (!isSubmitter && !canManage) {
      bad(res, 'You cannot comment on this request', 403);
      return;
    }

    doc.comments.push({
      author: req.user!._id,
      authorName: req.user!.name ?? 'Unknown',
      message: String(message).trim().slice(0, 1000),
      createdAt: new Date(),
    });
    await doc.save();

    res.json({ success: true, data: doc });
  } catch (err: any) {
    console.error('addComment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// STATS  — GET /api/requests/stats
// ══════════════════════════════════════════════════════════════════════════
export async function requestStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const canManage =
      req.user!.isMainAdmin || (await req.user!.can('requests', 'edit'));

    const baseFilter: any = { isDeleted: false };
    if (!canManage) {
      const ownEmployee = req.user!.isEmployee
        ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
        : null;
      if (!ownEmployee) {
        res.json({ success: true, data: {} });
        return;
      }
      baseFilter.employee = ownEmployee._id;
    }

    const [byStatus, byType, pendingTotal] = await Promise.all([
      EmployeeRequest.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      EmployeeRequest.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$type', count: { $sum: 1 } } },
      ]),
      EmployeeRequest.countDocuments({ ...baseFilter, status: 'pending' }),
    ]);

    const statusMap: Record<string, number> = {};
    for (const r of byStatus) statusMap[r._id] = r.count;

    const typeMap: Record<string, number> = {};
    for (const r of byType) typeMap[r._id] = r.count;

    res.json({
      success: true,
      data: { pendingTotal, byStatus: statusMap, byType: typeMap },
    });
  } catch (err: any) {
    console.error('requestStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}