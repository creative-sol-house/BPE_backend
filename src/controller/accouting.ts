// controller/accountingController.ts
// ═══════════════════════════════════════════════════════════════════════════
// ACCOUNTING CONTROLLERS
// ═══════════════════════════════════════════════════════════════════════════

import { Response } from 'express';
import mongoose from 'mongoose';
import {
  Account,
  BankAccount,
  FiscalPeriod,
  JournalEntry,
  Invoice,
  Payment,
  BankTransaction,
  BankReconciliation,
  LedgerEntry,
  BookEntry,
  ACCOUNT_TYPES,
  ACCOUNT_SUBTYPES,
  NORMAL_BALANCES,
  JOURNAL_ENTRY_SOURCES,
  INVOICE_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_DIRECTIONS,
  BANK_ACCOUNT_TYPES,
  BANK_TRANSACTION_TYPES,
  getAccountingConfig,
  setAccountingConfig,
  registerPostingRule,
  registerPostingRules,
  getPostingRules,
  postJournalEntry,
  reverseJournalEntry,
  postLedgerEntry,
  postBookEntry,
  getTrialBalance,
  getReceivablesAging,
  getPayablesAging,
  round2,
} from '../model/accounting';
import Client from '../model/client';
import Provider from '../model/Provider';
import ProviderExpense from '../model/ProviderExpense';
import Proposal from '../model/proposal';
import { AuthRequest } from '../middleware/auth';
import { generateInvoicePdf } from '../services/invoicePdf.service';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function bad(res: Response, msg: string, code = 400): void {
  res.status(code).json({ success: false, message: msg });
}

function ok(res: Response, data: any, message?: string, code = 200): void {
  res.status(code).json({ success: true, message, data });
}

function asString(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return String(v[0] ?? '');
  return String(v);
}

function isValidObjectId(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  const s = Array.isArray(v) ? v[0] : String(v);
  return mongoose.Types.ObjectId.isValid(s);
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function date(v: unknown): Date | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? undefined : d;
}

function str(v: unknown, max?: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return max ? s.slice(0, max) : s;
}

function parseDateRange(from?: string, to?: string): { from?: Date; to?: Date } {
  const out: { from?: Date; to?: Date } = {};
  if (from) {
    const d = new Date(from);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(0, 0, 0, 0);
      out.from = d;
    }
  }
  if (to) {
    const d = new Date(to);
    if (!isNaN(d.getTime())) {
      d.setUTCHours(23, 59, 59, 999);
      out.to = d;
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CONFIG
// ═══════════════════════════════════════════════════════════════════════════

export async function getConfig(_req: AuthRequest, res: Response): Promise<void> {
  try {
    ok(res, getAccountingConfig());
  } catch (err: any) {
    console.error('getConfig error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateConfig(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user!.isMainAdmin) {
      bad(res, 'Only the main admin can update accounting config', 403);
      return;
    }
    const body = req.body || {};
    const allowed = [
      'defaultCurrency',
      'fiscalYearStartMonth',
      'defaultPaymentTermsDays',
      'defaultTaxRate',
      'defaultTaxLabel',
      'enableAutoPosting',
      'requireBalancedEntries',
      'allowBackdatedEntries',
      'backdateDaysLimit',
      'invoiceNumberPrefix',
      'paymentNumberPrefix',
      'journalNumberPrefix',
      'bankTransactionPrefix',
      'bankAccountPrefix',
      'invoicePrefix',
    ];

    const patch: Record<string, any> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    if (patch.fiscalYearStartMonth !== undefined) {
      const m = Number(patch.fiscalYearStartMonth);
      if (!Number.isInteger(m) || m < 1 || m > 12) {
        bad(res, 'fiscalYearStartMonth must be 1..12');
        return;
      }
      patch.fiscalYearStartMonth = m;
    }

    setAccountingConfig(patch);
    ok(res, getAccountingConfig(), 'Config updated');
  } catch (err: any) {
    console.error('updateConfig error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. CHART OF ACCOUNTS (COA)
// ═══════════════════════════════════════════════════════════════════════════

export async function listAccounts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { type, subType, isActive, search, parentAccountId, onlyDeleted } = req.query;

    const filter: any = { isDeleted: onlyDeleted === 'true' };
    if (type) {
      const list = String(type).split(',').map((s) => s.trim());
      filter.type = list.length === 1 ? list[0] : { $in: list };
    }
    if (subType) {
      const list = String(subType).split(',').map((s) => s.trim());
      filter.subType = list.length === 1 ? list[0] : { $in: list };
    }
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (parentAccountId) {
      if (!isValidObjectId(parentAccountId)) {
        bad(res, 'Invalid parentAccountId');
        return;
      }
      filter.parentAccountId = parentAccountId;
    }
    if (search) {
      filter.$or = [
        { accountId: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
      ];
    }

    const accounts = await Account.find(filter)
      .populate('parentAccountId', 'accountId name')
      .sort({ accountId: 1 });

    ok(res, accounts);
  } catch (err: any) {
    console.error('listAccounts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.accountId);
    if (!id) {
      bad(res, 'accountId required');
      return;
    }

    const query = isValidObjectId(id) ? { _id: id } : { accountId: id };
    const account = await Account.findOne({ ...query, isDeleted: false })
      .populate('parentAccountId', 'accountId name')
      .populate('linkedBankAccountId', 'accountId bankName accountNumber')
      .populate('linkedClientId', 'clientId name')
      .populate('linkedProviderId', 'name category');
    if (!account) {
      bad(res, 'Account not found', 404);
      return;
    }

    ok(res, account);
  } catch (err: any) {
    console.error('getAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      accountId,
      name,
      description,
      type,
      subType,
      normalBalance,
      parentAccountId,
      isGroup,
      openingBalance,
      currency,
      isBankAccount,
      isCashAccount,
      isReceivable,
      isPayable,
      isTaxAccount,
      isControlAccount,
      linkedBankAccountId,
      linkedClientId,
      linkedProviderId,
    } = req.body;

    if (!accountId || !String(accountId).trim()) {
      bad(res, 'accountId required');
      return;
    }
    if (!name || !String(name).trim()) {
      bad(res, 'name required');
      return;
    }
    if (!ACCOUNT_TYPES.includes(type)) {
      bad(res, `type must be one of: ${ACCOUNT_TYPES.join(', ')}`);
      return;
    }
    if (!ACCOUNT_SUBTYPES.includes(subType)) {
      bad(res, `subType must be one of: ${ACCOUNT_SUBTYPES.join(', ')}`);
      return;
    }
    if (!NORMAL_BALANCES.includes(normalBalance)) {
      bad(res, `normalBalance must be debit|credit`);
      return;
    }

    const existing = await Account.findOne({ accountId: String(accountId).trim() });
    if (existing) {
      bad(res, 'Account code already exists', 409);
      return;
    }

    let parentCode: string | null = null;
    let level = 1;
    if (parentAccountId) {
      if (!isValidObjectId(parentAccountId)) {
        bad(res, 'Invalid parentAccountId');
        return;
      }
      const parent = await Account.findById(parentAccountId).select('accountId level');
      if (!parent) {
        bad(res, 'Parent account not found');
        return;
      }
      parentCode = parent.accountId;
      level = (parent.level ?? 1) + 1;
    }

    const doc = new Account({
      accountId: String(accountId).trim(),
      name: String(name).trim(),
      description: str(description, 500),
      type,
      subType,
      normalBalance,
      parentAccountId: parentAccountId || null,
      parentAccountCode: parentCode,
      level,
      isGroup: isGroup === true,
      openingBalance: round2(num(openingBalance) ?? 0),
      currentBalance: round2(num(openingBalance) ?? 0),
      currency: str(currency, 3)?.toUpperCase() || 'PKR',
      isBankAccount: isBankAccount === true,
      isCashAccount: isCashAccount === true,
      isReceivable: isReceivable === true,
      isPayable: isPayable === true,
      isTaxAccount: isTaxAccount === true,
      isControlAccount: isControlAccount === true,
      linkedBankAccountId: linkedBankAccountId || null,
      linkedClientId: linkedClientId || null,
      linkedProviderId: linkedProviderId || null,
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await doc.save();
    ok(res, doc, 'Account created', 201);
  } catch (err: any) {
    console.error('createAccount error:', err);
    if (err?.code === 11000) {
      res.status(409).json({ success: false, message: 'Account code already exists' });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.accountId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid account id');
      return;
    }

    const account = await Account.findOne({ _id: id, isDeleted: false });
    if (!account) {
      bad(res, 'Account not found', 404);
      return;
    }

    if (account.isLocked && !req.user!.isMainAdmin) {
      bad(res, 'Account is locked');
      return;
    }

    const {
      name, description, type, subType, normalBalance,
      isGroup, currency, isBankAccount, isCashAccount, isReceivable,
      isPayable, isTaxAccount, isControlAccount, isActive,
      linkedBankAccountId, linkedClientId, linkedProviderId,
    } = req.body;

    if (name !== undefined) account.name = String(name).trim();
    if (description !== undefined) account.description = str(description, 500);
    if (type !== undefined) {
      if (!ACCOUNT_TYPES.includes(type)) {
        bad(res, 'Invalid type');
        return;
      }
      account.type = type;
    }
    if (subType !== undefined) {
      if (!ACCOUNT_SUBTYPES.includes(subType)) {
        bad(res, 'Invalid subType');
        return;
      }
      account.subType = subType;
    }
    if (normalBalance !== undefined) {
      if (!NORMAL_BALANCES.includes(normalBalance)) {
        bad(res, 'Invalid normalBalance');
        return;
      }
      account.normalBalance = normalBalance;
    }
    if (isGroup !== undefined) account.isGroup = isGroup === true;
    if (currency !== undefined) account.currency = String(currency).toUpperCase();
    if (isBankAccount !== undefined) account.isBankAccount = isBankAccount === true;
    if (isCashAccount !== undefined) account.isCashAccount = isCashAccount === true;
    if (isReceivable !== undefined) account.isReceivable = isReceivable === true;
    if (isPayable !== undefined) account.isPayable = isPayable === true;
    if (isTaxAccount !== undefined) account.isTaxAccount = isTaxAccount === true;
    if (isControlAccount !== undefined) account.isControlAccount = isControlAccount === true;
    if (isActive !== undefined) account.isActive = isActive === true;
    if (linkedBankAccountId !== undefined) account.linkedBankAccountId = linkedBankAccountId || null;
    if (linkedClientId !== undefined) account.linkedClientId = linkedClientId || null;
    if (linkedProviderId !== undefined) account.linkedProviderId = linkedProviderId || null;

    account.updatedBy = req.user?._id ?? null;
    await account.save();

    ok(res, account, 'Account updated');
  } catch (err: any) {
    console.error('updateAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.accountId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid account id');
      return;
    }

    const account = await Account.findOne({ _id: id, isDeleted: false });
    if (!account) {
      bad(res, 'Account not found', 404);
      return;
    }

    if (account.isLocked && !req.user!.isMainAdmin) {
      bad(res, 'Account is locked');
      return;
    }

    const jeCount = await JournalEntry.countDocuments({
      'lines.accountId': account._id,
      isDeleted: false,
    });
    if (jeCount > 0 && !req.user!.isMainAdmin) {
      bad(res, `Cannot delete — ${jeCount} journal entries reference this account`);
      return;
    }

    const childCount = await Account.countDocuments({
      parentAccountId: account._id,
      isDeleted: false,
    });
    if (childCount > 0) {
      bad(res, `Cannot delete — ${childCount} child accounts exist`);
      return;
    }

    account.isDeleted = true;
    account.isActive = false;
    account.updatedBy = req.user?._id ?? null;
    await account.save();

    ok(res, null, 'Account deleted');
  } catch (err: any) {
    console.error('deleteAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function restoreAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.accountId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid account id');
      return;
    }

    const account = await Account.findById(id);
    if (!account) {
      bad(res, 'Account not found', 404);
      return;
    }

    account.isDeleted = false;
    account.isActive = true;
    account.updatedBy = req.user?._id ?? null;
    await account.save();

    ok(res, account, 'Account restored');
  } catch (err: any) {
    console.error('restoreAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function seedAccounts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { accounts } = req.body;
    if (!Array.isArray(accounts) || accounts.length === 0) {
      bad(res, 'accounts must be a non-empty array');
      return;
    }
    if (accounts.length > 500) {
      bad(res, 'Too many accounts (max 500)');
      return;
    }

    const created = await Account.seedDefaults(accounts);
    const total = await Account.countDocuments({ isDeleted: false });

    ok(res, { created, total }, `${created} accounts seeded`);
  } catch (err: any) {
    console.error('seedAccounts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getAccountTree(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const accounts = await Account.find({ isDeleted: false }).sort({ accountId: 1 }).lean();
    const map = new Map<string, any>();
    const roots: any[] = [];

    for (const a of accounts) {
      map.set(String(a._id), { ...a, children: [] });
    }
    for (const a of accounts) {
      const node = map.get(String(a._id));
      if (a.parentAccountId && map.has(String(a.parentAccountId))) {
        map.get(String(a.parentAccountId)).children.push(node);
      } else {
        roots.push(node);
      }
    }

    ok(res, roots);
  } catch (err: any) {
    console.error('getAccountTree error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. FISCAL PERIODS
// ═══════════════════════════════════════════════════════════════════════════

export async function listFiscalPeriods(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { fiscalYear, status } = req.query;
    const filter: any = {};
    if (fiscalYear) filter.fiscalYear = Number(fiscalYear);
    if (status) filter.status = status;

    const periods = await FiscalPeriod.find(filter).sort({ fiscalYear: -1, period: 1 });
    ok(res, periods);
  } catch (err: any) {
    console.error('listFiscalPeriods error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function generateFiscalYear(req: AuthRequest, res: Response): Promise<void> {
  try {
    const fiscalYear = Number(req.body.fiscalYear);
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
      bad(res, 'fiscalYear must be between 2000 and 2100');
      return;
    }

    const periods = await FiscalPeriod.generateYear(fiscalYear);
    ok(res, periods, `Generated ${periods.length} fiscal periods for ${fiscalYear}`, 201);
  } catch (err: any) {
    console.error('generateFiscalYear error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function closeFiscalPeriod(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.periodId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid period id');
      return;
    }

    const period = await FiscalPeriod.findById(id);
    if (!period) {
      bad(res, 'Period not found', 404);
      return;
    }
    if (period.status === 'closed' || period.status === 'locked') {
      bad(res, `Period is already ${period.status}`);
      return;
    }

    period.status = 'closed';
    period.closedAt = new Date();
    period.closedBy = req.user?._id ?? null;
    await period.save();

    ok(res, period, 'Fiscal period closed');
  } catch (err: any) {
    console.error('closeFiscalPeriod error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function lockFiscalPeriod(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user!.isMainAdmin) {
      bad(res, 'Only main admin can lock periods', 403);
      return;
    }

    const id = asString(req.params.periodId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid period id');
      return;
    }

    const period = await FiscalPeriod.findById(id);
    if (!period) {
      bad(res, 'Period not found', 404);
      return;
    }
    if (period.status === 'locked') {
      bad(res, 'Already locked');
      return;
    }

    period.status = 'locked';
    period.lockedAt = new Date();
    period.lockedBy = req.user?._id ?? null;
    await period.save();

    ok(res, period, 'Fiscal period locked');
  } catch (err: any) {
    console.error('lockFiscalPeriod error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function reopenFiscalPeriod(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user!.isMainAdmin) {
      bad(res, 'Only main admin can reopen periods', 403);
      return;
    }

    const id = asString(req.params.periodId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid period id');
      return;
    }

    const period = await FiscalPeriod.findById(id);
    if (!period) {
      bad(res, 'Period not found', 404);
      return;
    }
    if (period.status === 'open') {
      bad(res, 'Already open');
      return;
    }

    period.status = 'open';
    period.closedAt = undefined;
    period.closedBy = null;
    period.lockedAt = undefined;
    period.lockedBy = null;
    await period.save();

    ok(res, period, 'Fiscal period reopened');
  } catch (err: any) {
    console.error('reopenFiscalPeriod error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. JOURNAL ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export async function listJournalEntries(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      status, source, referenceType, referenceId,
      accountId, clientId, providerId,
      from, to, fiscalYear, fiscalPeriod,
      search, onlyDeleted,
      page = '1', limit = '50', sort = '-entryDate',
    } = req.query;

    const filter: any = { isDeleted: onlyDeleted === 'true' };

    if (status) {
      const list = String(status).split(',').map((s) => s.trim());
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }
    if (source) {
      const list = String(source).split(',').map((s) => s.trim());
      filter.source = list.length === 1 ? list[0] : { $in: list };
    }
    if (referenceType) filter.referenceType = referenceType;
    if (referenceId) {
      if (!isValidObjectId(referenceId)) {
        bad(res, 'Invalid referenceId');
        return;
      }
      filter.referenceId = referenceId;
    }
    if (accountId) {
      if (!isValidObjectId(accountId)) {
        bad(res, 'Invalid accountId');
        return;
      }
      filter['lines.accountId'] = accountId;
    }
    if (clientId) {
      if (!isValidObjectId(clientId)) {
        bad(res, 'Invalid clientId');
        return;
      }
      filter['lines.clientId'] = clientId;
    }
    if (providerId) {
      if (!isValidObjectId(providerId)) {
        bad(res, 'Invalid providerId');
        return;
      }
      filter['lines.providerId'] = providerId;
    }
    if (fiscalYear) filter.fiscalYear = Number(fiscalYear);
    if (fiscalPeriod) filter.fiscalPeriod = Number(fiscalPeriod);

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.entryDate = {};
      if (range.from) filter.entryDate.$gte = range.from;
      if (range.to) filter.entryDate.$lte = range.to;
    }

    if (search) {
      filter.$or = [
        { entryId: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [entries, total] = await Promise.all([
      JournalEntry.find(filter)
        .populate('lines.accountId', 'accountId name type subType')
        .populate('lines.clientId', 'clientId name')
        .populate('lines.providerId', 'name category')
        .populate('createdBy', 'name employeeId')
        .populate('postedBy', 'name employeeId')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      JournalEntry.countDocuments(filter),
    ]);

    ok(res, {
      entries,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listJournalEntries error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getJournalEntry(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.entryId);
    if (!id) {
      bad(res, 'entryId required');
      return;
    }

    const query = isValidObjectId(id) ? { _id: id } : { entryId: id };
    const entry = await JournalEntry.findOne({ ...query, isDeleted: false })
      .populate('lines.accountId', 'accountId name type subType normalBalance')
      .populate('lines.clientId', 'clientId name')
      .populate('lines.providerId', 'name category')
      .populate('lines.employeeId', 'name employeeId')
      .populate('lines.invoiceId', 'invoiceId invoiceNumber totalAmount')
      .populate('lines.paymentId', 'paymentId paymentNumber amount')
      .populate('reversalOf', 'entryId description')
      .populate('reversedBy', 'entryId description')
      .populate('createdBy', 'name employeeId')
      .populate('postedBy', 'name employeeId');

    if (!entry) {
      bad(res, 'Journal entry not found', 404);
      return;
    }
    ok(res, entry);
  } catch (err: any) {
    console.error('getJournalEntry error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createJournalEntry(req: AuthRequest, res: Response): Promise<void> {
  try {
     const lineSchemaPath = (JournalEntry.schema.path('lines') as any)?.schema;
    if (lineSchemaPath) {
      const seqPath = lineSchemaPath.path('sequence');
      if (seqPath && seqPath.isRequired) {
        seqPath.isRequired = false;
        seqPath.options.required = false;
        console.warn('[JE] Runtime-fixed: sequence.required = false');
      }
    }

    const {
      entryDate, description, source, referenceType, referenceId,
      currency, lines, autoPost,
    } = req.body;

    if (!entryDate) {
      bad(res, 'entryDate required');
      return;
    }
    if (!description) {
      bad(res, 'description required');
      return;
    }
    if (!Array.isArray(lines) || lines.length < 2) {
      bad(res, 'lines must be an array with at least 2 items');
      return;
    }
    if (source && !JOURNAL_ENTRY_SOURCES.includes(source)) {
      bad(res, `Invalid source. Allowed: ${JOURNAL_ENTRY_SOURCES.join(', ')}`);
      return;
    }

    const normalizedLines: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || typeof l !== 'object') {
        bad(res, `lines[${i}] invalid`);
        return;
      }
      const code = String(l.accountCode || '').trim();
      if (!code) {
        bad(res, `lines[${i}].accountCode required`);
        return;
      }

      const debit = round2(Number(l.debit) || 0);
      const credit = round2(Number(l.credit) || 0);
      if (debit < 0 || credit < 0) {
        bad(res, `lines[${i}]: amounts must be >= 0`);
        return;
      }
      if (debit > 0 && credit > 0) {
        bad(res, `lines[${i}]: cannot have both debit and credit`);
        return;
      }
      if (debit === 0 && credit === 0) {
        bad(res, `lines[${i}]: must have either debit or credit`);
        return;
      }

      normalizedLines.push({
        accountCode: code,
        debit,
        credit,
        description: str(l.description, 500),
        clientId: l.clientId || null,
        providerId: l.providerId || null,
        employeeId: l.employeeId || null,
        invoiceId: l.invoiceId || null,
        paymentId: l.paymentId || null,
        taxType: str(l.taxType, 40),
        taxRate: num(l.taxRate),
        costCenter: str(l.costCenter, 80),
        projectId: l.projectId || null,
        department: str(l.department, 80),
        sequence: i + 1,
      });
    }

    const postDate = date(entryDate) ?? new Date();

    if (autoPost === true) {
      const entry = await postJournalEntry({
        entryDate: postDate,
        description: String(description),
        source: source || 'manual',
        referenceType: referenceType || 'Manual',
        referenceId: referenceId || null,
        currency: currency || undefined,
        lines: normalizedLines,
        createdBy: req.user?._id ?? null,
      });
      ok(res, entry, 'Journal entry posted', 201);
      return;
    }

    const config = getAccountingConfig();
    const d = new Date(postDate);

    const codes = Array.from(new Set(normalizedLines.map((l) => l.accountCode)));
    const accounts = await Account.find({
      accountId: { $in: codes },
      isDeleted: false,
    }).lean();
    const map = new Map(accounts.map((a) => [a.accountId, a]));

    let enrichedLines: any[];
    try {
      enrichedLines = normalizedLines.map((l, idx) => {
        const acc = map.get(l.accountCode);
        if (!acc) throw new Error(`Account not found: ${l.accountCode}`);
        return {
          accountId: acc._id,
          accountCode: acc.accountId,
          accountName: acc.name,
          description: l.description,
          debit: l.debit,
          credit: l.credit,
          clientId: l.clientId,
          providerId: l.providerId,
          employeeId: l.employeeId,
          invoiceId: l.invoiceId,
          paymentId: l.paymentId,
          taxType: l.taxType,
          taxRate: l.taxRate,
          costCenter: l.costCenter,
          projectId: l.projectId,
          department: l.department,
          sequence: idx + 1,
        };
      });
    } catch (e: any) {
      bad(res, e.message);
      return;
    }

    const draft = new JournalEntry({
      entryDate: postDate,
      description: String(description),
      source: source || 'manual',
      referenceType: referenceType || 'Manual',
      referenceId: referenceId || null,
      currency: currency || config.defaultCurrency,
      lines: enrichedLines,
      status: 'draft',
      fiscalYear: d.getFullYear(),
      fiscalPeriod: d.getMonth() + 1,
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await draft.save();

    ok(res, draft, 'Journal entry created as draft', 201);
  } catch (err: any) {
    console.error('createJournalEntry error:', err);
    if (err?.name === 'ValidationError') {
      res.status(400).json({
        success: false,
        message: err.message,
        errors: Object.fromEntries(
          Object.entries(err.errors || {}).map(([k, v]: any) => [k, v.message])
        ),
      });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function postJournalEntryHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.entryId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid entry id');
      return;
    }

    const entry = await JournalEntry.findOne({ _id: id, isDeleted: false });
    if (!entry) {
      bad(res, 'Journal entry not found', 404);
      return;
    }
    if (entry.status !== 'draft') {
      bad(res, `Cannot post a ${entry.status} entry`);
      return;
    }

    const period = await FiscalPeriod.findByDate(entry.entryDate);
    if (period && period.status !== 'open') {
      bad(res, `Fiscal period ${period.periodName} is ${period.status}`);
      return;
    }

    if (Math.abs(entry.totalDebit - entry.totalCredit) > 0.01) {
      bad(res, `Entry is not balanced: Dr=${entry.totalDebit}, Cr=${entry.totalCredit}`);
      return;
    }

    entry.status = 'posted';
    entry.postedAt = new Date();
    entry.postedBy = req.user?._id ?? null;
    entry.updatedBy = req.user?._id ?? null;
    await entry.save();

    const updates = entry.lines.map((line) => ({
      updateOne: {
        filter: { _id: line.accountId },
        update: {
          $inc: { currentBalance: line.debit > 0 ? line.debit : -line.credit },
        },
      },
    }));
    if (updates.length) await Account.bulkWrite(updates);

    ok(res, entry, 'Journal entry posted');
  } catch (err: any) {
    console.error('postJournalEntryHandler error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function reverseJournalEntryHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.entryId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid entry id');
      return;
    }

    const { reason } = req.body;
    if (!reason) {
      bad(res, 'reason required');
      return;
    }

    const reversal = await reverseJournalEntry(id, String(reason), req.user?._id ?? null);
    ok(res, reversal, 'Journal entry reversed', 201);
  } catch (err: any) {
    console.error('reverseJournalEntryHandler error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteJournalEntry(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.entryId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid entry id');
      return;
    }

    const entry = await JournalEntry.findOne({ _id: id, isDeleted: false });
    if (!entry) {
      bad(res, 'Journal entry not found', 404);
      return;
    }
    if (entry.status === 'posted' && !req.user!.isMainAdmin) {
      bad(res, 'Only main admin can delete posted entries. Use reverse instead.');
      return;
    }

    entry.isDeleted = true;
    entry.deletedAt = new Date();
    entry.updatedBy = req.user?._id ?? null;
    await entry.save();

    ok(res, null, 'Journal entry deleted');
  } catch (err: any) {
    console.error('deleteJournalEntry error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. INVOICES (AR)
// ═══════════════════════════════════════════════════════════════════════════

export async function listInvoices(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      status, clientId, proposalId, projectId,
      from, to, overdue, search, onlyDeleted,
      page = '1', limit = '50', sort = '-issueDate',
    } = req.query;

    const filter: any = { isDeleted: onlyDeleted === 'true' };

    if (status) {
      const list = String(status).split(',').map((s) => s.trim());
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }
    if (clientId) {
      if (!isValidObjectId(clientId)) {
        bad(res, 'Invalid clientId');
        return;
      }
      filter.clientId = clientId;
    }
    if (proposalId) {
      if (!isValidObjectId(proposalId)) {
        bad(res, 'Invalid proposalId');
        return;
      }
      filter.proposalId = proposalId;
    }
    if (projectId) {
      if (!isValidObjectId(projectId)) {
        bad(res, 'Invalid projectId');
        return;
      }
      filter.projectId = projectId;
    }

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.issueDate = {};
      if (range.from) filter.issueDate.$gte = range.from;
      if (range.to) filter.issueDate.$lte = range.to;
    }

    if (overdue === 'true') {
      filter.dueDate = { $lt: new Date() };
      filter.balanceDue = { $gt: 0 };
      filter.status = { $in: ['sent', 'viewed', 'partial', 'overdue'] };
    }

    if (search) {
      filter.$or = [
        { invoiceNumber: { $regex: search, $options: 'i' } },
        { invoiceId: { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [invoices, total] = await Promise.all([
      Invoice.find(filter)
        .populate('clientId', 'clientId name clientType email phoneNo')
        .populate('proposalId', 'proposalId title')
        .populate('projectId', 'projectId name status')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Invoice.countDocuments(filter),
    ]);

    ok(res, {
      invoices,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listInvoices error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getInvoice(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.invoiceId);
    if (!id) {
      bad(res, 'invoiceId required');
      return;
    }

    const query = isValidObjectId(id) ? { _id: id } : { invoiceId: id };
    const invoice = await Invoice.findOne({ ...query, isDeleted: false })
      .populate('clientId', 'clientId name clientType email phoneNo addresses contacts')
      .populate('proposalId', 'proposalId title subtitle')
      .populate('projectId', 'projectId name status')
      .populate('journalEntryId', 'entryId entryDate description status');

    if (!invoice) {
      bad(res, 'Invoice not found', 404);
      return;
    }

    const payments = await Payment.find({
      'allocations.invoiceId': invoice._id,
      isDeleted: false,
    }).select('paymentId paymentNumber paymentDate amount method status');

    ok(res, { invoice, payments });
  } catch (err: any) {
    console.error('getInvoice error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createInvoice(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      clientId, proposalId, projectId,
      issueDate, dueDate, lines,
      discountAmount, currency, exchangeRate,
      notes, terms, autoPost,
    } = req.body;

    if (!clientId || !isValidObjectId(clientId)) {
      bad(res, 'Valid clientId required');
      return;
    }
    const client = await Client.findOne({ _id: clientId, isDeleted: false });
    if (!client) {
      bad(res, 'Client not found', 404);
      return;
    }

    if (!Array.isArray(lines) || lines.length === 0) {
      bad(res, 'lines must be a non-empty array');
      return;
    }

    if (!dueDate) {
      bad(res, 'dueDate required');
      return;
    }

    const normalizedLines: any[] = [];
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || typeof l !== 'object') {
        bad(res, `lines[${i}] invalid`);
        return;
      }
      const desc = String(l.description || '').trim();
      if (!desc) {
        bad(res, `lines[${i}].description required`);
        return;
      }

      const qty = num(l.quantity);
      const price = num(l.unitPrice);
      if (qty === undefined || qty < 0) {
        bad(res, `lines[${i}].quantity must be >= 0`);
        return;
      }
      if (price === undefined || price < 0) {
        bad(res, `lines[${i}].unitPrice must be >= 0`);
        return;
      }

      normalizedLines.push({
        description: desc.slice(0, 500),
        quantity: qty,
        unitPrice: price,
        amount: 0,
        taxRate: num(l.taxRate) ?? 0,
        taxAmount: 0,
        accountId: l.accountId || null,
        accountCode: str(l.accountCode, 40),
        projectId: l.projectId || null,
        sequence: i + 1,
      });
    }

    const invoiceNumber = await Invoice.nextInvoiceNumber();

    const invoice = new Invoice({
      invoiceNumber,
      clientId: client._id,
      proposalId: proposalId || null,
      projectId: projectId || null,
      issueDate: date(issueDate) ?? new Date(),
      dueDate: date(dueDate)!,
      lines: normalizedLines,
      discountAmount: round2(num(discountAmount) ?? 0),
      currency: str(currency, 3)?.toUpperCase() || client.currency || 'PKR',
      exchangeRate: num(exchangeRate) ?? 1,
      notes: str(notes, 2000),
      terms: str(terms, 2000),
      status: 'draft',
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await invoice.save();

    if (autoPost === true) {
      const arAccount = await Account.findOne({ isReceivable: true, isControlAccount: true, isDeleted: false });
      if (arAccount) {
        const revenueCode = '4010';
        try {
          const je = await postJournalEntry({
            entryDate: invoice.issueDate,
            description: `Invoice ${invoice.invoiceNumber}`,
            source: 'invoice',
            referenceType: 'Invoice',
            referenceId: invoice._id,
            currency: invoice.currency,
            lines: [
              { accountCode: arAccount.accountId, debit: invoice.totalAmount, clientId: invoice.clientId, invoiceId: invoice._id },
              { accountCode: revenueCode, credit: invoice.totalAmount, clientId: invoice.clientId, invoiceId: invoice._id },
            ],
            createdBy: req.user?._id ?? null,
          });

          invoice.journalEntryId = je._id;
          invoice.status = 'sent';
          await invoice.save();

          await postLedgerEntry({
            accountCode: arAccount.accountId,
            partyType: 'client',
            clientId: invoice.clientId,
            journalEntryId: je._id,
            entryDate: invoice.issueDate,
            description: `Invoice ${invoice.invoiceNumber}`,
            reference: invoice.invoiceNumber,
            referenceType: 'Invoice',
            referenceId: invoice._id,
            debit: invoice.totalAmount,
            dueDate: invoice.dueDate,
            invoiceId: invoice._id,
          });
        } catch (postErr: any) {
          console.warn('Auto-post invoice failed:', postErr.message);
        }
      }
    }

    ok(res, invoice, 'Invoice created', 201);
  } catch (err: any) {
    console.error('createInvoice error:', err);
    if (err?.name === 'ValidationError') {
      res.status(400).json({
        success: false,
        message: err.message,
        errors: Object.fromEntries(
          Object.entries(err.errors || {}).map(([k, v]: any) => [k, v.message])
        ),
      });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateInvoice(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.invoiceId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid invoice id');
      return;
    }

    const invoice = await Invoice.findOne({ _id: id, isDeleted: false });
    if (!invoice) {
      bad(res, 'Invoice not found', 404);
      return;
    }
    if (invoice.status === 'paid' || invoice.status === 'cancelled') {
      bad(res, `Cannot edit a ${invoice.status} invoice`);
      return;
    }

    const {
      issueDate, dueDate, lines, discountAmount,
      currency, exchangeRate, notes, terms, status,
    } = req.body;

    if (issueDate !== undefined) {
      const d = date(issueDate);
      if (d) invoice.issueDate = d;
    }
    if (dueDate !== undefined) {
      const d = date(dueDate);
      if (d) invoice.dueDate = d;
    }
    if (lines !== undefined) {
      if (!Array.isArray(lines)) {
        bad(res, 'lines must be an array');
        return;
      }
      const normalized: any[] = [];
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i];
        if (!l || typeof l !== 'object') {
          bad(res, `lines[${i}] invalid`);
          return;
        }
        const desc = String(l.description || '').trim();
        if (!desc) {
          bad(res, `lines[${i}].description required`);
          return;
        }
        normalized.push({
          description: desc.slice(0, 500),
          quantity: num(l.quantity) ?? 1,
          unitPrice: num(l.unitPrice) ?? 0,
          amount: 0,
          taxRate: num(l.taxRate) ?? 0,
          taxAmount: 0,
          accountId: l.accountId || null,
          accountCode: str(l.accountCode, 40),
          projectId: l.projectId || null,
          sequence: i + 1,
        });
      }
      invoice.lines = normalized;
      invoice.markModified('lines');
    }
    if (discountAmount !== undefined) invoice.discountAmount = round2(Number(discountAmount) || 0);
    if (currency !== undefined) invoice.currency = String(currency).toUpperCase();
    if (exchangeRate !== undefined) invoice.exchangeRate = Number(exchangeRate) || 1;
    if (notes !== undefined) invoice.notes = str(notes, 2000);
    if (terms !== undefined) invoice.terms = str(terms, 2000);
    if (status !== undefined) {
      if (!INVOICE_STATUSES.includes(status)) {
        bad(res, 'Invalid status');
        return;
      }
      invoice.status = status;
    }

    invoice.updatedBy = req.user?._id ?? null;
    await invoice.save();

    ok(res, invoice, 'Invoice updated');
  } catch (err: any) {
    console.error('updateInvoice error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteInvoice(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.invoiceId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid invoice id');
      return;
    }

    const invoice = await Invoice.findOne({ _id: id, isDeleted: false });
    if (!invoice) {
      bad(res, 'Invoice not found', 404);
      return;
    }
    if (invoice.paidAmount > 0) {
      bad(res, 'Cannot delete — invoice has payments applied');
      return;
    }

    invoice.isDeleted = true;
    invoice.deletedAt = new Date();
    invoice.updatedBy = req.user?._id ?? null;
    await invoice.save();

    ok(res, null, 'Invoice deleted');
  } catch (err: any) {
    console.error('deleteInvoice error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createInvoiceFromProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    if (!isValidObjectId(proposalId)) {
      bad(res, 'Invalid proposalId');
      return;
    }

    const proposal = await Proposal.findById(proposalId);
    if (!proposal) {
      bad(res, 'Proposal not found', 404);
      return;
    }
    if (proposal.status !== 'accepted') {
      bad(res, 'Only accepted proposals can generate invoices');
      return;
    }
    if (!proposal.clientId) {
      bad(res, 'Proposal has no linked client');
      return;
    }

    const lines = (proposal.lineItems ?? []).map((li: any, i: number) => ({
      description: li.name + (li.description ? ` — ${li.description}` : ''),
      quantity: li.quantity ?? 1,
      unitPrice: li.unitPrice ?? 0,
      amount: 0,
      taxRate: li.taxRate ?? 0,
      taxAmount: 0,
      sequence: i + 1,
    }));

    if (lines.length === 0) {
      lines.push({
        description: proposal.title,
        quantity: 1,
        unitPrice: proposal.totals?.total ?? 0,
        amount: 0,
        taxRate: 0,
        taxAmount: 0,
        sequence: 1,
      });
    }

    const invoiceNumber = await Invoice.nextInvoiceNumber();
    const issueDate = new Date();
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    const invoice = new Invoice({
      invoiceNumber,
      clientId: proposal.clientId,
      proposalId: proposal._id,
      issueDate,
      dueDate,
      lines,
      discountAmount: proposal.financial?.globalDiscountAmount ?? 0,
      currency: proposal.financial?.currency || 'PKR',
      notes: `Generated from proposal ${proposal.proposalId}`,
      status: 'draft',
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await invoice.save();
    ok(res, invoice, 'Invoice created from proposal', 201);
  } catch (err: any) {
    console.error('createInvoiceFromProposal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function sendInvoice(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.invoiceId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid invoice id');
      return;
    }

    const invoice = await Invoice.findOne({ _id: id, isDeleted: false });
    if (!invoice) {
      bad(res, 'Invoice not found', 404);
      return;
    }
    if (invoice.status !== 'draft') {
      bad(res, `Cannot send a ${invoice.status} invoice`);
      return;
    }

    invoice.status = 'sent';
    invoice.updatedBy = req.user?._id ?? null;
    await invoice.save();

    ok(res, invoice, 'Invoice sent');
  } catch (err: any) {
    console.error('sendInvoice error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. PAYMENTS
// ═══════════════════════════════════════════════════════════════════════════

export async function listPayments(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      direction, method, status, clientId, providerId,
      from, to, search, onlyDeleted,
      page = '1', limit = '50', sort = '-paymentDate',
    } = req.query;

    const filter: any = { isDeleted: onlyDeleted === 'true' };
    if (direction) filter.direction = direction;
    if (method) {
      const list = String(method).split(',').map((s) => s.trim());
      filter.method = list.length === 1 ? list[0] : { $in: list };
    }
    if (status) {
      const list = String(status).split(',').map((s) => s.trim());
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }
    if (clientId) {
      if (!isValidObjectId(clientId)) {
        bad(res, 'Invalid clientId');
        return;
      }
      filter.clientId = clientId;
    }
    if (providerId) {
      if (!isValidObjectId(providerId)) {
        bad(res, 'Invalid providerId');
        return;
      }
      filter.providerId = providerId;
    }

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.paymentDate = {};
      if (range.from) filter.paymentDate.$gte = range.from;
      if (range.to) filter.paymentDate.$lte = range.to;
    }

    if (search) {
      filter.$or = [
        { paymentNumber: { $regex: search, $options: 'i' } },
        { paymentId: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
        { chequeNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [payments, total] = await Promise.all([
      Payment.find(filter)
        .populate('clientId', 'clientId name')
        .populate('providerId', 'name category')
        .populate('bankAccountId', 'accountId bankName accountNumber')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Payment.countDocuments(filter),
    ]);

    ok(res, {
      payments,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listPayments error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getPayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.paymentId);
    if (!id) {
      bad(res, 'paymentId required');
      return;
    }

    const query = isValidObjectId(id) ? { _id: id } : { paymentId: id };
    const payment = await Payment.findOne({ ...query, isDeleted: false })
      .populate('clientId', 'clientId name email phoneNo')
      .populate('providerId', 'name category')
      .populate('bankAccountId', 'accountId bankName accountNumber')
      .populate('allocations.invoiceId', 'invoiceId invoiceNumber totalAmount balanceDue')
      .populate('allocations.providerExpenseId', 'amount description status')
      .populate('journalEntryId', 'entryId entryDate description status');

    if (!payment) {
      bad(res, 'Payment not found', 404);
      return;
    }
    ok(res, payment);
  } catch (err: any) {
    console.error('getPayment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createPayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('🟢 [createPayment] STARTED');
    console.log('═══════════════════════════════════════════════════════════');

    const {
      direction, method, clientId, providerId,
      amount, currency, exchangeRate,
      paymentDate, valueDate,
      bankAccountId, cashAccountId,
      reference, chequeNumber, transactionId,
      allocations, notes,
    } = req.body;

    console.log('📥 [createPayment] Body received:', JSON.stringify({
      direction, method, clientId, providerId, amount,
      bankAccountId, cashAccountId, reference,
    }, null, 2));

    if (!PAYMENT_DIRECTIONS.includes(direction)) {
      bad(res, `direction must be inbound|outbound`);
      return;
    }
    if (!PAYMENT_METHODS.includes(method)) {
      bad(res, `method must be one of: ${PAYMENT_METHODS.join(', ')}`);
      return;
    }

    const amt = num(amount);
    if (amt === undefined || amt <= 0) {
      bad(res, 'amount must be > 0');
      return;
    }

    if (direction === 'inbound') {
      if (!clientId || !isValidObjectId(clientId)) {
        bad(res, 'clientId required for inbound payments');
        return;
      }
      const client = await Client.findOne({ _id: clientId, isDeleted: false });
      if (!client) {
        bad(res, 'Client not found', 404);
        return;
      }
    } else {
      if (!providerId || !isValidObjectId(providerId)) {
        bad(res, 'providerId required for outbound payments');
        return;
      }
      const provider = await Provider.findOne({ _id: providerId, isDeleted: false });
      if (!provider) {
        bad(res, 'Provider not found', 404);
        return;
      }
    }

    const normalizedAllocations: any[] = [];
    if (Array.isArray(allocations)) {
      for (let i = 0; i < allocations.length; i++) {
        const a = allocations[i];
        if (!a || typeof a !== 'object') {
          bad(res, `allocations[${i}] invalid`);
          return;
        }
        const aamt = num(a.amount);
        if (aamt === undefined || aamt <= 0) {
          bad(res, `allocations[${i}].amount must be > 0`);
          return;
        }
        normalizedAllocations.push({
          invoiceId: a.invoiceId || null,
          providerExpenseId: a.providerExpenseId || null,
          amount: round2(aamt),
          allocatedAt: new Date(),
          notes: str(a.notes, 500),
        });
      }
    }

    const totalAllocated = normalizedAllocations.reduce((s, a) => s + a.amount, 0);
    if (totalAllocated > amt + 0.01) {
      bad(res, 'Total allocated amount cannot exceed payment amount');
      return;
    }

    const paymentNumber = `${getAccountingConfig().paymentNumberPrefix}-${Date.now()}`;

    const payment = new Payment({
      paymentNumber,
      direction,
      method,
      clientId: clientId || null,
      providerId: providerId || null,
      amount: round2(amt),
      currency: str(currency, 3)?.toUpperCase() || 'PKR',
      exchangeRate: num(exchangeRate) ?? 1,
      paymentDate: date(paymentDate) ?? new Date(),
      valueDate: date(valueDate),
      bankAccountId: bankAccountId || null,
      cashAccountId: cashAccountId || null,
      reference: str(reference, 100),
      chequeNumber: str(chequeNumber, 60),
      transactionId: str(transactionId, 100),
      allocations: normalizedAllocations,
      status: 'cleared',
      notes: str(notes, 2000),
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await payment.save();
    console.log('✅ [createPayment] Payment saved:', payment._id, payment.paymentNumber);

    for (const alloc of normalizedAllocations) {
      if (alloc.invoiceId) {
        const inv = await Invoice.findById(alloc.invoiceId);
        if (inv) {
          inv.paidAmount = round2((inv.paidAmount || 0) + alloc.amount);
          inv.balanceDue = round2(inv.totalAmount - inv.paidAmount);
          if (inv.balanceDue <= 0.01) {
            inv.status = 'paid';
            inv.paidAt = new Date();
          } else {
            inv.status = 'partial';
          }
          await inv.save();
        }
      }
      if (alloc.providerExpenseId) {
        const exp = await ProviderExpense.findById(alloc.providerExpenseId);
        if (exp && exp.status !== 'paid') {
          exp.status = 'paid';
          exp.paidAt = new Date();
          exp.paidBy = req.user?._id ?? null;
          if (method) exp.paymentMethod = method;
          await exp.save();
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // AUTO-POST TO GL, CASH BOOK, OR BANK BOOK
    // ═══════════════════════════════════════════════════════════════════
    console.log('🔍 [createPayment] Starting auto-post block');
    console.log('🔍 [createPayment] bankAccountId from body:', bankAccountId);

    try {
      const cashAcc = await Account.findOne({ isCashAccount: true, isDeleted: false });
      const bankAcc = bankAccountId
        ? await BankAccount.findById(bankAccountId).select('glAccountId').lean()
        : null;

      console.log('🔍 [createPayment] Account lookups:', {
        cashAccFound: !!cashAcc,
        cashAccId: cashAcc?._id?.toString(),
        cashAccCode: cashAcc?.accountId,
        cashAccName: cashAcc?.name,
        cashAccIsDeleted: cashAcc?.isDeleted,
        bankAccFound: !!bankAcc,
        bankAccountId,
      });

      const arAccount = await Account.findOne({ isReceivable: true, isControlAccount: true, isDeleted: false });
      const apAccount = await Account.findOne({ isPayable: true, isControlAccount: true, isDeleted: false });

      console.log('🔍 [createPayment] AR/AP accounts:', {
        arFound: !!arAccount,
        arCode: arAccount?.accountId,
        apFound: !!apAccount,
        apCode: apAccount?.accountId,
      });

      let debitCode: string | null = null;
      let creditCode: string | null = null;

      if (direction === 'inbound') {
        debitCode = (bankAcc as any)?.glAccountId
          ? (await Account.findById((bankAcc as any).glAccountId))?.accountId ?? null
          : cashAcc?.accountId ?? null;
        creditCode = arAccount?.accountId ?? null;
      } else {
        debitCode = apAccount?.accountId ?? null;
        creditCode = (bankAcc as any)?.glAccountId
          ? (await Account.findById((bankAcc as any).glAccountId))?.accountId ?? null
          : cashAcc?.accountId ?? null;
      }

      console.log('🔍 [createPayment] Resolved codes:', { debitCode, creditCode });

      if (debitCode && creditCode) {
        const je = await postJournalEntry({
          entryDate: payment.paymentDate,
          description: `Payment ${payment.paymentNumber}`,
          source: 'payment',
          referenceType: 'Payment',
          referenceId: payment._id,
          currency: payment.currency,
          lines: [
            { accountCode: debitCode, debit: payment.amount, clientId: payment.clientId ?? null, providerId: payment.providerId ?? null, paymentId: payment._id },
            { accountCode: creditCode, credit: payment.amount, clientId: payment.clientId ?? null, providerId: payment.providerId ?? null, paymentId: payment._id },
          ],
          createdBy: req.user?._id ?? null,
        });

        payment.journalEntryId = je._id;
        await payment.save();
        console.log('✅ [createPayment] JE posted:', je._id, je.entryId);

        // ── Post to Cash Book or Bank Book ──
        console.log('🔍 [createPayment] Entering BookEntry block');

        try {
          const isCash = !bankAccountId;
          let bookAccountCode: string | null = null;
          let resolvedBankId: any = null;

          if (isCash) {
            bookAccountCode = cashAcc?.accountId ?? null;
            console.log('🔍 [createPayment] isCash=true, bookAccountCode:', bookAccountCode);
          } else {
            const glAcc = (bankAcc as any)?.glAccountId
              ? await Account.findById((bankAcc as any).glAccountId).lean()
              : null;
            bookAccountCode = glAcc?.accountId ?? null;
            resolvedBankId = (bankAcc as any)?._id ?? null;
            console.log('🔍 [createPayment] isCash=false, bookAccountCode:', bookAccountCode, 'resolvedBankId:', resolvedBankId);
          }

          console.log('🔍 [createPayment] About to check bookAccountCode:', bookAccountCode, 'typeof:', typeof bookAccountCode);

          if (bookAccountCode) {
            const isInbound = direction === 'inbound';

            console.log('🟢 [createPayment] Calling postBookEntry now with:', {
              bookType: isCash ? 'cash_book' : 'bank_book',
              accountCode: bookAccountCode,
              bankAccountId: resolvedBankId,
              receiptAmount: isInbound ? payment.amount : 0,
              paymentAmount: isInbound ? 0 : payment.amount,
              journalEntryId: je._id,
              paymentId: payment._id,
            });

            const bookEntry = await postBookEntry({
              bookType: isCash ? 'cash_book' : 'bank_book',
              accountCode: bookAccountCode,
              bankAccountId: resolvedBankId,
              entryDate: payment.paymentDate,
              description: `Payment ${payment.paymentNumber}`,
              reference: payment.reference || payment.paymentNumber,
              receiptAmount: isInbound ? payment.amount : 0,
              paymentAmount: isInbound ? 0 : payment.amount,
              contraAccountCode: isInbound
                ? arAccount?.accountId
                : apAccount?.accountId,
              journalEntryId: je._id,
              paymentId: payment._id,
            });

            console.log('✅ [createPayment] BookEntry CREATED:', bookEntry._id, bookEntry.bookId);
          } else {
            console.log('❌ [createPayment] SKIPPED postBookEntry because bookAccountCode is null');
          }
        } catch (bookErr: any) {
          console.error('❌❌ [createPayment] Book entry post FAILED:', bookErr);
          console.error('❌❌ Stack:', bookErr.stack);
        }
      } else {
        console.log('❌ [createPayment] SKIPPED JE — debitCode or creditCode is null');
      }
    } catch (postErr: any) {
      console.error('❌❌ [createPayment] Auto-post payment FAILED:', postErr);
      console.error('❌❌ Stack:', postErr.stack);
    }

    console.log('🟢 [createPayment] ENDED — returning 201\n');
    ok(res, payment, 'Payment created', 201);
  } catch (err: any) {
    console.error('❌❌ [createPayment] FATAL ERROR:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deletePayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.paymentId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid payment id');
      return;
    }

    const payment = await Payment.findOne({ _id: id, isDeleted: false });
    if (!payment) {
      bad(res, 'Payment not found', 404);
      return;
    }

    for (const alloc of payment.allocations) {
      if (alloc.invoiceId) {
        const inv = await Invoice.findById(alloc.invoiceId);
        if (inv) {
          inv.paidAmount = round2(Math.max(0, (inv.paidAmount || 0) - alloc.amount));
          inv.balanceDue = round2(inv.totalAmount - inv.paidAmount);
          if (inv.balanceDue > 0.01 && inv.status === 'paid') {
            inv.status = inv.paidAmount > 0 ? 'partial' : 'sent';
          }
          await inv.save();
        }
      }
    }

    payment.isDeleted = true;
    payment.deletedAt = new Date();
    payment.updatedBy = req.user?._id ?? null;
    await payment.save();

    ok(res, null, 'Payment deleted');
  } catch (err: any) {
    console.error('deletePayment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function allocatePayment(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.paymentId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid payment id');
      return;
    }

    const { allocations } = req.body;
    if (!Array.isArray(allocations) || allocations.length === 0) {
      bad(res, 'allocations must be a non-empty array');
      return;
    }

    const payment = await Payment.findOne({ _id: id, isDeleted: false });
    if (!payment) {
      bad(res, 'Payment not found', 404);
      return;
    }

    const newAllocations: any[] = [];
    let addedTotal = 0;
    for (const a of allocations) {
      if (!a || typeof a !== 'object') {
        bad(res, 'Invalid allocation');
        return;
      }
      const amt = num(a.amount);
      if (amt === undefined || amt <= 0) {
        bad(res, 'amount must be > 0');
        return;
      }
      newAllocations.push({
        invoiceId: a.invoiceId || null,
        providerExpenseId: a.providerExpenseId || null,
        amount: round2(amt),
        allocatedAt: new Date(),
        notes: str(a.notes, 500),
      });
      addedTotal += amt;
    }

    if (payment.allocatedAmount + addedTotal > payment.amount + 0.01) {
      bad(res, 'Total allocated exceeds payment amount');
      return;
    }

    payment.allocations.push(...newAllocations);
    await payment.save();

    for (const alloc of newAllocations) {
      if (alloc.invoiceId) {
        const inv = await Invoice.findById(alloc.invoiceId);
        if (inv) {
          inv.paidAmount = round2((inv.paidAmount || 0) + alloc.amount);
          inv.balanceDue = round2(inv.totalAmount - inv.paidAmount);
          if (inv.balanceDue <= 0.01) {
            inv.status = 'paid';
            inv.paidAt = new Date();
          } else {
            inv.status = 'partial';
          }
          await inv.save();
        }
      }
    }

    ok(res, payment, 'Payment allocated');
  } catch (err: any) {
    console.error('allocatePayment error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. BANK ACCOUNTS// ═══════════════════════════════════════════════════════════════════════════

export async function listBankAccounts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { isActive, onlyDeleted } = req.query;
    const filter: any = { isDeleted: onlyDeleted === 'true' };
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const accounts = await BankAccount.find(filter)
      .populate('glAccountId', 'accountId name type')
      .sort({ isDefault: -1, bankName: 1 });

    ok(res, accounts);
  } catch (err: any) {
    console.error('listBankAccounts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createBankAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      accountName, accountNumber, accountType, bankName,
      branchName, branchCode, iban, swiftCode, routingNumber,
      currency, openingBalance, glAccountId, isDefault,
    } = req.body;

    if (!accountName) {
      bad(res, 'accountName required');
      return;
    }
    if (!accountNumber) {
      bad(res, 'accountNumber required');
      return;
    }
    if (!bankName) {
      bad(res, 'bankName required');
      return;
    }
    if (!glAccountId || !isValidObjectId(glAccountId)) {
      bad(res, 'Valid glAccountId required');
      return;
    }

    const glAccount = await Account.findById(glAccountId);
    if (!glAccount) {
      bad(res, 'GL Account not found', 404);
      return;
    }

    if (accountType && !BANK_ACCOUNT_TYPES.includes(accountType)) {
      bad(res, `accountType must be one of: ${BANK_ACCOUNT_TYPES.join(', ')}`);
      return;
    }

    if (isDefault === true) {
      await BankAccount.updateMany({}, { $set: { isDefault: false } });
    }

    const opening = round2(num(openingBalance) ?? 0);

    const doc = new BankAccount({
      accountName: String(accountName).trim(),
      accountNumber: String(accountNumber).trim(),
      accountType: accountType || 'current',
      bankName: String(bankName).trim(),
      branchName: str(branchName, 200),
      branchCode: str(branchCode, 40),
      iban: str(iban, 34)?.toUpperCase(),
      swiftCode: str(swiftCode, 20)?.toUpperCase(),
      routingNumber: str(routingNumber, 40),
      currency: str(currency, 3)?.toUpperCase() || 'PKR',
      openingBalance: opening,
      currentBalance: opening,
      availableBalance: opening,
      glAccountId: glAccount._id,
      isDefault: isDefault === true,
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await doc.save();

    glAccount.linkedBankAccountId = doc._id;
    glAccount.isBankAccount = true;
    await glAccount.save();

    ok(res, doc, 'Bank account created', 201);
  } catch (err: any) {
    console.error('createBankAccount error:', err);
    if (err?.code === 11000) {
      res.status(409).json({ success: false, message: 'Bank account already exists' });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateBankAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.bankAccountId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid bank account id');
      return;
    }

    const doc = await BankAccount.findOne({ _id: id, isDeleted: false });
    if (!doc) {
      bad(res, 'Bank account not found', 404);
      return;
    }

    const {
      accountName, accountNumber, accountType, bankName,
      branchName, branchCode, iban, swiftCode, routingNumber,
      currency, isActive, isDefault,
    } = req.body;

    if (accountName !== undefined) doc.accountName = String(accountName).trim();
    if (accountNumber !== undefined) doc.accountNumber = String(accountNumber).trim();
    if (accountType !== undefined) doc.accountType = accountType;
    if (bankName !== undefined) doc.bankName = String(bankName).trim();
    if (branchName !== undefined) doc.branchName = str(branchName, 200);
    if (branchCode !== undefined) doc.branchCode = str(branchCode, 40);
    if (iban !== undefined) doc.iban = str(iban, 34)?.toUpperCase();
    if (swiftCode !== undefined) doc.swiftCode = str(swiftCode, 20)?.toUpperCase();
    if (routingNumber !== undefined) doc.routingNumber = str(routingNumber, 40);
    if (currency !== undefined) doc.currency = String(currency).toUpperCase();
    if (isActive !== undefined) doc.isActive = isActive === true;
    if (isDefault !== undefined) {
      if (isDefault === true) {
        await BankAccount.updateMany({ _id: { $ne: doc._id } }, { $set: { isDefault: false } });
      }
      doc.isDefault = isDefault === true;
    }

    doc.updatedBy = req.user?._id ?? null;
    await doc.save();

    ok(res, doc, 'Bank account updated');
  } catch (err: any) {
    console.error('updateBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteBankAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.bankAccountId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid bank account id');
      return;
    }

    const doc = await BankAccount.findOne({ _id: id, isDeleted: false });
    if (!doc) {
      bad(res, 'Bank account not found', 404);
      return;
    }

    const txCount = await BankTransaction.countDocuments({
      bankAccountId: doc._id,
      isDeleted: false,
    });
    if (txCount > 0 && !req.user!.isMainAdmin) {
      bad(res, `Cannot delete — ${txCount} transactions exist`);
      return;
    }

    doc.isDeleted = true;
    doc.isActive = false;
    doc.updatedBy = req.user?._id ?? null;
    await doc.save();

    ok(res, null, 'Bank account deleted');
  } catch (err: any) {
    console.error('deleteBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. BANK TRANSACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function listBankTransactions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      bankAccountId, transactionType, status,
      from, to, search, onlyDeleted,
      page = '1', limit = '100', sort = '-transactionDate',
    } = req.query;

    const filter: any = { isDeleted: onlyDeleted === 'true' };
    if (bankAccountId) {
      if (!isValidObjectId(bankAccountId)) {
        bad(res, 'Invalid bankAccountId');
        return;
      }
      filter.bankAccountId = bankAccountId;
    }
    if (transactionType) {
      const list = String(transactionType).split(',').map((s) => s.trim());
      filter.transactionType = list.length === 1 ? list[0] : { $in: list };
    }
    if (status) {
      const list = String(status).split(',').map((s) => s.trim());
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.transactionDate = {};
      if (range.from) filter.transactionDate.$gte = range.from;
      if (range.to) filter.transactionDate.$lte = range.to;
    }

    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } },
        { counterpartyName: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [txs, total] = await Promise.all([
      BankTransaction.find(filter)
        .populate('bankAccountId', 'accountId bankName accountNumber currency')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      BankTransaction.countDocuments(filter),
    ]);

    ok(res, {
      transactions: txs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listBankTransactions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createBankTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      bankAccountId, transactionType, transactionDate, valueDate,
      amount, description, reference, chequeNumber,
      counterpartyName, counterpartyAccount,
    } = req.body;

    if (!bankAccountId || !isValidObjectId(bankAccountId)) {
      bad(res, 'Valid bankAccountId required');
      return;
    }
    if (!BANK_TRANSACTION_TYPES.includes(transactionType)) {
      bad(res, `transactionType must be one of: ${BANK_TRANSACTION_TYPES.join(', ')}`);
      return;
    }
    const amt = num(amount);
    if (amt === undefined || amt <= 0) {
      bad(res, 'amount must be > 0');
      return;
    }
    if (!description) {
      bad(res, 'description required');
      return;
    }

    const bankAcc = await BankAccount.findOne({ _id: bankAccountId, isDeleted: false });
    if (!bankAcc) {
      bad(res, 'Bank account not found', 404);
      return;
    }

    const last = await BankTransaction.findOne({
      bankAccountId: bankAcc._id,
      isDeleted: false,
    }).sort({ transactionDate: -1, createdAt: -1 });

    const prevBalance = last?.runningBalance ?? bankAcc.openingBalance ?? 0;
    const isCredit = ['deposit', 'transfer_in', 'interest'].includes(transactionType);
    const signedAmount = isCredit ? amt : -amt;
    const newBalance = round2(prevBalance + signedAmount);

    const doc = new BankTransaction({
      bankAccountId: bankAcc._id,
      transactionType,
      transactionDate: date(transactionDate) ?? new Date(),
      valueDate: date(valueDate),
      amount: round2(amt),
      signedAmount,
      runningBalance: newBalance,
      currency: bankAcc.currency,
      description: String(description).trim().slice(0, 500),
      reference: str(reference, 100),
      chequeNumber: str(chequeNumber, 60),
      counterpartyName: str(counterpartyName, 200),
      counterpartyAccount: str(counterpartyAccount, 60),
      status: 'unreconciled',
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await doc.save();

    bankAcc.currentBalance = newBalance;
    bankAcc.availableBalance = newBalance;
    await bankAcc.save();

    // ── Post to Bank Book ──
    try {
      const glAcc = bankAcc.glAccountId
        ? await Account.findById(bankAcc.glAccountId).lean()
        : null;

      if (glAcc) {
  await postBookEntry({
  bookType: 'bank_book',
  accountCode: glAcc.accountId,
  bankAccountId: bankAcc._id,
  entryDate: doc.transactionDate,
  description: doc.description,
  reference: doc.reference || doc.transactionId,
  receiptAmount: isCredit ? doc.amount : 0,
  paymentAmount: isCredit ? 0 : doc.amount, 
  journalEntryId: null,
  paymentId: null,
  bankTransactionId: doc._id,   // ← add this
});
      }
    } catch (bookErr: any) {
      console.warn('Bank book entry post failed:', bookErr.message);
    }

    ok(res, doc, 'Bank transaction created', 201);
  } catch (err: any) {
    console.error('createBankTransaction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function reconcileBankTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.transactionId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid transaction id');
      return;
    }

    const doc = await BankTransaction.findOne({ _id: id, isDeleted: false });
    if (!doc) {
      bad(res, 'Transaction not found', 404);
      return;
    }
    if (doc.status === 'reconciled') {
      bad(res, 'Already reconciled');
      return;
    }

    doc.status = 'reconciled';
    doc.reconciledAt = new Date();
    doc.reconciledBy = req.user?._id ?? null;
    doc.updatedBy = req.user?._id ?? null;
    await doc.save();

    ok(res, doc, 'Transaction reconciled');
  } catch (err: any) {
    console.error('reconcileBankTransaction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function unreconcileBankTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.transactionId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid transaction id');
      return;
    }

    const doc = await BankTransaction.findOne({ _id: id, isDeleted: false });
    if (!doc) {
      bad(res, 'Transaction not found', 404);
      return;
    }
    if (doc.status !== 'reconciled') {
      bad(res, 'Not reconciled');
      return;
    }

    doc.status = 'unreconciled';
    doc.reconciledAt = undefined;
    doc.reconciledBy = null;
    doc.reconciliationId = null;
    doc.updatedBy = req.user?._id ?? null;
    await doc.save();

    ok(res, doc, 'Transaction unreconciled');
  } catch (err: any) {
    console.error('unreconcileBankTransaction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function voidBankTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.transactionId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid transaction id');
      return;
    }

    const doc = await BankTransaction.findOne({ _id: id, isDeleted: false });
    if (!doc) {
      bad(res, 'Transaction not found', 404);
      return;
    }
    if (doc.status === 'void') {
      bad(res, 'Already voided');
      return;
    }

    doc.status = 'void';
    doc.updatedBy = req.user?._id ?? null;
    await doc.save();

    ok(res, doc, 'Transaction voided');
  } catch (err: any) {
    console.error('voidBankTransaction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. BANK RECONCILIATION
// ═══════════════════════════════════════════════════════════════════════════

export async function createBankReconciliation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      bankAccountId, statementDate, statementStartDate,
      openingBalance, closingBalance, transactionIds, notes,
    } = req.body;

    if (!bankAccountId || !isValidObjectId(bankAccountId)) {
      bad(res, 'Valid bankAccountId required');
      return;
    }
    if (!statementDate || !statementStartDate) {
      bad(res, 'statementDate and statementStartDate required');
      return;
    }

    const bankAcc = await BankAccount.findOne({ _id: bankAccountId, isDeleted: false });
    if (!bankAcc) {
      bad(res, 'Bank account not found', 404);
      return;
    }

    const txs = Array.isArray(transactionIds)
      ? await BankTransaction.find({ _id: { $in: transactionIds }, isDeleted: false }).lean()
      : [];

    const clearedBalance = round2(
      txs.reduce((s, t: any) => s + (t.signedAmount || 0), 0)
    );

    const closingBal = round2(num(closingBalance) ?? bankAcc.currentBalance);
    const openingBal = round2(num(openingBalance) ?? bankAcc.openingBalance);
    const difference = round2(closingBal - clearedBalance);

    const doc = new BankReconciliation({
      bankAccountId: bankAcc._id,
      statementDate: date(statementDate)!,
      statementStartDate: date(statementStartDate)!,
      openingBalance: openingBal,
      closingBalance: closingBal,
      bookBalance: bankAcc.currentBalance,
      clearedBalance,
      difference,
      transactionIds: txs.map((t: any) => t._id),
      status: 'in_progress',
      notes: str(notes, 2000),
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await doc.save();
    ok(res, doc, 'Bank reconciliation started', 201);
  } catch (err: any) {
    console.error('createBankReconciliation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function completeBankReconciliation(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.reconciliationId);
    if (!isValidObjectId(id)) {
      bad(res, 'Invalid reconciliation id');
      return;
    }

    const doc = await BankReconciliation.findById(id);
    if (!doc) {
      bad(res, 'Reconciliation not found', 404);
      return;
    }
    if (doc.status !== 'in_progress') {
      bad(res, `Cannot complete a ${doc.status} reconciliation`);
      return;
    }

    await BankTransaction.updateMany(
      { _id: { $in: doc.transactionIds } },
      {
        $set: {
          status: 'reconciled',
          reconciliationId: doc._id,
          reconciledAt: new Date(),
          reconciledBy: req.user?._id ?? null,
        },
      }
    );

    doc.status = 'completed';
    doc.completedAt = new Date();
    doc.completedBy = req.user?._id ?? null;
    doc.updatedBy = req.user?._id ?? null;
    await doc.save();

    ok(res, doc, 'Bank reconciliation completed');
  } catch (err: any) {
    console.error('completeBankReconciliation error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. LEDGER ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export async function getClientLedger(req: AuthRequest, res: Response): Promise<void> {
  try {
    const clientId = asString(req.params.clientId);
    if (!isValidObjectId(clientId)) {
      bad(res, 'Invalid clientId');
      return;
    }

    const { from, to } = req.query;
    const filter: any = { clientId, isDeleted: false };

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.entryDate = {};
      if (range.from) filter.entryDate.$gte = range.from;
      if (range.to) filter.entryDate.$lte = range.to;
    }

    const entries = await LedgerEntry.find(filter).sort({ entryDate: 1, createdAt: 1 });

    let running = 0;
    const decorated = entries.map((e) => {
      running += (e.debit || 0) - (e.credit || 0);
      return {
        ...e.toObject(),
        computedBalance: round2(running),
      };
    });

    ok(res, {
      clientId,
      entries: decorated,
      closingBalance: round2(running),
    });
  } catch (err: any) {
    console.error('getClientLedger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getProviderLedger(req: AuthRequest, res: Response): Promise<void> {
  try {
    const providerId = asString(req.params.providerId);
    if (!isValidObjectId(providerId)) {
      bad(res, 'Invalid providerId');
      return;
    }

    const { from, to } = req.query;
    const filter: any = { providerId, isDeleted: false };

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.entryDate = {};
      if (range.from) filter.entryDate.$gte = range.from;
      if (range.to) filter.entryDate.$lte = range.to;
    }

    const entries = await LedgerEntry.find(filter).sort({ entryDate: 1, createdAt: 1 });

    let running = 0;
    const decorated = entries.map((e) => {
      running += (e.credit || 0) - (e.debit || 0);
      return {
        ...e.toObject(),
        computedBalance: round2(running),
      };
    });

    ok(res, {
      providerId,
      entries: decorated,
      closingBalance: round2(running),
    });
  } catch (err: any) {
    console.error('getProviderLedger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createManualLedgerEntry(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      accountCode, partyType, clientId, providerId, employeeId,
      entryDate, description, reference,
      debit, credit, dueDate,
    } = req.body;

    if (!accountCode) {
      bad(res, 'accountCode required');
      return;
    }
    if (!['client', 'provider', 'employee', 'other'].includes(partyType)) {
      bad(res, 'partyType must be client|provider|employee|other');
      return;
    }
    if (!entryDate) {
      bad(res, 'entryDate required');
      return;
    }
    if (!description) {
      bad(res, 'description required');
      return;
    }

    const debitAmt = round2(num(debit) ?? 0);
    const creditAmt = round2(num(credit) ?? 0);
    if (debitAmt === 0 && creditAmt === 0) {
      bad(res, 'Either debit or credit is required');
      return;
    }
    if (debitAmt > 0 && creditAmt > 0) {
      bad(res, 'Cannot have both debit and credit on same entry');
      return;
    }

    const defaultCounterpartyCode = debitAmt > 0 ? '4010' : '6180';
    const je = await postJournalEntry({
      entryDate: date(entryDate)!,
      description: String(description),
      source: 'manual',
      referenceType: 'Manual',
      lines: debitAmt > 0
        ? [
            { accountCode, debit: debitAmt },
            { accountCode: defaultCounterpartyCode, credit: debitAmt },
          ]
        : [
            { accountCode: defaultCounterpartyCode, debit: creditAmt },
            { accountCode, credit: creditAmt },
          ],
      createdBy: req.user?._id ?? null,
    });

    const ledger = await postLedgerEntry({
      accountCode,
      partyType,
      clientId: clientId || null,
      providerId: providerId || null,
      employeeId: employeeId || null,
      journalEntryId: je._id,
      entryDate: date(entryDate)!,
      description: String(description),
      reference: str(reference, 100),
      referenceType: 'Manual',
      referenceId: je._id,
      debit: debitAmt,
      credit: creditAmt,
      dueDate: date(dueDate),
    });

    ok(res, { journalEntry: je, ledgerEntry: ledger }, 'Ledger entry created', 201);
  } catch (err: any) {
    console.error('createManualLedgerEntry error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. BOOK ENTRIES
// ═══════════════════════════════════════════════════════════════════════════

export async function getCashBook(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { from, to } = req.query;
    const filter: any = { bookType: 'cash_book', isDeleted: false };

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.entryDate = {};
      if (range.from) filter.entryDate.$gte = range.from;
      if (range.to) filter.entryDate.$lte = range.to;
    }

    const entries = await BookEntry.find(filter).sort({ entryDate: 1, createdAt: 1 });

    const totalReceipts = round2(entries.reduce((s, e) => s + (e.receiptAmount || 0), 0));
    const totalPayments = round2(entries.reduce((s, e) => s + (e.paymentAmount || 0), 0));

    const cashAccount = await Account.findOne({
      isCashAccount: true,
      isDeleted: false,
    })
      .select('accountId name currency currentBalance openingBalance')
      .lean();

    ok(res, {
      cashAccount,
      entries,
      totalReceipts,
      totalPayments,
      netMovement: round2(totalReceipts - totalPayments),
    });
  } catch (err: any) {
    console.error('getCashBook error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getBankBook(req: AuthRequest, res: Response): Promise<void> {
  try {
    const bankAccountId = asString(req.params.bankAccountId);
    if (!isValidObjectId(bankAccountId)) {
      bad(res, 'Invalid bankAccountId');
      return;
    }

    const { from, to } = req.query;
    const filter: any = { bookType: 'bank_book', bankAccountId, isDeleted: false };

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.entryDate = {};
      if (range.from) filter.entryDate.$gte = range.from;
      if (range.to) filter.entryDate.$lte = range.to;
    }

    const entries = await BookEntry.find(filter).sort({ entryDate: 1, createdAt: 1 });

    const totalReceipts = round2(entries.reduce((s, e) => s + (e.receiptAmount || 0), 0));
    const totalPayments = round2(entries.reduce((s, e) => s + (e.paymentAmount || 0), 0));

    const bankAccount = await BankAccount.findById(bankAccountId)
      .populate('glAccountId', 'accountId name')
      .lean();

    ok(res, {
      bankAccount,
      entries,
      totalReceipts,
      totalPayments,
      netMovement: round2(totalReceipts - totalPayments),
    });
  } catch (err: any) {
    console.error('getBankBook error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. REPORTS
// ═══════════════════════════════════════════════════════════════════════════

export async function trialBalanceReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const fiscalYear = Number(req.query.fiscalYear);
    const fiscalPeriod = Number(req.query.fiscalPeriod);

    if (!Number.isInteger(fiscalYear) || !Number.isInteger(fiscalPeriod)) {
      bad(res, 'fiscalYear and fiscalPeriod required');
      return;
    }
    if (fiscalPeriod < 1 || fiscalPeriod > 12) {
      bad(res, 'fiscalPeriod must be 1..12');
      return;
    }

    const result = await getTrialBalance(fiscalYear, fiscalPeriod);
    ok(res, result);
  } catch (err: any) {
    console.error('trialBalanceReport error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function receivablesAgingReport(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await getReceivablesAging();

    const ids = rows.map((r) => r.partyId);
    const clients = await Client.find({ _id: { $in: ids } }).select('clientId name');
    const map = new Map(clients.map((c) => [String(c._id), c]));

    const enriched = rows.map((r) => ({
      ...r,
      partyName: map.get(String(r.partyId))?.name ?? '(unknown)',
      clientCode: map.get(String(r.partyId))?.clientId,
    }));

    const totals = enriched.reduce(
      (acc, r) => {
        acc.current += r.current;
        acc.d1_30 += r.d1_30;
        acc.d31_60 += r.d31_60;
        acc.d61_90 += r.d61_90;
        acc.d91_120 += r.d91_120;
        acc.over120 += r.over120;
        acc.total += r.total;
        return acc;
      },
      { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_120: 0, over120: 0, total: 0 }
    );

    Object.keys(totals).forEach((k) => {
      (totals as any)[k] = round2((totals as any)[k]);
    });

    ok(res, { rows: enriched, totals });
  } catch (err: any) {
    console.error('receivablesAgingReport error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function payablesAgingReport(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await getPayablesAging();

    const providerIds = rows.filter(r => r.partyType === 'provider').map(r => r.partyId);
    const adhocIds = rows.filter(r => r.partyType === 'adhoc').map(r => r.partyId);

    const providers = await Provider.find({ _id: { $in: providerIds } }).select('name category');
    const providerMap = new Map(providers.map((p) => [String(p._id), p]));

    const adhocExpenses = await ProviderExpense.find({ _id: { $in: adhocIds } }).select('payeeName category');
    const adhocMap = new Map(adhocExpenses.map((e) => [String(e._id), e]));

    const enriched = rows.map((r) => {
      if (r.partyType === 'provider') {
        const p = providerMap.get(String(r.partyId));
        return {
          ...r,
          partyName: p?.name ?? '(unknown provider)',
          category: p?.category,
        };
      } else {
        const e = adhocMap.get(String(r.partyId));
        return {
          ...r,
          partyName: e?.payeeName ?? '(unknown payee)',
          category: e?.category,
        };
      }
    });

    const totals = enriched.reduce(
      (acc, r) => {
        acc.current += r.current;
        acc.d1_30 += r.d1_30;
        acc.d31_60 += r.d31_60;
        acc.d61_90 += r.d61_90;
        acc.d91_120 += r.d91_120;
        acc.over120 += r.over120;
        acc.total += r.total;
        return acc;
      },
      { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d91_120: 0, over120: 0, total: 0 }
    );

    Object.keys(totals).forEach((k) => {
      (totals as any)[k] = round2((totals as any)[k]);
    });

    ok(res, { rows: enriched, totals });
  } catch (err: any) {
    console.error('payablesAgingReport error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function accountLedgerReport(req: AuthRequest, res: Response): Promise<void> {
  try {
    const accountId = asString(req.params.accountId);
    if (!isValidObjectId(accountId)) {
      bad(res, 'Invalid accountId');
      return;
    }

    const { from, to } = req.query;
    const filter: any = {
      'lines.accountId': accountId,
      status: 'posted',
      isDeleted: false,
    };

    const range = parseDateRange(from as string, to as string);
    if (range.from || range.to) {
      filter.entryDate = {};
      if (range.from) filter.entryDate.$gte = range.from;
      if (range.to) filter.entryDate.$lte = range.to;
    }

    const entries = await JournalEntry.find(filter).sort({ entryDate: 1, createdAt: 1 });

    const account = await Account.findById(accountId).lean();
    const rows: any[] = [];
    let runningDebit = 0;
    let runningCredit = 0;

    for (const entry of entries) {
      for (const line of entry.lines) {
        if (String(line.accountId) !== String(accountId)) continue;
        runningDebit += line.debit || 0;
        runningCredit += line.credit || 0;
        rows.push({
          entryId: entry.entryId,
          entryDate: entry.entryDate,
          description: line.description ?? entry.description,
          reference: entry.reference,
          debit: line.debit,
          credit: line.credit,
          runningDebit: round2(runningDebit),
          runningCredit: round2(runningCredit),
          netBalance: round2(runningDebit - runningCredit),
        });
      }
    }

    ok(res, {
      account,
      entries: rows,
      totals: {
        totalDebit: round2(runningDebit),
        totalCredit: round2(runningCredit),
        netBalance: round2(runningDebit - runningCredit),
      },
    });
  } catch (err: any) {
    console.error('accountLedgerReport error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function dashboardSummary(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalReceivable,
      totalPayable,
      unpaidInvoicesCount,
      overdueInvoicesCount,
      recentPayments,
      recentJEs,
      openPeriods,
    ] = await Promise.all([
      Invoice.aggregate([
        { $match: { isDeleted: false, balanceDue: { $gt: 0 } } },
        { $group: { _id: null, total: { $sum: '$balanceDue' } } },
      ]),
      LedgerEntry.aggregate([
        { $match: { partyType: 'provider', isSettled: false, isDeleted: false } },
        { $group: { _id: null, total: { $sum: { $subtract: ['$credit', '$debit'] } } } },
      ]),
      Invoice.countDocuments({
        isDeleted: false,
        balanceDue: { $gt: 0 },
        status: { $in: ['sent', 'viewed', 'partial', 'overdue'] },
      }),
      Invoice.countDocuments({
        isDeleted: false,
        balanceDue: { $gt: 0 },
        dueDate: { $lt: now },
        status: { $in: ['sent', 'viewed', 'partial', 'overdue'] },
      }),
      Payment.find({ isDeleted: false, paymentDate: { $gte: startOfMonth } })
        .sort({ paymentDate: -1 })
        .limit(5)
        .select('paymentNumber direction method amount paymentDate clientId providerId')
        .populate('clientId', 'name')
        .populate('providerId', 'name'),
      JournalEntry.find({ isDeleted: false, status: 'posted' })
        .sort({ postedAt: -1 })
        .limit(5)
        .select('entryId description entryDate totalDebit totalCredit source'),
      FiscalPeriod.countDocuments({ status: 'open' }),
    ]);

    ok(res, {
      receivables: {
        totalOutstanding: round2(totalReceivable[0]?.total ?? 0),
        unpaidInvoices: unpaidInvoicesCount,
        overdueInvoices: overdueInvoicesCount,
      },
      payables: {
        totalOutstanding: round2(totalPayable[0]?.total ?? 0),
      },
      recentPayments,
      recentJournalEntries: recentJEs,
      openFiscalPeriods: openPeriods,
    });
  } catch (err: any) {
    console.error('dashboardSummary error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 13. POSTING RULES
// ═══════════════════════════════════════════════════════════════════════════

export async function listPostingRules(_req: AuthRequest, res: Response): Promise<void> {
  try {
    ok(res, getPostingRules());
  } catch (err: any) {
    console.error('listPostingRules error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function registerRule(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user!.isMainAdmin) {
      bad(res, 'Only main admin can register posting rules', 403);
      return;
    }

    const { source, event, debitAccount, creditAccount, descriptionTemplate } = req.body;
    if (!source || !event || !debitAccount || !creditAccount) {
      bad(res, 'source, event, debitAccount, creditAccount required');
      return;
    }
    if (!JOURNAL_ENTRY_SOURCES.includes(source)) {
      bad(res, `Invalid source`);
      return;
    }

    registerPostingRule({
      source,
      event,
      debitAccount,
      creditAccount,
      descriptionTemplate,
    });

    ok(res, getPostingRules(), 'Posting rule registered');
  } catch (err: any) {
    console.error('registerRule error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function registerRuleBatch(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user!.isMainAdmin) {
      bad(res, 'Only main admin can register posting rules', 403);
      return;
    }

    const { rules } = req.body;
    if (!Array.isArray(rules) || rules.length === 0) {
      bad(res, 'rules must be a non-empty array');
      return;
    }

    registerPostingRules(rules);
    ok(res, getPostingRules(), `${rules.length} posting rules registered`);
  } catch (err: any) {
    console.error('registerRuleBatch error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 14. INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════

export async function postProviderExpenseToGL(req: AuthRequest, res: Response): Promise<void> {
  try {
    const expenseId = asString(req.params.expenseId);
    if (!isValidObjectId(expenseId)) {
      bad(res, 'Invalid expense id');
      return;
    }

    const expense = await ProviderExpense.findOne({ _id: expenseId, isDeleted: false });
    if (!expense) {
      bad(res, 'Provider expense not found', 404);
      return;
    }

    const apAccount = await Account.findOne({ isPayable: true, isControlAccount: true, isDeleted: false });
    const defaultExpenseAccount = await Account.findOne({
      type: 'expense',
      subType: 'operating_expense',
      isDeleted: false,
    });

    if (!apAccount || !defaultExpenseAccount) {
      bad(res, 'Required accounts not set up (AP control + expense)');
      return;
    }

    const existing = await JournalEntry.findOne({
      referenceType: 'ProviderExpense',
      referenceId: expense._id,
      isDeleted: false,
    });
    if (existing) {
      bad(res, `Journal entry already exists: ${existing.entryId}`, 409);
      return;
    }

    const je = await postJournalEntry({
      entryDate: expense.expenseDate,
      description: `Provider expense: ${expense.description || expense.category}`,
      source: 'provider_expense',
      referenceType: 'ProviderExpense',
      referenceId: expense._id,
      currency: expense.currency,
      lines: [
        {
          accountCode: defaultExpenseAccount.accountId,
          debit: expense.amount,
          providerId: expense.provider,
        },
        {
          accountCode: apAccount.accountId,
          credit: expense.amount,
          providerId: expense.provider,
        },
      ],
      createdBy: req.user?._id ?? null,
    });

    await postLedgerEntry({
      accountCode: apAccount.accountId,
      partyType: expense.provider ? 'provider' : 'other',
      providerId: expense.provider || null,
      journalEntryId: je._id,
      entryDate: expense.expenseDate,
      description: `Provider expense: ${expense.description || expense.category}`,
      referenceType: 'ProviderExpense',
      referenceId: expense._id,
      credit: expense.amount,
      dueDate: expense.paidAt || new Date(expense.expenseDate.getTime() + 30 * 86_400_000),
      providerExpenseId: expense._id,
    });

    ok(res, { journalEntry: je }, 'Provider expense posted to GL', 201);
  } catch (err: any) {
    console.error('postProviderExpenseToGL error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function downloadInvoicePdf(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const id = asString(req.params.invoiceId);
    if (!id) {
      bad(res, 'invoiceId required');
      return;
    }

    const query = isValidObjectId(id) ? { _id: id } : { invoiceId: id };
    const invoice = await Invoice.findOne({ ...query, isDeleted: false })
      .populate('clientId', 'clientId name displayName email phoneNo addresses ntn')
      .lean();

    if (!invoice) {
      bad(res, 'Invoice not found', 404);
      return;
    }

    const buffer = await generateInvoicePdf(invoice as any, {
      companyName: process.env.COMPANY_NAME || 'CS_ERP',
      companyAddress: process.env.COMPANY_ADDRESS || '',
      companyEmail: process.env.COMPANY_EMAIL || '',
      companyPhone: process.env.COMPANY_PHONE || '',
      companyNtn: process.env.COMPANY_NTN || '',
    });

    const safeName = (invoice.invoiceNumber || 'invoice').replace(
      /[^a-z0-9-]/gi,
      '_'
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${safeName}.pdf"`
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (err: any) {
    console.error('downloadInvoicePdf error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getBankTransaction(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.transactionId);
    if (!id) {
      bad(res, 'transactionId required');
      return;
    }

    const query = isValidObjectId(id) ? { _id: id } : { transactionId: id };
    const tx = await BankTransaction.findOne({ ...query, isDeleted: false })
      .populate('bankAccountId', 'accountId bankName accountNumber accountName currency')
      .lean();

    if (!tx) {
      bad(res, 'Bank transaction not found', 404);
      return;
    }
    ok(res, tx);
  } catch (err: any) {
    console.error('getBankTransaction error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getBankAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const id = asString(req.params.bankAccountId);
    if (!id) {
      bad(res, 'bankAccountId required');
      return;
    }

    const query = isValidObjectId(id) ? { _id: id } : { accountId: id };
    const account = await BankAccount.findOne({ ...query, isDeleted: false })
      .populate('glAccountId', 'accountId name type subType')
      .lean();

    if (!account) {
      bad(res, 'Bank account not found', 404);
      return;
    }
    ok(res, account);
  } catch (err: any) {
    console.error('getBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}