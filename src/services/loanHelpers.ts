// service/loanHelpers.ts
import { Types } from 'mongoose';
import Loan, {
  type ILoan,
  type ILoanInstallment,
} from '../model/Loan';

// ══════════════════════════════════════════════════════════════════════════
// SCHEDULE GENERATION
// ══════════════════════════════════════════════════════════════════════════

/**
 * Build a uniform installment schedule.
 * `startDate` is normalized to the 1st of its month (UTC).
 */
export function buildInstallmentSchedule(
  principal: number,
  installmentsCount: number,
  startDate: Date
): ILoanInstallment[] {
  const count = Math.max(1, Math.floor(installmentsCount));
  const perInstallment = +(principal / count).toFixed(2);

  // Adjust the last installment so the sum exactly equals principal.
  const schedule: ILoanInstallment[] = [];
  let allocated = 0;

  const startMonth = new Date(
    Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1)
  );

  for (let i = 0; i < count; i++) {
    const dueDate = new Date(
      Date.UTC(startMonth.getUTCFullYear(), startMonth.getUTCMonth() + i, 1)
    );

    const isLast = i === count - 1;
    const amount = isLast
      ? +(principal - allocated).toFixed(2)
      : perInstallment;
    allocated += amount;

    schedule.push({
      seq: i + 1,
      dueDate,
      amount,
      status: 'pending',
      paidAt: null,
      paidAmount: undefined,
      payrollId: null,
    });
  }

  return schedule;
}

// ══════════════════════════════════════════════════════════════════════════
// PROGRESS / AGGREGATES
// ══════════════════════════════════════════════════════════════════════════

export interface LoanProgress {
  paid: number;
  pending: number;
  skipped: number;
  total: number;
  percentPaid: number;
  totalPaid: number;
  outstanding: number;
}

export function computeProgress(loan: ILoan): LoanProgress {
  const installments = loan.installments ?? [];
  let paid = 0;
  let pending = 0;
  let skipped = 0;
  let totalPaid = 0;

  for (const inst of installments) {
    if (inst.status === 'paid') {
      paid++;
      totalPaid += inst.paidAmount ?? inst.amount;
    } else if (inst.status === 'skipped') {
      skipped++;
    } else {
      pending++;
    }
  }

  const total = installments.length;
  return {
    paid,
    pending,
    skipped,
    total,
    percentPaid: total === 0 ? 0 : +((paid / total) * 100).toFixed(2),
    totalPaid: +totalPaid.toFixed(2),
    outstanding: +Math.max(0, loan.principal - totalPaid).toFixed(2),
  };
}

/**
 * Sum the outstanding amount across every active loan for an employee.
 * Used by the payroll module to know how much to deduct this month.
 */
export async function totalOutstandingFor(
  employeeId: Types.ObjectId
): Promise<number> {
  return Loan.outstandingFor(employeeId);
}

/**
 * Return the installments due in a given (year, month) across all active
 * loans for one employee. Payroll uses this to know what to deduct.
 */
export async function installmentsDueInMonth(
  employeeId: Types.ObjectId,
  year: number,
  month: number
): Promise<Array<{ loanId: Types.ObjectId; installment: ILoanInstallment }>> {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

  const loans = await Loan.find({
    employee: employeeId,
    status: 'active',
    isDeleted: false,
  }).lean();

  const out: Array<{ loanId: Types.ObjectId; installment: ILoanInstallment }> = [];
  for (const loan of loans) {
    for (const inst of loan.installments ?? []) {
      if (
        inst.status === 'pending' &&
        new Date(inst.dueDate) >= monthStart &&
        new Date(inst.dueDate) <= monthEnd
      ) {
        out.push({
          loanId: loan._id,
          installment: inst as ILoanInstallment,
        });
      }
    }
  }
  return out;
}

/**
 * Mark one installment as paid. Called by payroll (or HR directly).
 * Recomputes the loan totals and auto-settles if everything is paid.
 */
export async function markInstallmentPaid(
  loanId: Types.ObjectId,
  seq: number,
  opts: {
    paidAmount?: number;
    paidAt?: Date;
    payrollId?: Types.ObjectId | null;
    notes?: string;
  } = {}
): Promise<ILoan | null> {
  const loan = await Loan.findById(loanId);
  if (!loan) return null;

  const inst = loan.installments.find((i) => i.seq === seq);
  if (!inst) return loan;

  inst.status = 'paid';
  inst.paidAt = opts.paidAt ?? new Date();
  inst.paidAmount = opts.paidAmount ?? inst.amount;
  if (opts.payrollId !== undefined) inst.payrollId = opts.payrollId;
  if (opts.notes) inst.notes = opts.notes;

  loan.markModified('installments');
  await loan.save();

  return Loan.recomputeTotals(loan._id);
}

/**
 * Roll back a paid installment (e.g. payroll was cancelled).
 */
export async function unmarkInstallmentPaid(
  loanId: Types.ObjectId,
  seq: number
): Promise<ILoan | null> {
  const loan = await Loan.findById(loanId);
  if (!loan) return null;

  const inst = loan.installments.find((i) => i.seq === seq);
  if (!inst) return loan;

  inst.status = 'pending';
  inst.paidAt = null;
  inst.paidAmount = undefined;
  inst.payrollId = null;

  loan.markModified('installments');
  await loan.save();

  return Loan.recomputeTotals(loan._id);
}