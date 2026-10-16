// controller/reportController.ts
// ═══════════════════════════════════════════════════════════════════════════
// FINANCIAL REPORTS — P&L, Balance Sheet, Cash Flow
// Uses existing JournalEntry + Account collections via aggregation.
// ═══════════════════════════════════════════════════════════════════════════

import { Response } from 'express';
import {
  Account,
  JournalEntry,
  round2,
  type AccountSubType,
} from '../model/accounting';
import { AuthRequest } from '../middleware/auth';

// ══════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════

function bad(res: Response, msg: string, code = 400): void {
  res.status(code).json({ success: false, message: msg });
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return String(v[0] ?? '');
  return String(v);
}

interface PeriodRange {
  from: Date;
  to: Date;
  fiscalYear?: number;
  fiscalPeriod?: number;
}

/**
 * Parse date range from query.
 * Priority:
 *   1. Explicit `from` + `to`
 *   2. `fiscalYear` + `fiscalPeriod` (single month)
 *   3. `fiscalYear` alone (full year)
 *   4. Defaults to current month
 */
function parsePeriodRange(query: any): PeriodRange | null {
  const { from, to, fiscalYear, fiscalPeriod, asOf } = query;

  // As-of (single date, used by Balance Sheet)
  if (asOf) {
    const d = new Date(asOf);
    if (isNaN(d.getTime())) return null;
    d.setUTCHours(23, 59, 59, 999);
    return {
      from: new Date(0), // beginning of time
      to: d,
    };
  }

  // Explicit range
  if (from || to) {
    const f = from ? new Date(from) : new Date(0);
    const t = to ? new Date(to) : new Date();
    if (isNaN(f.getTime()) || isNaN(t.getTime())) return null;
    f.setUTCHours(0, 0, 0, 0);
    t.setUTCHours(23, 59, 59, 999);
    if (f > t) return null;
    return { from: f, to: t };
  }

  // Fiscal year + period
  const fy = Number(fiscalYear);
  const fp = Number(fiscalPeriod);
  if (Number.isInteger(fy) && Number.isInteger(fp)) {
    if (fp < 1 || fp > 12) return null;
    const start = new Date(Date.UTC(fy, fp - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(fy, fp, 0, 23, 59, 59, 999));
    return { from: start, to: end, fiscalYear: fy, fiscalPeriod: fp };
  }

  // Full fiscal year
  if (Number.isInteger(fy)) {
    const start = new Date(Date.UTC(fy, 0, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(fy, 11, 31, 23, 59, 59, 999));
    return { from: start, to: end, fiscalYear: fy };
  }

  // Default: current month
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  );
  return {
    from: start,
    to: end,
    fiscalYear: now.getUTCFullYear(),
    fiscalPeriod: now.getUTCMonth() + 1,
  };
}

/**
 * Aggregate JournalEntry lines grouped by account.
 * Returns per-account debit + credit sums for the given period.
 */
async function aggregateAccountSums(
  range: { from: Date; to: Date }
): Promise<
  Map<
    string,
    {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }
  >
> {
  const result = await JournalEntry.aggregate([
    {
      $match: {
        status: 'posted',
        isDeleted: false,
        entryDate: { $gte: range.from, $lte: range.to },
      },
    },
    { $unwind: '$lines' },
    {
      $group: {
        _id: '$lines.accountId',
        accountCode: { $first: '$lines.accountCode' },
        accountName: { $first: '$lines.accountName' },
        debit: { $sum: '$lines.debit' },
        credit: { $sum: '$lines.credit' },
      },
    },
  ]);

  const map = new Map<
    string,
    {
      accountId: string;
      accountCode: string;
      accountName: string;
      debit: number;
      credit: number;
    }
  >();
  for (const r of result) {
    map.set(String(r._id), {
      accountId: String(r._id),
      accountCode: r.accountCode,
      accountName: r.accountName,
      debit: round2(r.debit),
      credit: round2(r.credit),
    });
  }
  return map;
}

// ══════════════════════════════════════════════════════════════════════════
// 1. PROFIT & LOSS
// ══════════════════════════════════════════════════════════════════════════

export interface IProfitLossLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  subType: AccountSubType;
  amount: number;
}

export interface IProfitLossSection {
  title: string;
  total: number;
  lines: IProfitLossLine[];
}

/**
 * Profit & Loss Report
 *
 * Revenue accounts (type = 'revenue'):
 *   amount = credit - debit  (positive = revenue earned)
 *
 * Expense accounts (type = 'expense'):
 *   amount = debit - credit  (positive = expense incurred)
 *
 * Net profit = totalRevenue - totalExpense
 */
export async function profitAndLoss(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const range = parsePeriodRange(req.query);
    if (!range) return bad(res, 'Invalid date range or fiscal period');

    // Load all accounts (for type/subType metadata)
    const accounts = await Account.find({ isDeleted: false }).lean();
    const accMap = new Map(accounts.map((a) => [String(a._id), a]));

    // Aggregate journal lines by account
    const sums = await aggregateAccountSums(range);

    // Build revenue + expense sections
    const revenueLines: IProfitLossLine[] = [];
    const cogsLines: IProfitLossLine[] = [];
    const operatingExpenseLines: IProfitLossLine[] = [];
    const otherIncomeLines: IProfitLossLine[] = [];
    const otherExpenseLines: IProfitLossLine[] = [];
    const payrollExpenseLines: IProfitLossLine[] = [];

    let totalRevenue = 0;
    let totalCogs = 0;
    let totalOperatingExpense = 0;
    let totalOtherIncome = 0;
    let totalOtherExpense = 0;
    let totalPayrollExpense = 0;

    for (const [accId, s] of sums.entries()) {
      const acc = accMap.get(accId);
      if (!acc) continue;
      if (acc.isGroup) continue; // skip group accounts

      if (acc.type === 'revenue') {
        const amt = round2(s.credit - s.debit);
        if (amt === 0) continue;
        const line: IProfitLossLine = {
          accountId: s.accountId,
          accountCode: s.accountCode,
          accountName: s.accountName,
          subType: acc.subType,
          amount: amt,
        };
        if (acc.subType === 'operating_revenue') {
          revenueLines.push(line);
          totalRevenue += amt;
        } else {
          otherIncomeLines.push(line);
          totalOtherIncome += amt;
        }
      } else if (acc.type === 'expense') {
        const amt = round2(s.debit - s.credit);
        if (amt === 0) continue;
        const line: IProfitLossLine = {
          accountId: s.accountId,
          accountCode: s.accountCode,
          accountName: s.accountName,
          subType: acc.subType,
          amount: amt,
        };
        if (acc.subType === 'cost_of_goods_sold') {
          cogsLines.push(line);
          totalCogs += amt;
        } else if (acc.subType === 'payroll_expense') {
          payrollExpenseLines.push(line);
          totalPayrollExpense += amt;
        } else if (acc.subType === 'other_expense') {
          otherExpenseLines.push(line);
          totalOtherExpense += amt;
        } else {
          operatingExpenseLines.push(line);
          totalOperatingExpense += amt;
        }
      }
    }

    // Sort by account code
    const sortLines = (arr: IProfitLossLine[]) =>
      arr.sort((a, b) => a.accountCode.localeCompare(b.accountCode));

    sortLines(revenueLines);
    sortLines(cogsLines);
    sortLines(payrollExpenseLines);
    sortLines(operatingExpenseLines);
    sortLines(otherIncomeLines);
    sortLines(otherExpenseLines);

    // Calculations
    const grossProfit = round2(totalRevenue - totalCogs);
    const totalOperatingExpenses = round2(
      totalOperatingExpense + totalPayrollExpense
    );
    const operatingProfit = round2(grossProfit - totalOperatingExpenses);
    const netOtherIncome = round2(totalOtherIncome - totalOtherExpense);
    const netProfit = round2(operatingProfit + netOtherIncome);
    const grossProfitMargin =
      totalRevenue > 0 ? round2((grossProfit / totalRevenue) * 100) : 0;
    const netProfitMargin =
      totalRevenue > 0 ? round2((netProfit / totalRevenue) * 100) : 0;

    res.json({
      success: true,
      data: {
        period: {
          from: range.from,
          to: range.to,
          fiscalYear: range.fiscalYear,
          fiscalPeriod: range.fiscalPeriod,
          label: range.fiscalPeriod
            ? `${new Date(range.from).toLocaleString('en-US', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })}`
            : `${new Date(range.from).toLocaleDateString('en-GB')} – ${new Date(
                range.to
              ).toLocaleDateString('en-GB')}`,
        },

        revenue: {
          title: 'Revenue',
          total: round2(totalRevenue),
          lines: revenueLines,
        },
        costOfGoodsSold: {
          title: 'Cost of Goods Sold',
          total: round2(totalCogs),
          lines: cogsLines,
        },
        grossProfit,

        payrollExpenses: {
          title: 'Payroll Expenses',
          total: round2(totalPayrollExpense),
          lines: payrollExpenseLines,
        },
        operatingExpenses: {
          title: 'Operating Expenses',
          total: round2(totalOperatingExpense),
          lines: operatingExpenseLines,
        },
        totalOperatingExpenses,
        operatingProfit,

        otherIncome: {
          title: 'Other Income',
          total: round2(totalOtherIncome),
          lines: otherIncomeLines,
        },
        otherExpenses: {
          title: 'Other Expenses',
          total: round2(totalOtherExpense),
          lines: otherExpenseLines,
        },
        netOtherIncome,

        netProfit,

        metrics: {
          grossProfitMargin,
          netProfitMargin,
          totalRevenue: round2(totalRevenue),
          totalExpenses: round2(totalCogs + totalOperatingExpenses + totalOtherExpense),
        },
      },
    });
  } catch (err: any) {
    console.error('profitAndLoss error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 2. BALANCE SHEET
// ══════════════════════════════════════════════════════════════════════════

export interface IBalanceSheetLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  subType: AccountSubType;
  balance: number;
  normalBalance: 'debit' | 'credit';
}

/**
 * Balance Sheet as of a date.
 *
 * Assets: debit - credit
 * Liabilities: credit - debit
 * Equity: credit - debit
 *   + current-period retained earnings (net profit YTD)
 *
 * Total Assets = Total Liabilities + Total Equity
 *
 * ── Fix applied ──
 * Skip parent/placeholder accounts (accounts that have children) so that
 * a generic header like "CURRENT ASSETS" doesn't also appear as a line item.
 */
export async function balanceSheet(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    // As-of date is required (defaults to today)
    const asOfParam = asString(req.query.asOf);
    const asOf = asOfParam ? new Date(asOfParam) : new Date();
    if (isNaN(asOf.getTime())) return bad(res, 'Invalid asOf date');
    asOf.setUTCHours(23, 59, 59, 999);

    // Aggregation over all posted JEs up to and including asOf
    const result = await JournalEntry.aggregate([
      {
        $match: {
          status: 'posted',
          isDeleted: false,
          entryDate: { $lte: asOf },
        },
      },
      { $unwind: '$lines' },
      {
        $group: {
          _id: '$lines.accountId',
          accountCode: { $first: '$lines.accountCode' },
          accountName: { $first: '$lines.accountName' },
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' },
        },
      },
    ]);

    const accounts = await Account.find({ isDeleted: false }).lean();
    const accMap = new Map(accounts.map((a) => [String(a._id), a]));

    // ── Build set of parent account IDs ──
    // Any account that has at least one child should be treated as a
    // category header, NOT a ledger line.
    const parentIds = new Set<string>();
    for (const a of accounts) {
      if (a.parentAccountId) {
        parentIds.add(String(a.parentAccountId));
      }
    }

    const currentAssets: IBalanceSheetLine[] = [];
    const fixedAssets: IBalanceSheetLine[] = [];
    const otherAssets: IBalanceSheetLine[] = [];

    const currentLiabilities: IBalanceSheetLine[] = [];
    const longTermLiabilities: IBalanceSheetLine[] = [];

    const equityLines: IBalanceSheetLine[] = [];

    let totalCurrentAssets = 0;
    let totalFixedAssets = 0;
    let totalOtherAssets = 0;
    let totalCurrentLiabilities = 0;
    let totalLongTermLiabilities = 0;
    let totalEquityAccounts = 0;

    let totalRevenueYTD = 0;
    let totalExpenseYTD = 0;

    for (const r of result) {
      const acc = accMap.get(String(r._id));
      if (!acc) continue;

      // Skip group accounts (they don't hold their own balance)
      if (acc.isGroup) continue;

      // ── Skip parent accounts (accounts with children) ──
      if (parentIds.has(String(acc._id))) continue;

      const debit = round2(r.debit || 0);
      const credit = round2(r.credit || 0);

      const line: IBalanceSheetLine = {
        accountId: String(r._id),
        accountCode: r.accountCode,
        accountName: r.accountName,
        subType: acc.subType,
        balance: 0,
        normalBalance: acc.normalBalance,
      };

      if (acc.type === 'asset') {
        line.balance = round2(debit - credit);
        if (line.balance === 0) continue;
        if (acc.subType === 'fixed_asset') {
          fixedAssets.push(line);
          totalFixedAssets += line.balance;
        } else if (
          acc.subType === 'current_asset' ||
          acc.subType === 'cash' ||
          acc.subType === 'bank' ||
          acc.subType === 'accounts_receivable' ||
          acc.subType === 'inventory' ||
          acc.subType === 'prepaid_expense'
        ) {
          currentAssets.push(line);
          totalCurrentAssets += line.balance;
        } else {
          otherAssets.push(line);
          totalOtherAssets += line.balance;
        }
      } else if (acc.type === 'liability') {
        line.balance = round2(credit - debit);
        if (line.balance === 0) continue;
        if (acc.subType === 'long_term_liability') {
          longTermLiabilities.push(line);
          totalLongTermLiabilities += line.balance;
        } else {
          currentLiabilities.push(line);
          totalCurrentLiabilities += line.balance;
        }
      } else if (acc.type === 'equity') {
        line.balance = round2(credit - debit);
        if (line.balance === 0) continue;
        equityLines.push(line);
        totalEquityAccounts += line.balance;
      } else if (acc.type === 'revenue') {
        totalRevenueYTD += round2(credit - debit);
      } else if (acc.type === 'expense') {
        totalExpenseYTD += round2(debit - credit);
      }
    }

    // Compute net profit YTD for retained earnings
    const netProfitYTD = round2(totalRevenueYTD - totalExpenseYTD);

    // Sort lines
    const sortLines = (arr: IBalanceSheetLine[]) =>
      arr.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    sortLines(currentAssets);
    sortLines(fixedAssets);
    sortLines(otherAssets);
    sortLines(currentLiabilities);
    sortLines(longTermLiabilities);
    sortLines(equityLines);

    const totalAssets = round2(
      totalCurrentAssets + totalFixedAssets + totalOtherAssets
    );
    const totalLiabilities = round2(
      totalCurrentLiabilities + totalLongTermLiabilities
    );
    const totalEquity = round2(totalEquityAccounts + netProfitYTD);
    const totalLiabilitiesAndEquity = round2(totalLiabilities + totalEquity);
    const balanced = Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01;

    // Working capital metrics
    const workingCapital = round2(totalCurrentAssets - totalCurrentLiabilities);
    const currentRatio =
      totalCurrentLiabilities > 0
        ? round2((totalCurrentAssets / totalCurrentLiabilities) * 100) / 100
        : 0;

    res.json({
      success: true,
      data: {
        asOf,

        assets: {
          current: {
            title: 'Current Assets',
            total: round2(totalCurrentAssets),
            lines: currentAssets,
          },
          fixed: {
            title: 'Fixed Assets',
            total: round2(totalFixedAssets),
            lines: fixedAssets,
          },
          other: {
            title: 'Other Assets',
            total: round2(totalOtherAssets),
            lines: otherAssets,
          },
          total: totalAssets,
        },

        liabilities: {
          current: {
            title: 'Current Liabilities',
            total: round2(totalCurrentLiabilities),
            lines: currentLiabilities,
          },
          longTerm: {
            title: 'Long-Term Liabilities',
            total: round2(totalLongTermLiabilities),
            lines: longTermLiabilities,
          },
          total: totalLiabilities,
        },

        equity: {
          accounts: {
            title: 'Equity Accounts',
            total: round2(totalEquityAccounts),
            lines: equityLines,
          },
          retainedEarnings: {
            title: 'Retained Earnings (YTD)',
            total: netProfitYTD,
          },
          total: totalEquity,
        },

        totalLiabilitiesAndEquity,
        balanced,
        difference: round2(Math.abs(totalAssets - totalLiabilitiesAndEquity)),

        metrics: {
          workingCapital,
          currentRatio,
        },
      },
    });
  } catch (err: any) {
    console.error('balanceSheet error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// 3. CASH FLOW
// ══════════════════════════════════════════════════════════════════════════

export interface ICashFlowTransaction {
  entryId: string;
  entryDate: Date;
  description: string;
  reference?: string;
  inflow: number;
  outflow: number;
  contraAccountCode: string;
  contraAccountName: string;
  activity: 'operating' | 'investing' | 'financing';
}

/**
 * Cash Flow Report.
 *
 * We look at every JE that touched a cash or bank account
 * (Account.isCashAccount === true OR subType in ['cash', 'bank'])
 * and classify the contra-line activity based on the OTHER accounts in
 * the same JE:
 *
 *   - Contra asset (fixed_asset) / investing-type → INVESTING
 *   - Contra long-term liability / capital / loan → FINANCING
 *   - Contra revenue / expense / current_ar/ap → OPERATING
 */
export async function cashFlow(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const range = parsePeriodRange(req.query);
    if (!range) return bad(res, 'Invalid date range or fiscal period');

    // Find all cash/bank accounts
    const cashAccounts = await Account.find({
      isDeleted: false,
      $or: [
        { isCashAccount: true },
        { isBankAccount: true },
        { subType: 'cash' },
        { subType: 'bank' },
      ],
    }).lean();

    if (cashAccounts.length === 0) {
      res.json({
        success: true,
        data: {
          period: { from: range.from, to: range.to },
          operating: { inflow: 0, outflow: 0, net: 0, transactions: [] },
          investing: { inflow: 0, outflow: 0, net: 0, transactions: [] },
          financing: { inflow: 0, outflow: 0, net: 0, transactions: [] },
          totals: {
            inflow: 0,
            outflow: 0,
            net: 0,
            openingBalance: 0,
            closingBalance: 0,
          },
        },
      });
      return;
    }

    const cashAccountIds = cashAccounts.map((a) => a._id);
    const cashIdSet = new Set(cashAccountIds.map((id) => String(id)));

    // Load all accounts for classification
    const allAccounts = await Account.find({ isDeleted: false }).lean();
    const accMap = new Map(allAccounts.map((a) => [String(a._id), a]));

    // Compute opening balance of all cash accounts as of range.from - 1ms
    const openingAgg = await JournalEntry.aggregate([
      {
        $match: {
          status: 'posted',
          isDeleted: false,
          entryDate: { $lt: range.from },
        },
      },
      { $unwind: '$lines' },
      {
        $match: {
          'lines.accountId': { $in: cashAccountIds },
        },
      },
      {
        $group: {
          _id: null,
          debit: { $sum: '$lines.debit' },
          credit: { $sum: '$lines.credit' },
        },
      },
    ]);
    const openingBalance = round2(
      (openingAgg[0]?.debit ?? 0) - (openingAgg[0]?.credit ?? 0)
    );

    // Get all posted JEs in the range that touch cash/bank
    const entries = await JournalEntry.find({
      status: 'posted',
      isDeleted: false,
      entryDate: { $gte: range.from, $lte: range.to },
      'lines.accountId': { $in: cashAccountIds },
    })
      .sort({ entryDate: 1 })
      .lean();

    const operating: ICashFlowTransaction[] = [];
    const investing: ICashFlowTransaction[] = [];
    const financing: ICashFlowTransaction[] = [];

    for (const entry of entries) {
      // Separate cash lines from non-cash lines
      const cashLines = entry.lines.filter((l: any) =>
        cashIdSet.has(String(l.accountId))
      );
      const contraLines = entry.lines.filter(
        (l: any) => !cashIdSet.has(String(l.accountId))
      );

      if (cashLines.length === 0) continue;

      // Net cash movement for this entry
      const cashInflow = cashLines.reduce(
        (s: number, l: any) => s + (l.debit || 0),
        0
      );
      const cashOutflow = cashLines.reduce(
        (s: number, l: any) => s + (l.credit || 0),
        0
      );
      const netCash = round2(cashInflow - cashOutflow);

      if (netCash === 0) continue;

      // Pick the contra account — use the first non-cash line for classification
      const primaryContra = contraLines[0];
      if (!primaryContra) continue;

      const contraAcc = accMap.get(String(primaryContra.accountId));

      // Classify activity
      let activity: 'operating' | 'investing' | 'financing' = 'operating';
      if (contraAcc) {
        if (
          contraAcc.subType === 'fixed_asset' ||
          contraAcc.subType === 'long_term_liability' === false &&
            contraAcc.subType === 'inventory' &&
            false
        ) {
          // Fixed asset → investing (except when it's a depreciation contra)
          activity = 'investing';
        }
        if (
          contraAcc.subType === 'long_term_liability' ||
          contraAcc.subType === 'capital' ||
          contraAcc.subType === 'drawings' ||
          contraAcc.subType === 'loan_payable' ||
          contraAcc.subType === 'retained_earnings'
        ) {
          activity = 'financing';
        }
        // Fallback: fixed_asset could be investing unless it's depreciation
        if (
          contraAcc.subType === 'fixed_asset' &&
          contraAcc.normalBalance === 'credit'
        ) {
          activity = 'operating'; // accumulated depreciation → operating
        } else if (contraAcc.subType === 'fixed_asset') {
          activity = 'investing';
        }
      }

      const tx: ICashFlowTransaction = {
        entryId: entry.entryId,
        entryDate: entry.entryDate,
        description: entry.description,
        reference: entry.reference,
        inflow: round2(cashInflow),
        outflow: round2(cashOutflow),
        contraAccountCode: primaryContra.accountCode,
        contraAccountName: primaryContra.accountName,
        activity,
      };

      if (activity === 'operating') operating.push(tx);
      else if (activity === 'investing') investing.push(tx);
      else financing.push(tx);
    }

    // Summarize
    const summarize = (txs: ICashFlowTransaction[]) => {
      const inflow = round2(txs.reduce((s, t) => s + t.inflow, 0));
      const outflow = round2(txs.reduce((s, t) => s + t.outflow, 0));
      return {
        inflow,
        outflow,
        net: round2(inflow - outflow),
        transactions: txs,
      };
    };

    const operatingSum = summarize(operating);
    const investingSum = summarize(investing);
    const financingSum = summarize(financing);

    const totalInflow = round2(
      operatingSum.inflow + investingSum.inflow + financingSum.inflow
    );
    const totalOutflow = round2(
      operatingSum.outflow + investingSum.outflow + financingSum.outflow
    );
    const netChange = round2(totalInflow - totalOutflow);
    const closingBalance = round2(openingBalance + netChange);

    res.json({
      success: true,
      data: {
        period: {
          from: range.from,
          to: range.to,
          fiscalYear: range.fiscalYear,
          fiscalPeriod: range.fiscalPeriod,
          label: range.fiscalPeriod
            ? `${new Date(range.from).toLocaleString('en-US', {
                month: 'long',
                year: 'numeric',
                timeZone: 'UTC',
              })}`
            : `${new Date(range.from).toLocaleDateString('en-GB')} – ${new Date(
                range.to
              ).toLocaleDateString('en-GB')}`,
        },
        operating: operatingSum,
        investing: investingSum,
        financing: financingSum,
        totals: {
          inflow: totalInflow,
          outflow: totalOutflow,
          net: netChange,
          openingBalance,
          closingBalance,
        },
      },
    });
  } catch (err: any) {
    console.error('cashFlow error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}