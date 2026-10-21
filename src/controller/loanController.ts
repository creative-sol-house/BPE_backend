// controller/loanController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Loan from '../model/Loan';
import Employee from '../model/employee';
import { AuthRequest } from '../middleware/auth';
import {
  computeProgress,
  markInstallmentPaid,
  unmarkInstallmentPaid,
  totalOutstandingFor,
  installmentsDueInMonth,
} from '../services/loanHelpers';

function bad(res: Response, msg: string, code = 400): void {
  res.status(code).json({ success: false, message: msg });
}

// ══════════════════════════════════════════════════════════════════════════
// LIST  — GET /api/loans
// Scope: mine | all (all requires loans:edit)
// Filters: status, employeeId, search, from, to
// ══════════════════════════════════════════════════════════════════════════
export async function listLoans(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      scope = 'mine',
      status,
      employeeId,
      search,
      from,
      to,
      page = '1',
      limit = '20',
    } = req.query;

    const filter: any = { isDeleted: false };

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim());
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }

const canManage =
  req.user!.isMainAdmin || (await req.user!.can('loans', 'view'));      

    if (scope === 'all') {
      if (!canManage) {
        bad(res, 'You cannot view all loans', 403);
        return;
      }
      if (employeeId) filter.employee = employeeId;
    } else {
      const own = req.user!.isEmployee
        ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
        : null;
      if (!own) {
        res.json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 0, total: 0, pages: 0 },
        });
        return;
      }
      filter.employee = own._id;
    }

    if (search) {
      const s = String(search).trim();
      if (s) {
        const rx = {
          $regex: s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          $options: 'i',
        };
        filter.$or = [
          { employeeName: rx },
          { employeeId: rx },
          { reason: rx },
        ];
      }
    }

    if (from || to) {
      filter.approvedAt = {};
      if (from) {
        const f = new Date(String(from));
        f.setUTCHours(0, 0, 0, 0);
        filter.approvedAt.$gte = f;
      }
      if (to) {
        const t = new Date(String(to));
        t.setUTCHours(23, 59, 59, 999);
        filter.approvedAt.$lte = t;
      }
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      Loan.find(filter)
        .populate('employee', 'name employeeId designation department profileImage')
        .populate('request', 'subject data.fromDate data.toDate')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Loan.countDocuments(filter),
    ]);

    const decorated = rows.map((l) => ({
      ...l.toObject(),
      progress: computeProgress(l),
    }));

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
    console.error('listLoans error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// GET ONE  — GET /api/loans/:loanId
// ══════════════════════════════════════════════════════════════════════════
export async function getLoan(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { loanId } = req.params;
    const loan = await Loan.findOne({ _id: loanId, isDeleted: false })
      .populate('employee', 'name employeeId designation department profileImage')
      .populate('request', 'subject data status decidedByName decidedAt');

    if (!loan) {
      bad(res, 'Loan not found', 404);
      return;
    }

    const own = req.user!.isEmployee
      ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
      : null;
    const isOwner = own && String(own._id) === String(loan.employee?._id ?? loan.employee);
    const canManage =
      req.user!.isMainAdmin || (await req.user!.can('loans', 'view'));

    if (!isOwner && !canManage) {
      bad(res, 'You cannot view this loan', 403);
      return;
    }

    res.json({
      success: true,
      data: { ...loan.toObject(), progress: computeProgress(loan) },
    });
  } catch (err: any) {
    console.error('getLoan error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EMPLOYEE SUMMARY  — GET /api/loans/employee/:employeeId/summary
// Returns outstanding totals + active loan list for payroll.
// ══════════════════════════════════════════════════════════════════════════
export async function getEmployeeLoanSummary(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { employeeId } = req.params;

    const idStr = String(employeeId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { employeeId: idStr, isDeleted: false };
    const employee = await Employee.findOne(query).select(
      'name employeeId department'
    );
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const [outstanding, activeLoans] = await Promise.all([
      totalOutstandingFor(employee._id),
      Loan.find({
        employee: employee._id,
        status: 'active',
        isDeleted: false,
      }).sort({ createdAt: -1 }),
    ]);

    // Optional: installments due in a specific month (for payroll preview)
    const { year, month } = req.query;
    let dueThisMonth: any[] = [];
    if (year && month) {
      const y = Number(year);
      const m = Number(month);
      if (Number.isInteger(y) && Number.isInteger(m) && m >= 1 && m <= 12) {
        dueThisMonth = await installmentsDueInMonth(employee._id, y, m);
      }
    }

    res.json({
      success: true,
      data: {
        employee: {
          _id: employee._id,
          name: employee.name,
          employeeId: employee.employeeId,
          department: employee.department,
        },
        totalOutstanding: +outstanding.toFixed(2),
        activeLoanCount: activeLoans.length,
        activeLoans: activeLoans.map((l) => ({
          ...l.toObject(),
          progress: computeProgress(l),
        })),
        dueThisMonth: dueThisMonth.map((d) => ({
          loanId: d.loanId,
          seq: d.installment.seq,
          dueDate: d.installment.dueDate,
          amount: d.installment.amount,
          status: d.installment.status,
        })),
      },
    });
  } catch (err: any) {
    console.error('getEmployeeLoanSummary error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// CANCEL  — POST /api/loans/:loanId/cancel
// Only allowed while NO installment has been paid yet.
// ══════════════════════════════════════════════════════════════════════════
export async function cancelLoan(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { loanId } = req.params;
    const { reason } = req.body;

    const loan = await Loan.findOne({ _id: loanId, isDeleted: false });
    if (!loan) {
      bad(res, 'Loan not found', 404);
      return;
    }

    if (loan.status !== 'active') {
      bad(res, `Cannot cancel a ${loan.status} loan`);
      return;
    }

    const anyPaid = loan.installments.some((i) => i.status === 'paid');
    if (anyPaid) {
      bad(res, 'Cannot cancel — at least one installment has already been paid');
      return;
    }

    loan.status = 'cancelled';
    loan.cancelledAt = new Date();
    loan.cancelledBy = req.user!._id;
    loan.cancellationReason = reason ? String(reason).trim().slice(0, 500) : undefined;
    await loan.save();

    res.json({
      success: true,
      message: 'Loan cancelled',
      data: { ...loan.toObject(), progress: computeProgress(loan) },
    });
  } catch (err: any) {
    console.error('cancelLoan error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// MARK INSTALLMENT PAID  — POST /api/loans/:loanId/installments/:seq/pay
// Called by payroll (or HR directly for manual adjustments).
// ══════════════════════════════════════════════════════════════════════════
export async function payInstallment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { loanId, seq } = req.params;
    const { paidAmount, paidAt, payrollId, notes } = req.body;

    const seqNum = Number(seq);
    if (!Number.isInteger(seqNum) || seqNum < 1) {
      bad(res, 'Invalid installment sequence');
      return;
    }

    const loan = await Loan.findOne({ _id: loanId, isDeleted: false });
    if (!loan) {
      bad(res, 'Loan not found', 404);
      return;
    }
    if (loan.status !== 'active') {
      bad(res, `Cannot pay an installment on a ${loan.status} loan`);
      return;
    }

    const inst = loan.installments.find((i) => i.seq === seqNum);
    if (!inst) {
      bad(res, `Installment #${seqNum} not found on this loan`);
      return;
    }
    if (inst.status === 'paid') {
      bad(res, `Installment #${seqNum} is already marked as paid`);
      return;
    }

    const updated = await markInstallmentPaid(loan._id, seqNum, {
      paidAmount: paidAmount !== undefined ? Number(paidAmount) : undefined,
      paidAt: paidAt ? new Date(paidAt) : undefined,
      payrollId: payrollId || null,
      notes: notes ? String(notes).trim().slice(0, 300) : undefined,
    });

    if (!updated) {
      bad(res, 'Failed to update loan', 500);
      return;
    }

    res.json({
      success: true,
      message: `Installment #${seqNum} marked as paid`,
      data: { ...updated.toObject(), progress: computeProgress(updated) },
    });
  } catch (err: any) {
    console.error('payInstallment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// UNMARK INSTALLMENT  — POST /api/loans/:loanId/installments/:seq/unpay
// Reverse a payment. Used if a payroll run is cancelled.
// ══════════════════════════════════════════════════════════════════════════
export async function unpayInstallment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { loanId, seq } = req.params;

    const seqNum = Number(seq);
    if (!Number.isInteger(seqNum) || seqNum < 1) {
      bad(res, 'Invalid installment sequence');
      return;
    }

    const loan = await Loan.findOne({ _id: loanId, isDeleted: false });
    if (!loan) {
      bad(res, 'Loan not found', 404);
      return;
    }

    const inst = loan.installments.find((i) => i.seq === seqNum);
    if (!inst) {
      bad(res, `Installment #${seqNum} not found on this loan`);
      return;
    }
    if (inst.status !== 'paid') {
      bad(res, `Installment #${seqNum} is not marked as paid`);
      return;
    }

    const updated = await unmarkInstallmentPaid(loan._id, seqNum);
    if (!updated) {
      bad(res, 'Failed to update loan', 500);
      return;
    }

    res.json({
      success: true,
      message: `Installment #${seqNum} payment reversed`,
      data: { ...updated.toObject(), progress: computeProgress(updated) },
    });
  } catch (err: any) {
    console.error('unpayInstallment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// STATS  — GET /api/loans/stats
// ══════════════════════════════════════════════════════════════════════════
export async function loanStats(req: AuthRequest, res: Response): Promise<void> {
  try {
    const canManage =
      req.user!.isMainAdmin || (await req.user!.can('loans', 'edit'));

    const baseFilter: any = { isDeleted: false };
    if (!canManage) {
      const own = req.user!.isEmployee
        ? await Employee.findOne({ user: req.user!._id, isDeleted: false }).select('_id')
        : null;
      if (!own) {
        res.json({ success: true, data: {} });
        return;
      }
      baseFilter.employee = own._id;
    }

    const [byStatus, totals, activeOutstanding] = await Promise.all([
      Loan.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Loan.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: null,
            principalSum: { $sum: '$principal' },
            outstandingSum: { $sum: '$outstandingAmount' },
            paidSum: { $sum: '$totalPaid' },
          },
        },
      ]),
      Loan.aggregate([
        { $match: { ...baseFilter, status: 'active' } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            outstanding: { $sum: '$outstandingAmount' },
          },
        },
      ]),
    ]);

    const statusMap: Record<string, number> = {};
    for (const r of byStatus) statusMap[r._id] = r.count;

    res.json({
      success: true,
      data: {
        byStatus: statusMap,
        totals: {
          principal: +(totals[0]?.principalSum ?? 0).toFixed(2),
          outstanding: +(totals[0]?.outstandingSum ?? 0).toFixed(2),
          paid: +(totals[0]?.paidSum ?? 0).toFixed(2),
        },
        active: {
          count: activeOutstanding[0]?.count ?? 0,
          outstanding: +(activeOutstanding[0]?.outstanding ?? 0).toFixed(2),
        },
      },
    });
  } catch (err: any) {
    console.error('loanStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}