// controller/employeeBankAccountController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Employee from '../model/employee';
import EmployeeBankAccount, {
  EMPLOYEE_BANK_ACCOUNT_TYPES,
  type EmployeeBankAccountStatus,
} from '../model/EmployeeBankAccount';
import { AuthRequest } from '../middleware/auth';

// ── Helpers ─────────────────────────────────────────────────────
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
function str(v: unknown, max?: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return max ? s.slice(0, max) : s;
}

// ── Controllers ─────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════
// PER-EMPLOYEE (NESTED) CONTROLLERS
// ═════════════════════════════════════════════════════════════════

export async function listEmployeeBankAccounts(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const employeeId = asString(req.params.employeeId);
    if (!isValidObjectId(employeeId)) {
      bad(res, 'Invalid employee id');
      return;
    }

    const employee = await Employee.findOne({
      _id: employeeId,
      isDeleted: false,
    }).select('_id name employeeId');
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const accounts = await EmployeeBankAccount.find({
      employee: employeeId,
      isDeleted: false,
    }).sort({ isPrimary: -1, createdAt: -1 });

    ok(res, { employee, accounts });
  } catch (err: any) {
    console.error('listEmployeeBankAccounts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getEmployeeBankAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = asString(req.params.accountId);
    if (!isValidObjectId(accountId)) {
      bad(res, 'Invalid bank account id');
      return;
    }

    const account = await EmployeeBankAccount.findOne({
      _id: accountId,
      isDeleted: false,
    })
      .populate('employee', 'name employeeId department designation')
      .populate('verifiedBy', 'name email');

    if (!account) {
      bad(res, 'Bank account not found', 404);
      return;
    }
    ok(res, account);
  } catch (err: any) {
    console.error('getEmployeeBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createEmployeeBankAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const employeeId = asString(req.params.employeeId);
    if (!isValidObjectId(employeeId)) {
      bad(res, 'Invalid employee id');
      return;
    }

    const employee = await Employee.findOne({
      _id: employeeId,
      isDeleted: false,
    });
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const {
      bankName,
      accountTitle,
      accountNumber,
      accountType,
      branchName,
      branchCode,
      branchAddress,
      iban,
      swiftCode,
      routingNumber,
      currency,
      isPrimary,
      notes,
    } = req.body;

    if (!bankName || !String(bankName).trim()) {
      bad(res, 'bankName is required');
      return;
    }
    if (!accountTitle || !String(accountTitle).trim()) {
      bad(res, 'accountTitle is required');
      return;
    }
    if (!accountNumber || !String(accountNumber).trim()) {
      bad(res, 'accountNumber is required');
      return;
    }
    if (accountType && !EMPLOYEE_BANK_ACCOUNT_TYPES.includes(accountType)) {
      bad(
        res,
        `accountType must be one of: ${EMPLOYEE_BANK_ACCOUNT_TYPES.join(', ')}`
      );
      return;
    }

    const existing = await EmployeeBankAccount.findOne({
      employee: employeeId,
      bankName: String(bankName).trim(),
      accountNumber: String(accountNumber).trim(),
      isDeleted: false,
    });
    if (existing) {
      bad(
        res,
        'This bank account is already registered for this employee',
        409
      );
      return;
    }

    const existingCount = await EmployeeBankAccount.countDocuments({
      employee: employeeId,
      isDeleted: false,
    });
    const makePrimary = isPrimary === true || existingCount === 0;

    if (makePrimary) {
      await EmployeeBankAccount.clearPrimary(employeeId);
    }

    const doc = new EmployeeBankAccount({
      employee: employee._id,
      user: employee.user ?? null,

      bankName: String(bankName).trim(),
      accountTitle: String(accountTitle).trim(),
      accountNumber: String(accountNumber).trim(),
      accountType: accountType || 'savings',

      branchName: str(branchName, 200),
      branchCode: str(branchCode, 40),
      branchAddress: str(branchAddress, 500),

      iban: str(iban, 34)?.toUpperCase(),
      swiftCode: str(swiftCode, 20)?.toUpperCase(),
      routingNumber: str(routingNumber, 40),

      currency: str(currency, 3)?.toUpperCase() || 'PKR',
      isPrimary: makePrimary,
      status: 'pending',

      notes: str(notes, 1000),

      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await doc.save();
    ok(res, doc, 'Bank account added', 201);
  } catch (err: any) {
    console.error('createEmployeeBankAccount error:', err);
    if (err?.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'Duplicate bank account for this employee',
      });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateEmployeeBankAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = asString(req.params.accountId);
    if (!isValidObjectId(accountId)) {
      bad(res, 'Invalid bank account id');
      return;
    }

    const account = await EmployeeBankAccount.findOne({
      _id: accountId,
      isDeleted: false,
    });
    if (!account) {
      bad(res, 'Bank account not found', 404);
      return;
    }

    const {
      bankName,
      accountTitle,
      accountNumber,
      accountType,
      branchName,
      branchCode,
      branchAddress,
      iban,
      swiftCode,
      routingNumber,
      currency,
      isPrimary,
      notes,
    } = req.body;

    if (bankName !== undefined) account.bankName = String(bankName).trim();
    if (accountTitle !== undefined)
      account.accountTitle = String(accountTitle).trim();
    if (accountNumber !== undefined)
      account.accountNumber = String(accountNumber).trim();
    if (accountType !== undefined) {
      if (!EMPLOYEE_BANK_ACCOUNT_TYPES.includes(accountType)) {
        bad(res, 'Invalid accountType');
        return;
      }
      account.accountType = accountType;
    }
    if (branchName !== undefined) account.branchName = str(branchName, 200);
    if (branchCode !== undefined) account.branchCode = str(branchCode, 40);
    if (branchAddress !== undefined)
      account.branchAddress = str(branchAddress, 500);
    if (iban !== undefined) account.iban = str(iban, 34)?.toUpperCase();
    if (swiftCode !== undefined)
      account.swiftCode = str(swiftCode, 20)?.toUpperCase();
    if (routingNumber !== undefined)
      account.routingNumber = str(routingNumber, 40);
    if (currency !== undefined)
      account.currency = String(currency).toUpperCase();
    if (notes !== undefined) account.notes = str(notes, 1000);

    if (isPrimary !== undefined) {
      if (isPrimary === true) {
        await EmployeeBankAccount.clearPrimary(account.employee, account._id);
        account.isPrimary = true;
      } else {
        // Prevent leaving the employee without any primary account
        const otherPrimary = await EmployeeBankAccount.findOne({
          employee: account.employee,
          isPrimary: true,
          _id: { $ne: account._id },
          isDeleted: false,
        });

        if (!otherPrimary) {
          const next = await EmployeeBankAccount.findOne({
            employee: account.employee,
            _id: { $ne: account._id },
            isDeleted: false,
          }).sort({ createdAt: -1 });

          if (next) {
            next.isPrimary = true;
            next.updatedBy = req.user?._id ?? null;
            await next.save();
          }
        }
        account.isPrimary = false;
      }
    }

    account.updatedBy = req.user?._id ?? null;
    await account.save();

    ok(res, account, 'Bank account updated');
  } catch (err: any) {
    console.error('updateEmployeeBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function setPrimaryEmployeeBankAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = asString(req.params.accountId);
    if (!isValidObjectId(accountId)) {
      bad(res, 'Invalid bank account id');
      return;
    }

    const account = await EmployeeBankAccount.findOne({
      _id: accountId,
      isDeleted: false,
    });
    if (!account) {
      bad(res, 'Bank account not found', 404);
      return;
    }

    await EmployeeBankAccount.clearPrimary(account.employee, account._id);

    account.isPrimary = true;
    account.updatedBy = req.user?._id ?? null;
    await account.save();

    ok(res, account, 'Primary account updated');
  } catch (err: any) {
    console.error('setPrimaryEmployeeBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function verifyEmployeeBankAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = asString(req.params.accountId);
    if (!isValidObjectId(accountId)) {
      bad(res, 'Invalid bank account id');
      return;
    }

    const { status, rejectionReason } = req.body;
    if (!['verified', 'rejected'].includes(status)) {
      bad(res, "status must be 'verified' or 'rejected'");
      return;
    }

    const account = await EmployeeBankAccount.findOne({
      _id: accountId,
      isDeleted: false,
    });
    if (!account) {
      bad(res, 'Bank account not found', 404);
      return;
    }

    account.status = status as EmployeeBankAccountStatus;
    if (status === 'verified') {
      account.verifiedAt = new Date();
      account.verifiedBy = req.user?._id ?? null;
      account.rejectionReason = undefined;
    } else {
      account.rejectionReason = str(rejectionReason, 500);
    }
    account.updatedBy = req.user?._id ?? null;
    await account.save();

    ok(res, account, `Bank account ${status}`);
  } catch (err: any) {
    console.error('verifyEmployeeBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function deleteEmployeeBankAccount(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const accountId = asString(req.params.accountId);
    if (!isValidObjectId(accountId)) {
      bad(res, 'Invalid bank account id');
      return;
    }

    const account = await EmployeeBankAccount.findOne({
      _id: accountId,
      isDeleted: false,
    });
    if (!account) {
      bad(res, 'Bank account not found', 404);
      return;
    }

    const wasPrimary = account.isPrimary;

    account.isDeleted = true;
    account.isPrimary = false;
    account.updatedBy = req.user?._id ?? null;
    await account.save();

    // If it was primary, promote another one
    if (wasPrimary) {
      const next = await EmployeeBankAccount.findOne({
        employee: account.employee,
        isDeleted: false,
      }).sort({ createdAt: -1 });
      if (next) {
        next.isPrimary = true;
        await next.save();
      }
    }

    ok(res, null, 'Bank account deleted');
  } catch (err: any) {
    console.error('deleteEmployeeBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════
// FLAT / STANDALONE CONTROLLERS
// ═════════════════════════════════════════════════════════════════

export async function listAllBankAccounts(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const page = Math.max(1, parseInt(asString(req.query.page) || '1', 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(asString(req.query.limit) || '20', 10))
    );
    const skip = (page - 1) * limit;

    const filter: Record<string, any> = { isDeleted: false };

    const employeeId = asString(req.query.employeeId);
    if (employeeId) {
      if (!isValidObjectId(employeeId)) {
        bad(res, 'Invalid employeeId filter');
        return;
      }
      filter.employee = employeeId;
    }

    const status = asString(req.query.status);
    if (status) filter.status = status;

    const accountType = asString(req.query.accountType);
    if (accountType) filter.accountType = accountType;

    const isPrimaryRaw = asString(req.query.isPrimary);
    if (isPrimaryRaw === 'true' || isPrimaryRaw === 'false') {
      filter.isPrimary = isPrimaryRaw === 'true';
    }

    const bankName = asString(req.query.bankName);
    if (bankName) filter.bankName = new RegExp(bankName, 'i');

    const search = asString(req.query.search);
    if (search) {
      const rx = new RegExp(search, 'i');
      filter.$or = [
        { bankName: rx },
        { accountTitle: rx },
        { accountNumber: rx },
        { iban: rx },
      ];
    }

    const [accounts, total] = await Promise.all([
      EmployeeBankAccount.find(filter)
        .populate('employee', 'name employeeId department designation')
        .sort({ isPrimary: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
      EmployeeBankAccount.countDocuments(filter),
    ]);

    ok(res, {
      accounts,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (err: any) {
    console.error('listAllBankAccounts error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createBankAccountFlat(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const employeeId = asString(req.body.employeeId);
    if (!isValidObjectId(employeeId)) {
      bad(res, 'Invalid or missing employeeId in body');
      return;
    }

    const employee = await Employee.findOne({
      _id: employeeId,
      isDeleted: false,
    });
    if (!employee) {
      bad(res, 'Employee not found', 404);
      return;
    }

    const {
      bankName,
      accountTitle,
      accountNumber,
      accountType,
      branchName,
      branchCode,
      branchAddress,
      iban,
      swiftCode,
      routingNumber,
      currency,
      isPrimary,
      notes,
    } = req.body;

    if (!bankName || !String(bankName).trim()) {
      bad(res, 'bankName is required');
      return;
    }
    if (!accountTitle || !String(accountTitle).trim()) {
      bad(res, 'accountTitle is required');
      return;
    }
    if (!accountNumber || !String(accountNumber).trim()) {
      bad(res, 'accountNumber is required');
      return;
    }
    if (accountType && !EMPLOYEE_BANK_ACCOUNT_TYPES.includes(accountType)) {
      bad(
        res,
        `accountType must be one of: ${EMPLOYEE_BANK_ACCOUNT_TYPES.join(', ')}`
      );
      return;
    }

    const existing = await EmployeeBankAccount.findOne({
      employee: employeeId,
      bankName: String(bankName).trim(),
      accountNumber: String(accountNumber).trim(),
      isDeleted: false,
    });
    if (existing) {
      bad(
        res,
        'This bank account is already registered for this employee',
        409
      );
      return;
    }

    const existingCount = await EmployeeBankAccount.countDocuments({
      employee: employeeId,
      isDeleted: false,
    });
    const makePrimary = isPrimary === true || existingCount === 0;

    if (makePrimary) {
      await EmployeeBankAccount.clearPrimary(employeeId);
    }

    const doc = new EmployeeBankAccount({
      employee: employee._id,
      user: employee.user ?? null,

      bankName: String(bankName).trim(),
      accountTitle: String(accountTitle).trim(),
      accountNumber: String(accountNumber).trim(),
      accountType: accountType || 'savings',

      branchName: str(branchName, 200),
      branchCode: str(branchCode, 40),
      branchAddress: str(branchAddress, 500),

      iban: str(iban, 34)?.toUpperCase(),
      swiftCode: str(swiftCode, 20)?.toUpperCase(),
      routingNumber: str(routingNumber, 40),

      currency: str(currency, 3)?.toUpperCase() || 'PKR',
      isPrimary: makePrimary,
      status: 'pending',

      notes: str(notes, 1000),

      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await doc.save();
    ok(res, doc, 'Bank account added', 201);
  } catch (err: any) {
    console.error('createBankAccountFlat error:', err);
    if (err?.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'Duplicate bank account for this employee',
      });
      return;
    }
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function getBankAccountFlat(
  req: AuthRequest,
  res: Response
): Promise<void> {
  return getEmployeeBankAccount(req, res);
}

export async function updateBankAccountFlat(
  req: AuthRequest,
  res: Response
): Promise<void> {
  return updateEmployeeBankAccount(req, res);
}

export async function setPrimaryBankAccountFlat(
  req: AuthRequest,
  res: Response
): Promise<void> {
  return setPrimaryEmployeeBankAccount(req, res);
}

export async function verifyBankAccountFlat(
  req: AuthRequest,
  res: Response
): Promise<void> {
  return verifyEmployeeBankAccount(req, res);
}

export async function deleteBankAccountFlat(
  req: AuthRequest,
  res: Response
): Promise<void> {
  return deleteEmployeeBankAccount(req, res);
}