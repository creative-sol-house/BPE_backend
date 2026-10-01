// controller/clientController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Client, {
  CLIENT_TYPES,
  CLIENT_STATUSES,
  CLIENT_TIERS,
  DUE_ON_RECEIPT,
  isValidPaymentTerms,
  type ClientStatus,
  type ClientType,
  type ClientTier,
  type PaymentTerms,
} from '../model/client';
import Employee from '../model/employee';
import { AuthRequest } from '../middleware/auth';

// ─── Helpers ──────────────────────────────────────────────────────────────
const EMAIL_RE = /^\S+@\S+\.\S+$/;

function validateContacts(input: any): { ok: boolean; error?: string; parsed?: any[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'contacts must be an array' };
  if (input.length > 50) return { ok: false, error: 'Too many contacts (max 50)' };

  const parsed: any[] = [];
  let primaryCount = 0;

  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (!c || typeof c !== 'object') {
      return { ok: false, error: `contacts[${i}] is invalid` };
    }
    const name = String(c.name || '').trim();
    if (!name) return { ok: false, error: `contacts[${i}].name is required` };
    if (name.length > 120) {
      return { ok: false, error: `contacts[${i}].name too long (max 120)` };
    }

    const email = c.email ? String(c.email).trim().toLowerCase() : undefined;
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, error: `contacts[${i}].email is invalid` };
    }

    const isPrimary = c.isPrimary === true;
    if (isPrimary) primaryCount++;
    if (primaryCount > 1) {
      return { ok: false, error: 'Only one primary contact is allowed' };
    }

    parsed.push({
      name,
      designation: c.designation ? String(c.designation).trim().slice(0, 120) : undefined,
      email,
      phoneNo: c.phoneNo ? String(c.phoneNo).trim().slice(0, 30) : undefined,
      isPrimary,
    });
  }
  return { ok: true, parsed };
}

function validateAddresses(input: any): { ok: boolean; error?: string; parsed?: any[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'addresses must be an array' };
  if (input.length > 50) return { ok: false, error: 'Too many addresses (max 50)' };

  const parsed: any[] = [];
  const seen = new Set<string>();
  let defaultCount = 0;

  for (let i = 0; i < input.length; i++) {
    const a = input[i];
    if (!a || typeof a !== 'object') {
      return { ok: false, error: `addresses[${i}] is invalid` };
    }
    const label = String(a.label || '').trim().toLowerCase();
    const line1 = String(a.line1 || '').trim();
    const city = String(a.city || '').trim();
    const country = String(a.country || 'Pakistan').trim();

    if (!label) return { ok: false, error: `addresses[${i}].label is required` };
    if (!line1) return { ok: false, error: `addresses[${i}].line1 is required` };
    if (!city) return { ok: false, error: `addresses[${i}].city is required` };
    if (!country) return { ok: false, error: `addresses[${i}].country is required` };

    if (seen.has(label)) {
      return { ok: false, error: `Duplicate address label "${label}"` };
    }
    seen.add(label);

    const isDefault = a.isDefault === true;
    if (isDefault) defaultCount++;

    parsed.push({
      label,
      line1: line1.slice(0, 200),
      line2: a.line2 ? String(a.line2).trim().slice(0, 200) : undefined,
      city: city.slice(0, 100),
      state: a.state ? String(a.state).trim().slice(0, 100) : undefined,
      postalCode: a.postalCode ? String(a.postalCode).trim().slice(0, 20) : undefined,
      country: country.slice(0, 100),
      isDefault,
    });
  }
  return { ok: true, parsed };
}

function validateBankAccounts(input: any): { ok: boolean; error?: string; parsed?: any[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'bankAccounts must be an array' };
  if (input.length > 20) return { ok: false, error: 'Too many bank accounts (max 20)' };

  const parsed: any[] = [];
  let primaryCount = 0;

  for (let i = 0; i < input.length; i++) {
    const b = input[i];
    if (!b || typeof b !== 'object') {
      return { ok: false, error: `bankAccounts[${i}] is invalid` };
    }
    const bankName = String(b.bankName || '').trim();
    const accountTitle = String(b.accountTitle || '').trim();
    const accountNumber = String(b.accountNumber || '').trim();

    if (!bankName) return { ok: false, error: `bankAccounts[${i}].bankName is required` };
    if (!accountTitle) return { ok: false, error: `bankAccounts[${i}].accountTitle is required` };
    if (!accountNumber) return { ok: false, error: `bankAccounts[${i}].accountNumber is required` };

    const isPrimary = b.isPrimary === true;
    if (isPrimary) primaryCount++;
    if (primaryCount > 1) {
      return { ok: false, error: 'Only one primary bank account is allowed' };
    }

    parsed.push({
      bankName: bankName.slice(0, 120),
      accountTitle: accountTitle.slice(0, 120),
      accountNumber: accountNumber.slice(0, 50),
      iban: b.iban ? String(b.iban).trim().toUpperCase().slice(0, 34) : undefined,
      branch: b.branch ? String(b.branch).trim().slice(0, 120) : undefined,
      isPrimary,
    });
  }
  return { ok: true, parsed };
}

// ═════════════════════════════════════════════════════════════════════════
// CREATE CLIENT
//   POST /api/clients
// ═════════════════════════════════════════════════════════════════════════
export async function createClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      // required
      name,
      clientType,
      phoneNo,
      // optional identity
      displayName,
      email,
      alternatePhoneNo,
      website,
      // legal / tax
      cnic,
      ntn,
      strn,
      registrationNo,
      // categorization
      industry,
      tier,
      // arrays
      contacts,
      addresses,
      bankAccounts,
      // financial
      creditLimit,
      openingBalance,
      currency,
      paymentTerms,
      taxExempt,
      // status
      status,
      statusReason,
      // relationships
      accountManager,
      // ❌ REMOVED: user
    } = req.body;

    // ── 1. Required fields ───────────────────────────────────────────────
    const required: Record<string, any> = { name, clientType, phoneNo };
    const missing = Object.entries(required)
      .filter(([, v]) => v === undefined || v === null || v === '')
      .map(([k]) => k);

    if (missing.length) {
      res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`,
      });
      return;
    }

    // ── 1b. Enum checks ──────────────────────────────────────────────────
    if (!CLIENT_TYPES.includes(clientType)) {
      res.status(400).json({
        success: false,
        message: `Invalid clientType. Allowed: ${CLIENT_TYPES.join(', ')}`,
      });
      return;
    }

    if (tier !== undefined && !CLIENT_TIERS.includes(tier)) {
      res.status(400).json({
        success: false,
        message: `Invalid tier. Allowed: ${CLIENT_TIERS.join(', ')}`,
      });
      return;
    }

    if (status !== undefined && !CLIENT_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${CLIENT_STATUSES.join(', ')}`,
      });
      return;
    }

    // ── 1c. Email check ──────────────────────────────────────────────────
    if (email !== undefined && email !== null && email !== '') {
      if (!EMAIL_RE.test(String(email))) {
        res.status(400).json({ success: false, message: 'Invalid email format' });
        return;
      }
    }

    // ── 1d. paymentTerms check ───────────────────────────────────────────
    if (paymentTerms !== undefined) {
      if (typeof paymentTerms !== 'string' || !isValidPaymentTerms(paymentTerms)) {
        res.status(400).json({
          success: false,
          message:
            "paymentTerms must be either 'due_on_receipt' or a numeric string between 0 and 365",
        });
        return;
      }
    }

    // ── 1e. Validate contacts / addresses / bankAccounts ─────────────────
    const contactsRes = validateContacts(contacts);
    if (!contactsRes.ok) {
      res.status(400).json({ success: false, message: contactsRes.error });
      return;
    }

    const addressesRes = validateAddresses(addresses);
    if (!addressesRes.ok) {
      res.status(400).json({ success: false, message: addressesRes.error });
      return;
    }

    const banksRes = validateBankAccounts(bankAccounts);
    if (!banksRes.ok) {
      res.status(400).json({ success: false, message: banksRes.error });
      return;
    }

    // ── 1f. accountManager must be a valid employee ──────────────────────
    let managerId: mongoose.Types.ObjectId | null = null;
    if (accountManager) {
      if (!mongoose.Types.ObjectId.isValid(String(accountManager))) {
        res.status(400).json({ success: false, message: 'Invalid accountManager id' });
        return;
      }
      const emp = await Employee.findOne({
        _id: accountManager,
        isDeleted: false,
      }).select('_id');
      if (!emp) {
        res.status(400).json({ success: false, message: 'accountManager not found' });
        return;
      }
      managerId = emp._id;
    }

    // ── 2. Create ────────────────────────────────────────────────────────
    const client = new Client({
      name: String(name).trim(),
      clientType,
      displayName: displayName ? String(displayName).trim() : undefined,
      email: email ? String(email).trim().toLowerCase() : undefined,
      phoneNo: String(phoneNo).trim(),
      alternatePhoneNo: alternatePhoneNo ? String(alternatePhoneNo).trim() : undefined,
      website: website ? String(website).trim() : undefined,

      cnic: cnic ? String(cnic).trim() : undefined,
      ntn: ntn ? String(ntn).trim() : undefined,
      strn: strn ? String(strn).trim() : undefined,
      registrationNo: registrationNo ? String(registrationNo).trim() : undefined,

      industry: industry ? String(industry).trim() : undefined,
      tier: (tier as ClientTier) || 'standard',

      contacts: contactsRes.parsed ?? [],
      addresses: addressesRes.parsed ?? [],

      creditLimit: creditLimit !== undefined ? Number(creditLimit) : 0,
      openingBalance: openingBalance !== undefined ? Number(openingBalance) : 0,
      currentBalance: openingBalance !== undefined ? Number(openingBalance) : 0,
      currency: currency ? String(currency).toUpperCase() : 'PKR',
      paymentTerms: (paymentTerms as PaymentTerms) || '30',
      taxExempt: taxExempt === true,

      bankAccounts: banksRes.parsed ?? [],

      status: (status as ClientStatus) || 'active',
      statusReason: statusReason ? String(statusReason).trim() : undefined,

      accountManager: managerId,
      // ❌ REMOVED: user: user || null,
    });

    await client.save();

    res.status(201).json({
      success: true,
      message: 'Client created successfully',
      data: client,
    });
  } catch (err: any) {
    console.error('createClient error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── List Clients ─────────────────────────────────────────────────────────
export async function listClients(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      clientType,
      status,
      tier,
      industry,
      isActive,
      // ❌ REMOVED: hasUserAccount,
      accountManager,
      search,
      onlyDeleted,
      page = '1',
      limit = '20',
      sort = '-createdAt',
    } = req.query;

    // ── Base filter: live vs deleted ────────────────────────────────────
    const filter: any = {
      isDeleted: onlyDeleted === 'true',
    };

    if (clientType) filter.clientType = clientType;
    if (tier) filter.tier = tier;
    if (industry) filter.industry = industry;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    // ❌ REMOVED: hasUserAccount filter block

    if (accountManager) {
      if (!mongoose.Types.ObjectId.isValid(String(accountManager))) {
        res.status(400).json({
          success: false,
          message: 'Invalid accountManager id',
        });
        return;
      }
      filter.accountManager = accountManager;
    }

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ClientStatus =>
          (CLIENT_STATUSES as string[]).includes(s)
        );

      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { displayName: { $regex: search, $options: 'i' } },
        { clientId: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNo: { $regex: search, $options: 'i' } },
        { cnic: { $regex: search, $options: 'i' } },
        { ntn: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [clients, total] = await Promise.all([
      Client.find(filter)
        .populate('accountManager', 'name employeeId designation department')
        // ❌ REMOVED: .populate('user', 'username email status isActive')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Client.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: clients,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listClients error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get Client By ID ─────────────────────────────────────────────────────
export async function getClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const idStr = String(clientId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query).populate(
      'accountManager',
      'name employeeId designation department phoneNo email'
      // ❌ REMOVED: .populate('user', 'username email status isActive role department')
    );

    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    res.json({ success: true, data: client });
  } catch (err: any) {
    console.error('getClient error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ❌ REMOVED: entire getClientByUserId function

// ─── Update Client ────────────────────────────────────────────────────────
export async function updateClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const idStr = String(clientId);

    const {
      name,
      clientType,
      displayName,
      email,
      phoneNo,
      alternatePhoneNo,
      website,

      cnic,
      ntn,
      strn,
      registrationNo,

      industry,
      tier,

      contacts,
      addresses,
      bankAccounts,

      creditLimit,
      openingBalance,
      currentBalance,
      currency,
      paymentTerms,
      taxExempt,

      status,
      statusReason,

      accountManager,
    } = req.body;

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    // ── Permission check ────────────────────────────────────────────────
    const isMainAdmin = req.user!.isMainAdmin;
    const canEdit = await req.user!.can('clients', 'edit');
    if (!isMainAdmin && !canEdit) {
      res.status(403).json({
        success: false,
        message: 'You cannot edit clients',
      });
      return;
    }

    // ── Validation ──────────────────────────────────────────────────────
    if (clientType !== undefined && !CLIENT_TYPES.includes(clientType)) {
      res.status(400).json({
        success: false,
        message: `Invalid clientType. Allowed: ${CLIENT_TYPES.join(', ')}`,
      });
      return;
    }

    if (tier !== undefined && !CLIENT_TIERS.includes(tier)) {
      res.status(400).json({
        success: false,
        message: `Invalid tier. Allowed: ${CLIENT_TIERS.join(', ')}`,
      });
      return;
    }

    if (status !== undefined && !CLIENT_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${CLIENT_STATUSES.join(', ')}`,
      });
      return;
    }

    if (email !== undefined && email !== null && email !== '') {
      if (!EMAIL_RE.test(String(email))) {
        res.status(400).json({ success: false, message: 'Invalid email format' });
        return;
      }
    }

    if (paymentTerms !== undefined) {
      if (typeof paymentTerms !== 'string' || !isValidPaymentTerms(paymentTerms)) {
        res.status(400).json({
          success: false,
          message:
            "paymentTerms must be either 'due_on_receipt' or a numeric string between 0 and 365",
        });
        return;
      }
    }

    let parsedContacts: any[] | undefined;
    if (contacts !== undefined) {
      const r = validateContacts(contacts);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedContacts = r.parsed;
    }

    let parsedAddresses: any[] | undefined;
    if (addresses !== undefined) {
      const r = validateAddresses(addresses);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedAddresses = r.parsed;
    }

    let parsedBanks: any[] | undefined;
    if (bankAccounts !== undefined) {
      const r = validateBankAccounts(bankAccounts);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedBanks = r.parsed;
    }

    // ── Apply scalar updates ────────────────────────────────────────────
    if (name !== undefined) client.name = String(name).trim();
    if (clientType !== undefined) client.clientType = clientType as ClientType;
    if (displayName !== undefined) client.displayName = displayName || undefined;
    if (email !== undefined) client.email = email ? String(email).trim().toLowerCase() : undefined;
    if (phoneNo !== undefined) client.phoneNo = String(phoneNo).trim();
    if (alternatePhoneNo !== undefined) client.alternatePhoneNo = alternatePhoneNo || undefined;
    if (website !== undefined) client.website = website || undefined;

    if (cnic !== undefined) client.cnic = cnic || undefined;
    if (ntn !== undefined) client.ntn = ntn || undefined;
    if (strn !== undefined) client.strn = strn || undefined;
    if (registrationNo !== undefined) client.registrationNo = registrationNo || undefined;

    if (industry !== undefined) client.industry = industry || undefined;
    if (tier !== undefined) client.tier = tier as ClientTier;

    if (parsedContacts !== undefined) {
      client.contacts = parsedContacts;
      client.markModified('contacts');
    }
    if (parsedAddresses !== undefined) {
      client.addresses = parsedAddresses;
      client.markModified('addresses');
    }
    if (parsedBanks !== undefined) {
      client.bankAccounts = parsedBanks;
      client.markModified('bankAccounts');
    }

    if (creditLimit !== undefined) client.creditLimit = Number(creditLimit);
    if (openingBalance !== undefined) client.openingBalance = Number(openingBalance);
    if (currentBalance !== undefined) client.currentBalance = Number(currentBalance);
    if (currency !== undefined) client.currency = String(currency).toUpperCase();
    if (paymentTerms !== undefined) client.paymentTerms = paymentTerms as PaymentTerms;
    if (taxExempt !== undefined) client.taxExempt = taxExempt === true;

    if (status !== undefined) {
      client.status = status as ClientStatus;
      if (statusReason !== undefined) {
        client.statusReason = statusReason ? String(statusReason).trim() : undefined;
      }
    }

    if (accountManager !== undefined) {
      if (accountManager === null || accountManager === '') {
        client.accountManager = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(accountManager))) {
          res.status(400).json({ success: false, message: 'Invalid accountManager id' });
          return;
        }
        const emp = await Employee.findOne({
          _id: accountManager,
          isDeleted: false,
        }).select('_id');
        if (!emp) {
          res.status(400).json({ success: false, message: 'accountManager not found' });
          return;
        }
        client.accountManager = emp._id;
      }
    }

    await client.save();

    const fresh = await Client.findById(client._id).populate(
      'accountManager',
      'name employeeId designation department'
      // ❌ REMOVED: .populate('user', 'username email status isActive')
    );

    res.json({
      success: true,
      message: 'Client updated successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('updateClient error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: CONTACTS
// ═════════════════════════════════════════════════════════════════════════
export async function addClientContact(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const idStr = String(clientId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const r = validateContacts([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid contact' });
      return;
    }
    const contact = r.parsed[0];

    if (contact.isPrimary) {
      for (const c of client.contacts) c.isPrimary = false;
    }

    client.contacts.push(contact);
    client.markModified('contacts');
    await client.save();

    res.status(201).json({
      success: true,
      message: 'Contact added',
      data: client.contacts,
    });
  } catch (err: any) {
    console.error('addClientContact error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeClientContact(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId, contactId } = req.params;
    const idStr = String(clientId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const before = client.contacts.length;
    client.contacts = client.contacts.filter(
      (c: any) => String(c._id) !== String(contactId)
    );

    if (client.contacts.length === before) {
      res.status(404).json({ success: false, message: 'Contact not found' });
      return;
    }

    client.markModified('contacts');
    await client.save();

    res.json({
      success: true,
      message: 'Contact removed',
      data: client.contacts,
    });
  } catch (err: any) {
    console.error('removeClientContact error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: ADDRESSES
// ═════════════════════════════════════════════════════════════════════════
export async function addClientAddress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const idStr = String(clientId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const r = validateAddresses([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid address' });
      return;
    }
    const address = r.parsed[0];

    const dup = client.addresses.some(
      (a) => a.label.trim().toLowerCase() === address.label
    );
    if (dup) {
      res.status(409).json({
        success: false,
        message: `Address with label "${address.label}" already exists`,
      });
      return;
    }

    if (address.isDefault) {
      for (const a of client.addresses) a.isDefault = false;
    }

    client.addresses.push(address);
    client.markModified('addresses');
    await client.save();

    res.status(201).json({
      success: true,
      message: 'Address added',
      data: client.addresses,
    });
  } catch (err: any) {
    console.error('addClientAddress error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeClientAddress(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId, addressId } = req.params;
    const idStr = String(clientId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const before = client.addresses.length;
    client.addresses = client.addresses.filter(
      (a: any) => String(a._id) !== String(addressId)
    );

    if (client.addresses.length === before) {
      res.status(404).json({ success: false, message: 'Address not found' });
      return;
    }

    client.markModified('addresses');
    await client.save();

    res.json({
      success: true,
      message: 'Address removed',
      data: client.addresses,
    });
  } catch (err: any) {
    console.error('removeClientAddress error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: BANK ACCOUNTS
// ═════════════════════════════════════════════════════════════════════════
export async function addClientBankAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const idStr = String(clientId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const r = validateBankAccounts([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid bank account' });
      return;
    }
    const bank = r.parsed[0];

    if (bank.isPrimary) {
      for (const b of client.bankAccounts) b.isPrimary = false;
    }

    client.bankAccounts.push(bank);
    client.markModified('bankAccounts');
    await client.save();

    res.status(201).json({
      success: true,
      message: 'Bank account added',
      data: client.bankAccounts,
    });
  } catch (err: any) {
    console.error('addClientBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeClientBankAccount(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId, bankId } = req.params;
    const idStr = String(clientId);
    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const before = client.bankAccounts.length;
    client.bankAccounts = client.bankAccounts.filter(
      (b: any) => String(b._id) !== String(bankId)
    );

    if (client.bankAccounts.length === before) {
      res.status(404).json({ success: false, message: 'Bank account not found' });
      return;
    }

    client.markModified('bankAccounts');
    await client.save();

    res.json({
      success: true,
      message: 'Bank account removed',
      data: client.bankAccounts,
    });
  } catch (err: any) {
    console.error('removeClientBankAccount error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// STATUS TRANSITIONS
// ═════════════════════════════════════════════════════════════════════════
export async function changeClientStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const { status, statusReason } = req.body;
    const idStr = String(clientId);

    if (!status || !CLIENT_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${CLIENT_STATUSES.join(', ')}`,
      });
      return;
    }

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    client.status = status as ClientStatus;
    client.statusReason = statusReason ? String(statusReason).trim() : undefined;
    await client.save();

    res.json({
      success: true,
      message: 'Client status updated',
      data: client,
    });
  } catch (err: any) {
    console.error('changeClientStatus error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// DELETE (soft) / RESTORE
// ═════════════════════════════════════════════════════════════════════════
export async function deleteClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const idStr = String(clientId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr, isDeleted: false }
      : { clientId: idStr, isDeleted: false };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('clients', 'delete'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot delete clients',
        });
        return;
      }
    }

    client.isDeleted = true;
    client.isActive = false;
    client.statusReason = client.statusReason || 'Soft-deleted';
    await client.save();

    res.json({ success: true, message: 'Client deleted successfully' });
  } catch (err: any) {
    console.error('deleteClient error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function restoreClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { clientId } = req.params;
    const idStr = String(clientId);

    const query = mongoose.Types.ObjectId.isValid(idStr)
      ? { _id: idStr }
      : { clientId: idStr };

    const client = await Client.findOne(query);
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('clients', 'edit'))) {
        res.status(403).json({
          success: false,
          message: 'You cannot restore clients',
        });
        return;
      }
    }

    client.isDeleted = false;
    client.deletedAt = undefined;
    client.status = 'active';
    client.statusReason = undefined;
    await client.save();

    res.json({
      success: true,
      message: 'Client restored successfully',
      data: client,
    });
  } catch (err: any) {
    console.error('restoreClient error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// CLIENT STATS
// ═════════════════════════════════════════════════════════════════════════
export async function getClientStats(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const baseFilter = { isDeleted: false };

    const [
      total,
      active,
      inactive,
      blacklisted,
      // ❌ REMOVED: withUser,
      // ❌ REMOVED: withoutUser,
      overCreditLimit,
      byTypeRaw,
      byTierRaw,
      byStatusRaw,
      byIndustryRaw,
      topByBalanceRaw,
      balanceAgg,
    ] = await Promise.all([
      Client.countDocuments(baseFilter),
      Client.countDocuments({ ...baseFilter, status: 'active' }),
      Client.countDocuments({ ...baseFilter, status: 'inactive' }),
      Client.countDocuments({ ...baseFilter, status: 'blacklisted' }),
      // ❌ REMOVED: Client.countDocuments({ ...baseFilter, user: { $ne: null } }),
      // ❌ REMOVED: Client.countDocuments({ ...baseFilter, user: null }),

      // Clients who exceeded their credit limit
      Client.countDocuments({
        ...baseFilter,
        creditLimit: { $gt: 0 },
        $expr: { $gt: ['$currentBalance', '$creditLimit'] },
      }),

      Client.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$clientType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Client.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$tier', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Client.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      Client.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$industry', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 15 },
      ]),

      // Top 10 clients by currentBalance
      Client.find({
        ...baseFilter,
        currentBalance: { $gt: 0 },
      })
        .sort('-currentBalance')
        .limit(10)
        .select('clientId name clientType currentBalance creditLimit currency'),

      // Sum of all balances owed
      Client.aggregate([
        { $match: baseFilter },
        {
          $group: {
            _id: null,
            totalReceivable: {
              $sum: { $cond: [{ $gt: ['$currentBalance', 0] }, '$currentBalance', 0] },
            },
            totalCreditLimit: { $sum: '$creditLimit' },
          },
        },
      ]),
    ]);

    const byStatus: Record<string, number> = {
      active: 0,
      inactive: 0,
      blacklisted: 0,
    };
    for (const row of byStatusRaw) {
      const key = String(row._id ?? 'unknown');
      byStatus[key] = (byStatus[key] ?? 0) + row.count;
    }

    const totalReceivable = balanceAgg[0]?.totalReceivable ?? 0;
    const totalCreditLimit = balanceAgg[0]?.totalCreditLimit ?? 0;

    res.json({
      success: true,
      data: {
        total,
        active,
        inactive,
        blacklisted,
        byType: byTypeRaw.map((d) => ({
          clientType: d._id || 'unknown',
          count: d.count,
        })),
        byTier: byTierRaw.map((d) => ({
          tier: d._id || 'standard',
          count: d.count,
        })),
        byIndustry: byIndustryRaw.map((d) => ({
          industry: d._id || '(unassigned)',
          count: d.count,
        })),
        breakdown: {
          total,
          active,
          inactive,
          blacklisted,
          // ❌ REMOVED: withUser,
          // ❌ REMOVED: withoutUser,
          overCreditLimit,
          byStatus,
          totalReceivable: +Number(totalReceivable).toFixed(2),
          totalCreditLimit: +Number(totalCreditLimit).toFixed(2),
          topByBalance: topByBalanceRaw,
        },
      },
    });
  } catch (err: any) {
    console.error('getClientStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// PAYMENT TERMS OPTIONS (for frontend dropdowns)
// ═════════════════════════════════════════════════════════════════════════
export async function getPaymentTermOptions(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const mod = await import('../model/client');
    const options = (mod as any).PAYMENT_TERM_OPTIONS ?? [
      DUE_ON_RECEIPT,
      '7',
      '15',
      '30',
      '45',
      '60',
      '90',
    ];

    res.json({
      success: true,
      data: {
        options,
        dueOnReceiptValue: DUE_ON_RECEIPT,
      },
    });
  } catch (err: any) {
    console.error('getPaymentTermOptions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}