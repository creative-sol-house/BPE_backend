// controller/providerController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Provider, {
  PROVIDER_STATUSES,
} from '../model/Provider';
import ProviderExpense, {
  EXPENSE_PERIOD_TYPES,
  EXPENSE_STATUSES,
  PAYMENT_METHODS,
  PAYABLE_TYPES,
} from '../model/ProviderExpense';
import { AuthRequest } from '../middleware/auth';

// ══════════════════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════════════════
function bad(res: Response, msg: string, code = 400): void {
  res.status(code).json({ success: false, message: msg });
}

function round2(n: number) {
  return +Number(n).toFixed(2);
}

/**
 * Express 5 types `req.params.x` as `string | string[]`. We always want
 * a single string here, so coerce defensively and validate.
 */
function isValidObjectId(id: unknown): boolean {
  if (id === undefined || id === null) return false;
  const s = Array.isArray(id) ? id[0] : String(id);
  return mongoose.Types.ObjectId.isValid(s);
}

/** Coerce a param/query value to a single trimmed string. */
function asString(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return String(v[0] ?? '');
  return String(v);
}

function cleanCategory(v: any): string {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, 80);
}

// ══════════════════════════════════════════════════════════════════════════
// PROVIDER — CRUD
// ══════════════════════════════════════════════════════════════════════════

export async function listProviders(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { search, category, status, page = '1', limit = '20' } = req.query;

    const filter: any = { isDeleted: false };
    if (category) filter.category = asString(category).trim();
    if (status && (PROVIDER_STATUSES as string[]).includes(asString(status))) {
      filter.status = asString(status);
    }
    if (search) {
      const rx = {
        $regex: asString(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
      filter.$or = [
        { name: rx },
        { category: rx },
        { contactPerson: rx },
        { phoneNo: rx },
        { email: rx },
      ];
    }

    const pageNum = Math.max(1, parseInt(asString(page) || '1'));
    const limitNum = Math.min(100, Math.max(1, parseInt(asString(limit) || '20')));
    const skip = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      Provider.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Provider.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listProviders error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getProvider(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const providerId = asString(req.params.providerId);
    if (!isValidObjectId(providerId)) return bad(res, 'Invalid provider id');

    const doc = await Provider.findOne({ _id: providerId, isDeleted: false });
    if (!doc) return bad(res, 'Provider not found', 404);

    res.json({ success: true, data: doc });
  } catch (err: any) {
    console.error('getProvider error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createProvider(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      name, category, contactPerson, phoneNo, email, address,
      cnic, ntn, bankDetails, paymentTerms, status, notes,
    } = req.body;

    if (!name || String(name).trim().length < 2) {
      return bad(res, 'Provider name is required');
    }
    if (status && !(PROVIDER_STATUSES as string[]).includes(status)) {
      return bad(res, `Invalid status. Allowed: ${PROVIDER_STATUSES.join(', ')}`);
    }

    const doc = new Provider({
      name: String(name).trim(),
      category: cleanCategory(category),
      contactPerson: contactPerson ? String(contactPerson).trim() : undefined,
      phoneNo: phoneNo ? String(phoneNo).trim() : undefined,
      email: email ? String(email).trim().toLowerCase() : undefined,
      address: address ? String(address).trim() : undefined,
      cnic: cnic ? String(cnic).trim() : undefined,
      ntn: ntn ? String(ntn).trim() : undefined,
      bankDetails: bankDetails || undefined,
      paymentTerms: paymentTerms ? String(paymentTerms).trim() : undefined,
      status: status || 'active',
      notes: notes ? String(notes).trim() : undefined,
      createdBy: req.user!._id,
    });

    await doc.save();
    res.status(201).json({ success: true, data: doc });
  } catch (err: any) {
    console.error('createProvider error:', err);
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({ success: false, message: `${field} already exists` });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProvider(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const providerId = asString(req.params.providerId);
    if (!isValidObjectId(providerId)) return bad(res, 'Invalid provider id');

    const doc = await Provider.findOne({ _id: providerId, isDeleted: false });
    if (!doc) return bad(res, 'Provider not found', 404);

    const {
      name, category, contactPerson, phoneNo, email, address,
      cnic, ntn, bankDetails, paymentTerms, status, notes,
    } = req.body;

    if (name !== undefined) doc.name = String(name).trim();
    if (category !== undefined) doc.category = cleanCategory(category);
    if (contactPerson !== undefined) doc.contactPerson = contactPerson || undefined;
    if (phoneNo !== undefined) doc.phoneNo = phoneNo || undefined;
    if (email !== undefined) doc.email = email ? String(email).trim().toLowerCase() : undefined;
    if (address !== undefined) doc.address = address || undefined;
    if (cnic !== undefined) doc.cnic = cnic || undefined;
    if (ntn !== undefined) doc.ntn = ntn || undefined;
    if (bankDetails !== undefined) doc.bankDetails = bankDetails || undefined;
    if (paymentTerms !== undefined) doc.paymentTerms = paymentTerms || undefined;
    if (status !== undefined) {
      if (!(PROVIDER_STATUSES as string[]).includes(status)) {
        return bad(res, `Invalid status`);
      }
      doc.status = status;
    }
    if (notes !== undefined) doc.notes = notes || undefined;

    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err: any) {
    console.error('updateProvider error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteProvider(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const providerId = asString(req.params.providerId);
    if (!isValidObjectId(providerId)) return bad(res, 'Invalid provider id');

    const doc = await Provider.findOne({ _id: providerId, isDeleted: false });
    if (!doc) return bad(res, 'Provider not found', 404);

    const pendingCount = await ProviderExpense.countDocuments({
      provider: doc._id,
      status: 'pending',
      isDeleted: false,
    });
    if (pendingCount > 0 && !req.user!.isMainAdmin) {
      return bad(
        res,
        `Cannot delete — ${pendingCount} pending expense(s). Mark them paid/cancelled first or ask a main admin.`
      );
    }

    doc.isDeleted = true;
    doc.status = 'inactive';
    await doc.save();
    res.json({ success: true, message: 'Provider deleted' });
  } catch (err: any) {
    console.error('deleteProvider error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// EXPENSE / PAYABLE — CRUD (unified: provider_bill + adhoc)
// ══════════════════════════════════════════════════════════════════════════

export async function listExpenses(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      providerId, category, status, periodType, payableType,
      year, month, weekOf, from, to, search,
      page = '1', limit = '50',
    } = req.query;

    const filter: any = { isDeleted: false };

    // ── Filter: payable type (provider_bill | adhoc) ──────────────────
    if (payableType && PAYABLE_TYPES.includes(asString(payableType) as any)) {
      filter.payableType = asString(payableType);
    }

    if (providerId) {
      const pid = asString(providerId);
      if (!isValidObjectId(pid)) {
        return bad(res, 'Invalid providerId');
      }
      filter.provider = pid;
    }
    if (category) filter.category = asString(category).trim();
    if (status) {
      const list = asString(status)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      filter.status = list.length === 1 ? list[0] : { $in: list };
    }
    if (
      periodType &&
      (EXPENSE_PERIOD_TYPES as string[]).includes(asString(periodType))
    ) {
      filter['period.type'] = asString(periodType);
    }

    if (year && month) {
      const y = Number(year);
      const m = Number(month);
      if (
        !Number.isInteger(y) || y < 2000 || y > 2100 ||
        !Number.isInteger(m) || m < 1 || m > 12
      ) {
        return bad(res, 'Invalid year or month');
      }
      filter['period.type'] = 'monthly';
      filter['period.year'] = y;
      filter['period.month'] = m;
    }

    if (weekOf) {
      const d = new Date(asString(weekOf));
      if (Number.isNaN(d.getTime())) return bad(res, 'Invalid weekOf date');
      filter['period.type'] = 'weekly';
      filter['period.weekStart'] = { $lte: d };
      filter['period.weekEnd'] = { $gte: d };
    }

    if (from || to) {
      filter.expenseDate = {};
      if (from) {
        const f = new Date(asString(from));
        f.setUTCHours(0, 0, 0, 0);
        filter.expenseDate.$gte = f;
      }
      if (to) {
        const t = new Date(asString(to));
        t.setUTCHours(23, 59, 59, 999);
        filter.expenseDate.$lte = t;
      }
    }

    if (search) {
      const rx = {
        $regex: asString(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        $options: 'i',
      };
      filter.$or = [
        { invoiceNo: rx },
        { description: rx },
        { notes: rx },
        { category: rx },
        { payeeName: rx },
        { payeeContact: rx },
      ];
    }

    const pageNum = Math.max(1, parseInt(asString(page) || '1'));
    const limitNum = Math.min(200, Math.max(1, parseInt(asString(limit) || '50')));
    const skip = (pageNum - 1) * limitNum;

    const [rows, total] = await Promise.all([
      ProviderExpense.find(filter)
        .populate('provider', 'name category status')
        .populate('paidBy', 'name')
        .sort({ expenseDate: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      ProviderExpense.countDocuments(filter),
    ]);

    const agg = await ProviderExpense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$status',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);
    const byStatus: Record<string, { total: number; count: number }> = {};
    for (const r of agg) {
      byStatus[r._id] = { total: round2(r.total), count: r.count };
    }

    const grandTotal = round2(
      Object.values(byStatus).reduce((s, v) => s + (v.total || 0), 0)
    );

    // ── Type totals ────────────────────────────────────────────────────
    const typeAgg = await ProviderExpense.aggregate([
      { $match: filter },
      {
        $group: {
          _id: '$payableType',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
    ]);
    const byType: Record<string, { total: number; count: number }> = {};
    for (const r of typeAgg) {
      byType[r._id || 'provider_bill'] = {
        total: round2(r.total),
        count: r.count,
      };
    }

    res.json({
      success: true,
      data: rows,
      totals: { grandTotal, byStatus, byType },
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listExpenses error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getExpense(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const expenseId = asString(req.params.expenseId);
    if (!isValidObjectId(expenseId)) return bad(res, 'Invalid expense id');

    const doc = await ProviderExpense.findOne({
      _id: expenseId,
      isDeleted: false,
    })
      .populate('provider', 'name category status bankDetails')
      .populate('paidBy', 'name');
    if (!doc) return bad(res, 'Expense not found', 404);

    res.json({ success: true, data: doc });
  } catch (err: any) {
    console.error('getExpense error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createExpense(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const {
      payableType: rawPayableType,
      providerId,
      payeeName, payeeContact, payeeEmail, payeePhone,
      amount, currency, expenseDate,
      category, period, status, invoiceNo, description, notes,
      paymentMethod,
    } = req.body;

    // ── Resolve payable type ──────────────────────────────────────────
    const payableType: 'provider_bill' | 'adhoc' =
      rawPayableType === 'adhoc' ? 'adhoc' : 'provider_bill';

    let provider: any = null;

    if (payableType === 'provider_bill') {
      // Provider bill requires a real provider
      if (!providerId || !isValidObjectId(providerId)) {
        return bad(res, 'Valid providerId is required for provider bills');
      }
      provider = await Provider.findOne({
        _id: providerId,
        isDeleted: false,
      });
      if (!provider) return bad(res, 'Provider not found', 404);
    } else {
      // Ad-hoc: payeeName is required, provider must be absent
      if (!payeeName || !String(payeeName).trim()) {
        return bad(res, 'payeeName is required for ad-hoc payables');
      }
    }

    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      return bad(res, 'amount must be greater than 0');
    }

    if (!expenseDate) return bad(res, 'expenseDate is required');
    const d = new Date(expenseDate);
    if (Number.isNaN(d.getTime())) return bad(res, 'Invalid expenseDate');

    if (!period || typeof period !== 'object') {
      return bad(res, 'period is required');
    }
    if (!(EXPENSE_PERIOD_TYPES as string[]).includes(period.type)) {
      return bad(res, `period.type must be one of: ${EXPENSE_PERIOD_TYPES.join(', ')}`);
    }

    if (status && !(EXPENSE_STATUSES as string[]).includes(status)) {
      return bad(res, `Invalid status`);
    }
    if (
      paymentMethod &&
      !(PAYMENT_METHODS as string[]).includes(paymentMethod)
    ) {
      return bad(res, `Invalid paymentMethod`);
    }

    // ── Category default ─────────────────────────────────────────────
    const finalCategory =
      category !== undefined && category !== null && String(category).trim() !== ''
        ? cleanCategory(category)
        : provider?.category || '';

    // ── Period normalization ─────────────────────────────────────────
    const normalizedPeriod: any = { type: period.type };
    if (period.type === 'monthly') {
      const y = Number(period.year);
      const m = Number(period.month);
      if (
        !Number.isInteger(y) || y < 2000 || y > 2100 ||
        !Number.isInteger(m) || m < 1 || m > 12
      ) {
        return bad(res, 'monthly period requires year (2000-2100) and month (1-12)');
      }
      normalizedPeriod.year = y;
      normalizedPeriod.month = m;
    } else if (period.type === 'weekly') {
      if (!period.weekStart || !period.weekEnd) {
        return bad(res, 'weekly period requires weekStart and weekEnd');
      }
      const ws = new Date(period.weekStart);
      const we = new Date(period.weekEnd);
      if (Number.isNaN(ws.getTime()) || Number.isNaN(we.getTime())) {
        return bad(res, 'Invalid weekStart/weekEnd');
      }
      ws.setUTCHours(0, 0, 0, 0);
      we.setUTCHours(23, 59, 59, 999);
      if (ws > we) return bad(res, 'weekStart must be before weekEnd');
      normalizedPeriod.weekStart = ws;
      normalizedPeriod.weekEnd = we;
    }

    const doc = new ProviderExpense({
      payableType,
      provider: provider ? provider._id : null,

      // Ad-hoc fields (only meaningful when payableType === 'adhoc')
      payeeName: payableType === 'adhoc' ? String(payeeName).trim() : undefined,
      payeeContact: payeeContact ? String(payeeContact).trim() : undefined,
      payeeEmail: payeeEmail ? String(payeeEmail).trim().toLowerCase() : undefined,
      payeePhone: payeePhone ? String(payeePhone).trim() : undefined,

      amount: round2(amt),
      currency: currency ? String(currency).toUpperCase() : 'PKR',
      expenseDate: d,
      category: finalCategory,
      period: normalizedPeriod,
      status: status || 'pending',
      invoiceNo: invoiceNo ? String(invoiceNo).trim() : undefined,
      description: description ? String(description).trim() : undefined,
      notes: notes ? String(notes).trim() : undefined,
      paymentMethod: paymentMethod || undefined,
      createdBy: req.user!._id,
    });

    await doc.save();

    const populated = await ProviderExpense.findById(doc._id)
      .populate('provider', 'name category status')
      .lean();

    res.status(201).json({ success: true, data: populated });
  } catch (err: any) {
    console.error('createExpense error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateExpense(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const expenseId = asString(req.params.expenseId);
    if (!isValidObjectId(expenseId)) return bad(res, 'Invalid expense id');

    const doc = await ProviderExpense.findOne({
      _id: expenseId,
      isDeleted: false,
    });
    if (!doc) return bad(res, 'Expense not found', 404);

    const {
      amount, currency, expenseDate, category, period,
      status, invoiceNo, description, notes, paymentMethod, paidAt,
      payeeName, payeeContact, payeeEmail, payeePhone,
    } = req.body;

    // ── Ad-hoc payee fields (only allowed if this expense is already adhoc) ──
    if (doc.payableType === 'adhoc') {
      if (payeeName !== undefined) {
        const pn = String(payeeName).trim();
        if (!pn) return bad(res, 'payeeName cannot be empty');
        doc.payeeName = pn;
      }
      if (payeeContact !== undefined) {
        doc.payeeContact = payeeContact ? String(payeeContact).trim() : undefined;
      }
      if (payeeEmail !== undefined) {
        doc.payeeEmail = payeeEmail
          ? String(payeeEmail).trim().toLowerCase()
          : undefined;
      }
      if (payeePhone !== undefined) {
        doc.payeePhone = payeePhone ? String(payeePhone).trim() : undefined;
      }
    }

    if (amount !== undefined) {
      const amt = Number(amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return bad(res, 'amount must be greater than 0');
      }
      doc.amount = round2(amt);
    }
    if (currency !== undefined) doc.currency = String(currency).toUpperCase();
    if (expenseDate !== undefined) {
      const d = new Date(expenseDate);
      if (Number.isNaN(d.getTime())) return bad(res, 'Invalid expenseDate');
      doc.expenseDate = d;
    }
    if (category !== undefined) doc.category = cleanCategory(category);

    if (period !== undefined && typeof period === 'object') {
      const p: any = { type: period.type ?? doc.period.type };
      if (p.type === 'monthly') {
        p.year = Number(period.year ?? doc.period.year);
        p.month = Number(period.month ?? doc.period.month);
        if (
          !Number.isInteger(p.year) ||
          !Number.isInteger(p.month) ||
          p.month < 1 || p.month > 12
        ) {
          return bad(res, 'monthly period needs valid year and month');
        }
      } else if (p.type === 'weekly') {
        const ws = new Date(period.weekStart ?? doc.period.weekStart);
        const we = new Date(period.weekEnd ?? doc.period.weekEnd);
        if (Number.isNaN(ws.getTime()) || Number.isNaN(we.getTime())) {
          return bad(res, 'weekly period needs valid weekStart/weekEnd');
        }
        ws.setUTCHours(0, 0, 0, 0);
        we.setUTCHours(23, 59, 59, 999);
        if (ws > we) return bad(res, 'weekStart must be before weekEnd');
        p.weekStart = ws;
        p.weekEnd = we;
      }
      doc.period = p;
    }

    if (status !== undefined) {
      if (!(EXPENSE_STATUSES as string[]).includes(status)) {
        return bad(res, `Invalid status`);
      }
      doc.status = status;
      if (status === 'paid' && !doc.paidAt) {
        doc.paidAt = new Date();
        doc.paidBy = req.user!._id;
      }
    }
    if (paidAt !== undefined) {
      doc.paidAt = paidAt ? new Date(paidAt) : null;
    }
    if (invoiceNo !== undefined) doc.invoiceNo = invoiceNo || undefined;
    if (description !== undefined) doc.description = description || undefined;
    if (notes !== undefined) doc.notes = notes || undefined;
    if (paymentMethod !== undefined) {
      if (
        paymentMethod &&
        !(PAYMENT_METHODS as string[]).includes(paymentMethod)
      ) {
        return bad(res, `Invalid paymentMethod`);
      }
      doc.paymentMethod = paymentMethod || undefined;
    }

    await doc.save();
    const populated = await ProviderExpense.findById(doc._id)
      .populate('provider', 'name category status')
      .populate('paidBy', 'name')
      .lean();

    res.json({ success: true, data: populated });
  } catch (err: any) {
    console.error('updateExpense error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Mark paid (convenience endpoint)
export async function markExpensePaid(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const expenseId = asString(req.params.expenseId);
    const { paymentMethod, paidAt } = req.body;
    if (!isValidObjectId(expenseId)) return bad(res, 'Invalid expense id');

    const doc = await ProviderExpense.findOne({
      _id: expenseId,
      isDeleted: false,
    });
    if (!doc) return bad(res, 'Expense not found', 404);
    if (doc.status === 'paid') return bad(res, 'Already marked paid');

    if (
      paymentMethod &&
      !(PAYMENT_METHODS as string[]).includes(paymentMethod)
    ) {
      return bad(res, `Invalid paymentMethod`);
    }

    doc.status = 'paid';
    doc.paidAt = paidAt ? new Date(paidAt) : new Date();
    doc.paidBy = req.user!._id;
    if (paymentMethod) doc.paymentMethod = paymentMethod;

    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err: any) {
    console.error('markExpensePaid error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteExpense(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const expenseId = asString(req.params.expenseId);
    if (!isValidObjectId(expenseId)) return bad(res, 'Invalid expense id');

    const doc = await ProviderExpense.findOne({
      _id: expenseId,
      isDeleted: false,
    });
    if (!doc) return bad(res, 'Expense not found', 404);

    doc.isDeleted = true;
    await doc.save();
    res.json({ success: true, message: 'Expense deleted' });
  } catch (err: any) {
    console.error('deleteExpense error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ══════════════════════════════════════════════════════════════════════════
// LEDGER — per-provider month/week summaries
// ══════════════════════════════════════════════════════════════════════════

// Monthly ledger for a provider (or all providers if no providerId)
export async function monthlyLedger(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { year, month, providerId } = req.query;
    const y = Number(year);
    const m = Number(month);
    if (
      !Number.isInteger(y) || y < 2000 || y > 2100 ||
      !Number.isInteger(m) || m < 1 || m > 12
    ) {
      return bad(res, 'Valid year and month are required');
    }

    const match: any = {
      isDeleted: false,
      'period.type': 'monthly',
      'period.year': y,
      'period.month': m,
    };
    if (providerId) {
      const pid = asString(providerId);
      if (!isValidObjectId(pid)) return bad(res, 'Invalid providerId');
      match.provider = new mongoose.Types.ObjectId(pid);
    }

    const rows = await ProviderExpense.aggregate([
      { $match: match },
      {
        $group: {
          _id: { provider: '$provider', status: '$status' },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.provider',
          byStatus: {
            $push: {
              status: '$_id.status',
              total: '$total',
              count: '$count',
            },
          },
          grandTotal: { $sum: '$total' },
        },
      },
      {
        $lookup: {
          from: 'providers',
          localField: '_id',
          foreignField: '_id',
          as: 'provider',
        },
      },
      { $unwind: { path: '$provider', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          provider: {
            _id: '$provider._id',
            name: '$provider.name',
            category: '$provider.category',
            status: '$provider.status',
          },
          byStatus: 1,
          grandTotal: 1,
        },
      },
      { $sort: { 'provider.name': 1 } },
    ]);

    const overallTotal = round2(rows.reduce((s, r) => s + r.grandTotal, 0));

    res.json({
      success: true,
      data: {
        period: { year: y, month: m },
        rows,
        overallTotal,
      },
    });
  } catch (err: any) {
    console.error('monthlyLedger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Weekly ledger for a provider (weekOf = any date inside the week)
export async function weeklyLedger(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { weekOf, providerId } = req.query;
    if (!weekOf) return bad(res, 'weekOf is required');

    const d = new Date(asString(weekOf));
    if (Number.isNaN(d.getTime())) return bad(res, 'Invalid weekOf');

    const match: any = {
      isDeleted: false,
      'period.type': 'weekly',
      'period.weekStart': { $lte: d },
      'period.weekEnd': { $gte: d },
    };
    if (providerId) {
      const pid = asString(providerId);
      if (!isValidObjectId(pid)) return bad(res, 'Invalid providerId');
      match.provider = new mongoose.Types.ObjectId(pid);
    }

    const rows = await ProviderExpense.aggregate([
      { $match: match },
      {
        $group: {
          _id: { provider: '$provider', status: '$status' },
          total: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      {
        $group: {
          _id: '$_id.provider',
          byStatus: {
            $push: { status: '$_id.status', total: '$total', count: '$count' },
          },
          grandTotal: { $sum: '$total' },
        },
      },
      {
        $lookup: {
          from: 'providers',
          localField: '_id',
          foreignField: '_id',
          as: 'provider',
        },
      },
      { $unwind: { path: '$provider', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          provider: {
            _id: '$provider._id',
            name: '$provider.name',
            category: '$provider.category',
          },
          byStatus: 1,
          grandTotal: 1,
        },
      },
      { $sort: { 'provider.name': 1 } },
    ]);

    const overallTotal = round2(rows.reduce((s, r) => s + r.grandTotal, 0));

    res.json({
      success: true,
      data: {
        weekOf: d,
        rows,
        overallTotal,
      },
    });
  } catch (err: any) {
    console.error('weeklyLedger error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// Distinct category values present in DB — for autocomplete in the UI
export async function listCategories(
  _req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const [fromProviders, fromExpenses] = await Promise.all([
      Provider.distinct('category', { isDeleted: false, category: { $ne: '' } }),
      ProviderExpense.distinct('category', { isDeleted: false, category: { $ne: '' } }),
    ]);
    const set = new Set<string>();
    for (const c of [...fromProviders, ...fromExpenses]) {
      if (c && String(c).trim()) set.add(String(c).trim());
    }
    const data = [...set].sort((a, b) => a.localeCompare(b));
    res.json({ success: true, data });
  } catch (err: any) {
    console.error('listCategories error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}