// controller/proposalController.ts
import { Response } from 'express';
import mongoose from 'mongoose';
import Proposal, {
  PROPOSAL_STATUSES,
  PROPOSAL_TYPES,
  PRICING_MODES,
  LINE_ITEM_CATEGORIES,
  DISCOUNT_TYPES,
  TAX_TYPES,
  PROJECT_CREATION_MODES,
  PAGE_SIZES,
  PAGE_ORIENTATIONS,
  BLOCK_TYPES,
  DEFAULT_PROPOSAL_SECTIONS,
  DEFAULT_VALIDITY_DAYS,
  PROPOSAL_SECTIONS_MAX,
  PROPOSAL_LINE_ITEMS_MAX,
  PROPOSAL_MILESTONES_MAX,
  PROPOSAL_TAGS_MAX,
  PROPOSAL_PAGES_MAX,
  PROPOSAL_BLOCKS_PER_PAGE_MAX,
  PROPOSAL_TABLE_COLUMNS_MAX,
  PROPOSAL_TABLE_ROWS_MAX,
  PROPOSAL_TOC_MAX_DEPTH,
  PROPOSAL_FINANCIAL_SECTION_KEYS,
  computeLineItemTotals,
  computeProposalTotals,
  addTableColumn,
  removeTableColumn,
  addTableRow,
  reorderPages,
  reorderBlocks,
  buildTableOfContents,
  type ProposalStatus,
  type ProposalType,
  type PricingMode,
  type LineItemCategory,
  type DiscountType,
  type TaxType,
  type ProjectCreationMode,
  type PageSize,
  type PageOrientation,
  type BlockType,
  type HeadingLevel,
  type ColumnAlign,
  type ColumnWidthUnit,
  type IProposalLineItem,
  type IProposalSection,
  type IProposalPaymentMilestone,
  type IClientSnapshot,
  type ISalespersonSnapshot,
  type ICompanySnapshot,
  type IProjectTransferSnapshot,
  type IProposalPage,
  type IProposalBlock,
  type ITableBlockData,
  type ITableColumn,
  type ITableRow,
} from '../model/proposal';
import Client from '../model/client';
import Lead from '../model/lead';
import Employee from '../model/employee';
import Project from '../model/project';
import { AuthRequest } from '../middleware/auth';
import { generateProposalDocx } from '../services/proposalDocx.service';
// ─── Helpers ──────────────────────────────────────────────────────────────

/** Force any req.params value to a plain string. */
function asString(v: unknown): string {
  if (Array.isArray(v)) return String(v[0] ?? '');
  if (v === undefined || v === null) return '';
  return String(v);
}

function buildLookupQuery(idStr: string, onlyActive = true) {
  const base: any = mongoose.Types.ObjectId.isValid(idStr)
    ? { _id: idStr }
    : { proposalId: idStr };
  if (onlyActive) base.isDeleted = false;
  return base;
}

/** Safely convert a mongoose sub-doc (or plain object) to a plain object. */
function plain<T = any>(v: any): T {
  if (v === null || v === undefined) return v as T;
  if (typeof v.toObject === 'function') return v.toObject({ virtuals: false }) as T;
  return v as T;
}

function str(v: unknown, max?: number): string | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return max ? s.slice(0, max) : s;
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

function cleanStringArray(input: unknown, maxItems = 100, maxLen = 500): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    const t = s.slice(0, maxLen);
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

function validateTags(input: unknown): { ok: boolean; error?: string; parsed?: string[] } {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'tags must be an array' };
  if (input.length > PROPOSAL_TAGS_MAX) {
    return { ok: false, error: `Too many tags (max ${PROPOSAL_TAGS_MAX})` };
  }
  const seen = new Set<string>();
  const parsed: string[] = [];
  for (const raw of input) {
    const t = String(raw || '').trim().slice(0, 50);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    parsed.push(t);
  }
  return { ok: true, parsed };
}

function genKey(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

// ─── Validate + normalize sub-arrays ──────────────────────────────────────

function validateSections(input: unknown): {
  ok: boolean;
  error?: string;
  parsed?: IProposalSection[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'sections must be an array' };
  if (input.length > PROPOSAL_SECTIONS_MAX) {
    return { ok: false, error: `Too many sections (max ${PROPOSAL_SECTIONS_MAX})` };
  }

  const seenKeys = new Set<string>();
  const parsed: IProposalSection[] = [];

  for (let i = 0; i < input.length; i++) {
    const s = input[i];
    if (!s || typeof s !== 'object') {
      return { ok: false, error: `sections[${i}] is invalid` };
    }
    const key = String((s as any).key || '').trim().toLowerCase();
    const title = String((s as any).title || '').trim();
    if (!key) return { ok: false, error: `sections[${i}].key is required` };
    if (!title) return { ok: false, error: `sections[${i}].title is required` };
    if (seenKeys.has(key)) {
      return { ok: false, error: `Duplicate section key "${key}"` };
    }
    seenKeys.add(key);

    parsed.push({
      key,
      title: title.slice(0, 200),
      content:
        (s as any).content && typeof (s as any).content === 'object'
          ? (s as any).content
          : {},
      plainText: str((s as any).plainText, 20000),
      order: Number.isFinite(Number((s as any).order)) ? Number((s as any).order) : i,
      visible: (s as any).visible === false ? false : true,
      locked: (s as any).locked === true,
    });
  }

  return { ok: true, parsed };
}

function validateLineItems(input: unknown): {
  ok: boolean;
  error?: string;
  parsed?: IProposalLineItem[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'lineItems must be an array' };
  if (input.length > PROPOSAL_LINE_ITEMS_MAX) {
    return { ok: false, error: `Too many line items (max ${PROPOSAL_LINE_ITEMS_MAX})` };
  }

  const parsed: IProposalLineItem[] = [];

  for (let i = 0; i < input.length; i++) {
    const it = input[i];
    if (!it || typeof it !== 'object') {
      return { ok: false, error: `lineItems[${i}] is invalid` };
    }
    const name = String((it as any).name || '').trim();
    if (!name) return { ok: false, error: `lineItems[${i}].name is required` };

    const category = (it as any).category || 'service';
    if (!LINE_ITEM_CATEGORIES.includes(category)) {
      return {
        ok: false,
        error: `lineItems[${i}].category must be one of: ${LINE_ITEM_CATEGORIES.join(', ')}`,
      };
    }

    const qty = num((it as any).quantity);
    if (qty === undefined || qty < 0) {
      return { ok: false, error: `lineItems[${i}].quantity must be a non-negative number` };
    }

    const unitPrice = num((it as any).unitPrice);
    if (unitPrice === undefined || unitPrice < 0) {
      return { ok: false, error: `lineItems[${i}].unitPrice must be a non-negative number` };
    }

    const discountType = (it as any).discountType;
    if (discountType !== undefined && !DISCOUNT_TYPES.includes(discountType)) {
      return { ok: false, error: `lineItems[${i}].discountType must be 'flat' or 'percent'` };
    }

    const taxType = (it as any).taxType;
    if (taxType !== undefined && !TAX_TYPES.includes(taxType)) {
      return { ok: false, error: `lineItems[${i}].taxType must be 'flat' or 'percent'` };
    }

    const taxRate = num((it as any).taxRate);
    if (taxRate !== undefined && (taxRate < 0 || taxRate > 100)) {
      return { ok: false, error: `lineItems[${i}].taxRate must be between 0 and 100` };
    }

    const item: IProposalLineItem = {
      category: category as LineItemCategory,
      name: name.slice(0, 200),
      description: str((it as any).description, 1000),
      serviceId:
        (it as any).serviceId && mongoose.Types.ObjectId.isValid(String((it as any).serviceId))
          ? new mongoose.Types.ObjectId(String((it as any).serviceId))
          : null,
      quantity: qty,
      unit: str((it as any).unit, 20),
      unitPrice,
      currency: str((it as any).currency, 3)?.toUpperCase() || 'PKR',
      billingType: str((it as any).billingType, 40),
      discountType: discountType as DiscountType | undefined,
      discountValue: num((it as any).discountValue) ?? 0,
      taxType: taxType as TaxType | undefined,
      taxRate: taxRate ?? 0,
      taxAmount: num((it as any).taxAmount) ?? 0,
      subtotal: 0,
      discountAmount: 0,
      taxableAmount: 0,
      taxAmountComputed: 0,
      total: 0,
      order: Number.isFinite(Number((it as any).order)) ? Number((it as any).order) : i,
      notes: str((it as any).notes, 500),
    };

    const t = computeLineItemTotals(item);
    item.subtotal = t.subtotal;
    item.discountAmount = t.discountAmount;
    item.taxableAmount = t.taxableAmount;
    item.taxAmountComputed = t.taxAmountComputed;
    item.total = t.total;

    parsed.push(item);
  }

  return { ok: true, parsed };
}

function validatePaymentMilestones(input: unknown): {
  ok: boolean;
  error?: string;
  parsed?: IProposalPaymentMilestone[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) {
    return { ok: false, error: 'financial.paymentMilestones must be an array' };
  }
  if (input.length > PROPOSAL_MILESTONES_MAX) {
    return { ok: false, error: `Too many payment milestones (max ${PROPOSAL_MILESTONES_MAX})` };
  }

  const parsed: IProposalPaymentMilestone[] = [];

  for (let i = 0; i < input.length; i++) {
    const m = input[i];
    if (!m || typeof m !== 'object') {
      return { ok: false, error: `financial.paymentMilestones[${i}] is invalid` };
    }
    const label = String((m as any).label || '').trim();
    if (!label) {
      return { ok: false, error: `financial.paymentMilestones[${i}].label is required` };
    }

    const percentage = num((m as any).percentage);
    if (percentage !== undefined && (percentage < 0 || percentage > 100)) {
      return {
        ok: false,
        error: `financial.paymentMilestones[${i}].percentage must be between 0 and 100`,
      };
    }

    parsed.push({
      label: label.slice(0, 120),
      description: str((m as any).description, 500),
      percentage,
      amount: num((m as any).amount) ?? 0,
      dueDate: date((m as any).dueDate),
      dueAfterDays: num((m as any).dueAfterDays),
      isPaid: (m as any).isPaid === true,
      paidAt: date((m as any).paidAt),
      notes: str((m as any).notes, 500),
    });
  }

  return { ok: true, parsed };
}

function validateFinancial(input: unknown): {
  ok: boolean;
  error?: string;
  parsed?: Record<string, any>;
} {
  if (input === undefined || input === null) return { ok: true, parsed: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'financial must be an object' };
  }
  const f = input as Record<string, any>;

  const pricingMode = (f.pricingMode as PricingMode) || 'fixed';
  if (!PRICING_MODES.includes(pricingMode)) {
    return { ok: false, error: `financial.pricingMode must be one of: ${PRICING_MODES.join(', ')}` };
  }

  const globalDiscountType = f.globalDiscountType;
  if (globalDiscountType !== undefined && !DISCOUNT_TYPES.includes(globalDiscountType)) {
    return { ok: false, error: `financial.globalDiscountType must be 'flat' or 'percent'` };
  }

  const taxType = f.taxType;
  if (taxType !== undefined && !TAX_TYPES.includes(taxType)) {
    return { ok: false, error: `financial.taxType must be 'flat' or 'percent'` };
  }

  const taxRate = num(f.taxRate);
  if (taxRate !== undefined && (taxRate < 0 || taxRate > 100)) {
    return { ok: false, error: 'financial.taxRate must be between 0 and 100' };
  }

  const milestonesRes = validatePaymentMilestones(f.paymentMilestones);
  if (!milestonesRes.ok) return { ok: false, error: milestonesRes.error };

  return {
    ok: true,
    parsed: {
      pricingMode,
      currency: str(f.currency, 3)?.toUpperCase() || 'PKR',
      globalDiscountType: globalDiscountType as DiscountType | undefined,
      globalDiscountValue: num(f.globalDiscountValue) ?? 0,
      taxType: taxType as TaxType | undefined,
      taxRate: taxRate ?? 0,
      taxAmount: num(f.taxAmount) ?? 0,
      taxLabel: str(f.taxLabel, 100),
      paymentTerms: str(f.paymentTerms, 40),
      paymentMilestones: milestonesRes.parsed ?? [],
      bankDetails:
        f.bankDetails && typeof f.bankDetails === 'object'
          ? {
              bankName: str(f.bankDetails.bankName, 120) ?? '',
              accountTitle: str(f.bankDetails.accountTitle, 120) ?? '',
              accountNumber: str(f.bankDetails.accountNumber, 50) ?? '',
              iban: str(f.bankDetails.iban, 34)?.toUpperCase(),
              branch: str(f.bankDetails.branch, 120),
            }
          : undefined,
      validityDays: num(f.validityDays) ?? DEFAULT_VALIDITY_DAYS,
      validityDate: date(f.validityDate),
      notes: str(f.notes, 5000),
    },
  };
}

// ─── Table / Block / Page validators ──────────────────────────────────────

function validateTableColumn(input: any, idx: number): { ok: boolean; error?: string; parsed?: ITableColumn } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: `columns[${idx}] must be an object` };
  }
  const key = String(input.key || '').trim();
  const label = String(input.label || '').trim();
  if (!key) return { ok: false, error: `columns[${idx}].key is required` };
  if (!label) return { ok: false, error: `columns[${idx}].label is required` };
  if (input.align !== undefined && !['left', 'center', 'right'].includes(input.align)) {
    return { ok: false, error: `columns[${idx}].align must be left|center|right` };
  }
  if (input.widthUnit !== undefined && !['px', '%', 'fr'].includes(input.widthUnit)) {
    return { ok: false, error: `columns[${idx}].widthUnit must be px|%|fr` };
  }
  return {
    ok: true,
    parsed: {
      key: key.slice(0, 60),
      label: label.slice(0, 200),
      align: (input.align as ColumnAlign) ?? 'left',
      width: num(input.width),
      widthUnit: (input.widthUnit as ColumnWidthUnit) ?? 'fr',
      type: input.type ?? 'text',
      hidden: input.hidden === true,
    },
  };
}

function validateTableRow(
  input: any,
  idx: number,
  validColumnKeys: Set<string>
): { ok: boolean; error?: string; parsed?: ITableRow } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: `rows[${idx}] must be an object` };
  }
  const cells: Record<string, any> = {};
  const src = input.cells && typeof input.cells === 'object' ? input.cells : {};
  for (const k of Object.keys(src)) {
    if (!validColumnKeys.has(k)) continue;
    const v = src[k];
    if (v === null || v === undefined) {
      cells[k] = null;
    } else if (typeof v === 'boolean' || typeof v === 'number') {
      cells[k] = v;
    } else {
      cells[k] = String(v).slice(0, 2000);
    }
  }
  for (const k of validColumnKeys) {
    if (cells[k] === undefined) cells[k] = null;
  }
  return {
    ok: true,
    parsed: {
      cells,
      isHeader: input.isHeader === true,
      isSubtotal: input.isSubtotal === true,
      notes: str(input.notes, 500),
    },
  };
}

function validateTable(input: any): { ok: boolean; error?: string; parsed?: ITableBlockData } {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'table must be an object' };
  }
  const rawCols = Array.isArray(input.columns) ? input.columns : [];
  const rawRows = Array.isArray(input.rows) ? input.rows : [];

  if (rawCols.length === 0) {
    return { ok: false, error: 'table.columns must contain at least 1 column' };
  }
  if (rawCols.length > PROPOSAL_TABLE_COLUMNS_MAX) {
    return { ok: false, error: `Too many columns (max ${PROPOSAL_TABLE_COLUMNS_MAX})` };
  }
  if (rawRows.length > PROPOSAL_TABLE_ROWS_MAX) {
    return { ok: false, error: `Too many rows (max ${PROPOSAL_TABLE_ROWS_MAX})` };
  }

  const parsedCols: ITableColumn[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < rawCols.length; i++) {
    const r = validateTableColumn(rawCols[i], i);
    if (!r.ok) return { ok: false, error: r.error };
    if (seenKeys.has(r.parsed!.key)) {
      return { ok: false, error: `Duplicate column key "${r.parsed!.key}"` };
    }
    seenKeys.add(r.parsed!.key);
    parsedCols.push(r.parsed!);
  }

  const parsedRows: ITableRow[] = [];
  for (let i = 0; i < rawRows.length; i++) {
    const r = validateTableRow(rawRows[i], i, seenKeys);
    if (!r.ok) return { ok: false, error: r.error };
    parsedRows.push(r.parsed!);
  }

  return {
    ok: true,
    parsed: {
      columns: parsedCols,
      rows: parsedRows,
      caption: str(input.caption, 300),
      striped: input.striped !== false,
      bordered: input.bordered !== false,
      compact: input.compact === true,
      showTotals: input.showTotals === true,
      totalColumnKeys: Array.isArray(input.totalColumnKeys)
        ? input.totalColumnKeys.filter((k: any) => seenKeys.has(String(k))).map((k: any) => String(k))
        : [],
    },
  };
}

function validateBlock(input: any, idx: number): {
  ok: boolean;
  error?: string;
  parsed?: IProposalBlock;
} {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: `blocks[${idx}] must be an object` };
  }
  const type = String(input.type || '').trim() as BlockType;
  if (!BLOCK_TYPES.includes(type)) {
    return {
      ok: false,
      error: `blocks[${idx}].type must be one of: ${BLOCK_TYPES.join(', ')}`,
    };
  }

  const base: IProposalBlock = {
    key: String(input.key || '').trim() || genKey('blk'),
    type,
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : idx,
    visible: input.visible !== false,
    locked: input.locked === true,
  };

  switch (type) {
    case 'heading': {
      const h = input.heading || {};
      const text = String(h.text || '').trim();
      if (!text) return { ok: false, error: `blocks[${idx}].heading.text is required` };
      const lvl = Number(h.level);
      if (!Number.isFinite(lvl) || lvl < 1 || lvl > 6) {
        return { ok: false, error: `blocks[${idx}].heading.level must be 1..6` };
      }
      base.heading = {
        text: text.slice(0, 500),
        level: lvl as HeadingLevel,
        anchor: str(h.anchor, 120),
        align: (h.align as ColumnAlign) ?? 'left',
        color: str(h.color, 30),
        icon: str(h.icon, 100),
      };
      break;
    }
    case 'paragraph':
    case 'custom': {
      const t = input.text || {};
      base.text = {
        format: t.format ?? 'tiptap',
        content: t.content ?? {},
        plainText: str(t.plainText, 50000),
      };
      if (type === 'custom') {
        base.custom = input.custom && typeof input.custom === 'object' ? input.custom : {};
      }
      break;
    }
    case 'bullets':
    case 'numbered': {
      const l = input.list || {};
      base.list = {
        items: cleanStringArray(l.items, 500, 2000),
        ordered: type === 'numbered' ? true : (l.ordered === true),
        startAt: num(l.startAt),
      };
      break;
    }
    case 'table': {
      const r = validateTable(input.table);
      if (!r.ok) return { ok: false, error: `blocks[${idx}]: ${r.error}` };
      base.table = r.parsed!;
      break;
    }
    case 'image': {
      const im = input.image || {};
      const url = String(im.url || '').trim();
      if (!url) return { ok: false, error: `blocks[${idx}].image.url is required` };
      base.image = {
        url: url.slice(0, 1000),
        alt: str(im.alt, 300),
        caption: str(im.caption, 300),
        width: num(im.width),
        widthUnit: (im.widthUnit as ColumnWidthUnit) ?? 'px',
        align: (im.align as ColumnAlign) ?? 'center',
      };
      break;
    }
    case 'code': {
      const c = input.code || {};
      if (!c.code) return { ok: false, error: `blocks[${idx}].code.code is required` };
      base.code = {
        language: str(c.language, 40),
        code: String(c.code).slice(0, 50000),
        showLineNumbers: c.showLineNumbers === true,
      };
      break;
    }
    case 'callout': {
      const c = input.callout || {};
      if (!c.text) return { ok: false, error: `blocks[${idx}].callout.text is required` };
      base.callout = {
        variant: ['info', 'warning', 'success', 'danger', 'note'].includes(c.variant)
          ? c.variant
          : 'info',
        title: str(c.title, 200),
        text: String(c.text).slice(0, 5000),
      };
      break;
    }
    case 'divider':
      break;
    case 'spacer': {
      const s = input.spacer || {};
      base.spacer = {
        height: num(s.height) ?? 16,
      };
      break;
    }
    case 'signature': {
      const s = input.signature || {};
      base.signature = {
        label: str(s.label, 100),
        name: str(s.name, 120),
        designation: str(s.designation, 120),
        imageUrl: str(s.imageUrl, 1000),
        date: date(s.date),
      };
      break;
    }
  }

  if (input.style && typeof input.style === 'object') {
    base.style = input.style;
  }

  return { ok: true, parsed: base };
}

function validatePage(input: any, idx: number): {
  ok: boolean;
  error?: string;
  parsed?: IProposalPage;
} {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: `pages[${idx}] must be an object` };
  }
  const size = (input.size as PageSize) ?? 'A4';
  if (!PAGE_SIZES.includes(size)) {
    return { ok: false, error: `pages[${idx}].size must be one of: ${PAGE_SIZES.join(', ')}` };
  }
  const orientation = (input.orientation as PageOrientation) ?? 'portrait';
  if (!PAGE_ORIENTATIONS.includes(orientation)) {
    return { ok: false, error: `pages[${idx}].orientation must be portrait|landscape` };
  }

  const rawBlocks = Array.isArray(input.blocks) ? input.blocks : [];
  if (rawBlocks.length > PROPOSAL_BLOCKS_PER_PAGE_MAX) {
    return {
      ok: false,
      error: `pages[${idx}] has too many blocks (max ${PROPOSAL_BLOCKS_PER_PAGE_MAX})`,
    };
  }

  const parsedBlocks: IProposalBlock[] = [];
  for (let j = 0; j < rawBlocks.length; j++) {
    const r = validateBlock(rawBlocks[j], j);
    if (!r.ok) return { ok: false, error: `pages[${idx}].${r.error}` };
    parsedBlocks.push(r.parsed!);
  }

  const page: IProposalPage = {
    key: String(input.key || '').trim() || genKey('page'),
    title: str(input.title, 200),
    order: Number.isFinite(Number(input.order)) ? Number(input.order) : idx,
    size,
    orientation,
    customSize:
      input.customSize && typeof input.customSize === 'object'
        ? {
            width: num(input.customSize.width) ?? 0,
            height: num(input.customSize.height) ?? 0,
          }
        : undefined,
    showHeader: input.showHeader === true,
    showFooter: input.showFooter !== false,
    headerText: str(input.headerText, 300),
    footerText: str(input.footerText, 300),
    showPageNumber: input.showPageNumber !== false,
    pageNumberFormat: str(input.pageNumberFormat, 60) || 'Page {n} of {total}',
    margins:
      input.margins && typeof input.margins === 'object'
        ? {
            top: num(input.margins.top) ?? 48,
            right: num(input.margins.right) ?? 48,
            bottom: num(input.margins.bottom) ?? 48,
            left: num(input.margins.left) ?? 48,
          }
        : { top: 48, right: 48, bottom: 48, left: 48 },
    padding:
      input.padding && typeof input.padding === 'object'
        ? {
            top: num(input.padding.top) ?? 0,
            right: num(input.padding.right) ?? 0,
            bottom: num(input.padding.bottom) ?? 0,
            left: num(input.padding.left) ?? 0,
          }
        : { top: 0, right: 0, bottom: 0, left: 0 },
    background:
      input.background && typeof input.background === 'object'
        ? {
            color: str(input.background.color, 30),
            imageUrl: str(input.background.imageUrl, 1000),
          }
        : undefined,
    blocks: parsedBlocks,
    visible: input.visible !== false,
    locked: input.locked === true,
    notes: str(input.notes, 2000),
  };

  return { ok: true, parsed: page };
}

function validatePages(input: unknown): {
  ok: boolean;
  error?: string;
  parsed?: IProposalPage[];
} {
  if (input === undefined || input === null) return { ok: true, parsed: [] };
  if (!Array.isArray(input)) return { ok: false, error: 'technical.pages must be an array' };
  if (input.length > PROPOSAL_PAGES_MAX) {
    return { ok: false, error: `Too many pages (max ${PROPOSAL_PAGES_MAX})` };
  }

  const parsed: IProposalPage[] = [];
  const seenKeys = new Set<string>();
  for (let i = 0; i < input.length; i++) {
    const r = validatePage(input[i], i);
    if (!r.ok) return { ok: false, error: r.error };
    if (seenKeys.has(r.parsed!.key)) {
      return { ok: false, error: `Duplicate page key "${r.parsed!.key}"` };
    }
    seenKeys.add(r.parsed!.key);
    parsed.push(r.parsed!);
  }
  return { ok: true, parsed };
}

function validateTechnical(input: unknown): {
  ok: boolean;
  error?: string;
  parsed?: Record<string, any>;
} {
  if (input === undefined || input === null) return { ok: true, parsed: {} };
  if (typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'technical must be an object' };
  }
  const t = input as Record<string, any>;

  const modules = Array.isArray(t.modules)
    ? t.modules
        .filter((m: any) => m && typeof m === 'object' && String(m.name || '').trim())
        .slice(0, 100)
        .map((m: any) => ({
          name: String(m.name).trim().slice(0, 200),
          description: str(m.description, 1000),
        }))
    : [];

  const phases = Array.isArray(t.phases)
    ? t.phases
        .filter((p: any) => p && typeof p === 'object' && String(p.phase || '').trim())
        .slice(0, 50)
        .map((p: any) => ({
          phase: String(p.phase).trim().slice(0, 200),
          duration: str(p.duration, 100),
          deliverable: str(p.deliverable, 500),
        }))
    : [];

  const proposedMilestones = Array.isArray(t.proposedMilestones)
    ? t.proposedMilestones
        .filter((m: any) => m && typeof m === 'object' && String(m.title || '').trim())
        .slice(0, 50)
        .map((m: any) => ({
          title: String(m.title).trim().slice(0, 200),
          description: str(m.description, 1000),
          dueDate: date(m.dueDate),
        }))
    : [];

  let pages: IProposalPage[] | undefined;
  if (t.pages !== undefined) {
    const r = validatePages(t.pages);
    if (!r.ok) return { ok: false, error: r.error };
    pages = r.parsed;
  }

  let toc: any;
  if (t.toc && typeof t.toc === 'object') {
    const md = num(t.toc.maxDepth);
    toc = {
      enabled: t.toc.enabled === true,
      title: str(t.toc.title, 120) || 'Table of Contents',
      maxDepth: md !== undefined && md >= 1 && md <= PROPOSAL_TOC_MAX_DEPTH
        ? (md as HeadingLevel)
        : 3,
      showPageNumbers: t.toc.showPageNumbers !== false,
    };
  }

  let defaults: any;
  if (t.defaults && typeof t.defaults === 'object') {
    const dSize = (t.defaults.size as PageSize) ?? 'A4';
    const dOrientation = (t.defaults.orientation as PageOrientation) ?? 'portrait';
    defaults = {
      size: PAGE_SIZES.includes(dSize) ? dSize : 'A4',
      orientation: PAGE_ORIENTATIONS.includes(dOrientation) ? dOrientation : 'portrait',
      margins:
        t.defaults.margins && typeof t.defaults.margins === 'object'
          ? {
              top: num(t.defaults.margins.top) ?? 48,
              right: num(t.defaults.margins.right) ?? 48,
              bottom: num(t.defaults.margins.bottom) ?? 48,
              left: num(t.defaults.margins.left) ?? 48,
            }
          : { top: 48, right: 48, bottom: 48, left: 48 },
    };
  }

  const parsed: Record<string, any> = {
    approach: str(t.approach, 5000),
    techStack: cleanStringArray(t.techStack, 100, 100),
    architectureSummary: str(t.architectureSummary, 5000),
    modules,
    deliverables: cleanStringArray(t.deliverables, 100, 500),
    assumptions: cleanStringArray(t.assumptions, 100, 500),
    dependencies: cleanStringArray(t.dependencies, 100, 500),
    outOfScope: cleanStringArray(t.outOfScope, 100, 500),
    testingStrategy: str(t.testingStrategy, 3000),
    supportPlan: str(t.supportPlan, 3000),
    phases,
    estimatedDurationDays: num(t.estimatedDurationDays),
    proposedMilestones,
  };
  if (pages !== undefined) parsed.pages = pages;
  if (toc !== undefined) parsed.toc = toc;
  if (defaults !== undefined) parsed.defaults = defaults;

  return { ok: true, parsed };
}

// ─── Snapshot builders ────────────────────────────────────────────────────

async function buildClientSnapshot(clientId: unknown): Promise<IClientSnapshot | null> {
  if (!clientId) return null;
  if (!mongoose.Types.ObjectId.isValid(String(clientId))) return null;

  const client = await Client.findOne({ _id: clientId, isDeleted: false }).lean();
  if (!client) return null;

  const primaryContact =
    client.contacts?.find((c: any) => c.isPrimary) ?? client.contacts?.[0];
  const billingAddr =
    client.addresses?.find((a: any) => a.label?.toLowerCase() === 'billing') ??
    client.addresses?.find((a: any) => a.isDefault) ??
    client.addresses?.[0];

  return {
    clientId: client._id,
    name: client.name,
    displayName: client.displayName,
    clientType: client.clientType,
    email: client.email,
    phoneNo: client.phoneNo,
    website: client.website,
    ntn: client.ntn,
    strn: client.strn,
    cnic: client.cnic,
    address: billingAddr
      ? {
          label: billingAddr.label,
          line1: billingAddr.line1,
          line2: billingAddr.line2,
          city: billingAddr.city,
          state: billingAddr.state,
          postalCode: billingAddr.postalCode,
          country: billingAddr.country,
        }
      : undefined,
    primaryContact: primaryContact
      ? {
          name: primaryContact.name,
          designation: primaryContact.designation,
          email: primaryContact.email,
          phoneNo: primaryContact.phoneNo,
        }
      : undefined,
    paymentTerms: client.paymentTerms,
    currency: client.currency,
    taxExempt: client.taxExempt,
  };
}

async function buildSalespersonSnapshot(
  employeeId: unknown
): Promise<ISalespersonSnapshot | null> {
  if (!employeeId) return null;
  if (!mongoose.Types.ObjectId.isValid(String(employeeId))) return null;

  const emp = await Employee.findOne({ _id: employeeId, isDeleted: false }).lean();
  if (!emp) return null;

  return {
    employeeId: emp._id,
    name: emp.name,
    designation: emp.designation,
    department: emp.department,
    email: emp.email,
    phoneNo: emp.phoneNo,
    profileImageUrl: emp.profileImage?.url,
  };
}

function buildCompanySnapshot(input?: Partial<ICompanySnapshot>): ICompanySnapshot {
  return {
    name: input?.name || 'Your Company',
    tagline: input?.tagline,
    logoUrl: input?.logoUrl,
    address: input?.address,
    email: input?.email,
    phoneNo: input?.phoneNo,
    website: input?.website,
    ntn: input?.ntn,
    strn: input?.strn,
    registrationNo: input?.registrationNo,
    bankDetails: input?.bankDetails,
  };
}

function buildProjectTransferSnapshot(
  proposal: any,
  actorId: mongoose.Types.ObjectId | null
): IProjectTransferSnapshot {
  const financialKeys = new Set<string>(PROPOSAL_FINANCIAL_SECTION_KEYS as readonly string[]);
  const sections = (proposal.sections ?? [])
    .filter((s: any) => !financialKeys.has(String(s.key).toLowerCase()))
    .map((s: any) => ({
      key: s.key,
      title: s.title,
      content: s.content ?? {},
      plainText: s.plainText,
      order: s.order ?? 0,
    }));

  const technical = proposal.technical ?? {};

  const milestones = (technical.proposedMilestones ?? []).map((m: any) => ({
    title: m.title,
    description: m.description,
    dueDate: m.dueDate,
  }));

  const financialBlockTypes = new Set(['pricing_table']);
  const pages = (technical.pages ?? []).map((p: any) => {
    const pg = plain<IProposalPage>(p);
    return {
      ...pg,
      blocks: (pg.blocks ?? []).filter((b) => !financialBlockTypes.has(String(b.type))),
    };
  });

  return {
    technical: {
      approach: technical.approach,
      techStack: technical.techStack,
      architectureSummary: technical.architectureSummary,
      modules: technical.modules,
      deliverables: technical.deliverables,
      assumptions: technical.assumptions,
      dependencies: technical.dependencies,
      outOfScope: technical.outOfScope,
      testingStrategy: technical.testingStrategy,
      supportPlan: technical.supportPlan,
      phases: technical.phases,
      estimatedDurationDays: technical.estimatedDurationDays,
      proposedMilestones: technical.proposedMilestones,
      pages,
      toc: technical.toc,
      defaults: technical.defaults,
    },
    sections,
    deliverables: technical.deliverables ?? [],
    assumptions: technical.assumptions ?? [],
    dependencies: technical.dependencies ?? [],
    outOfScope: technical.outOfScope ?? [],
    milestones,
    budget: proposal.totals?.total,
    currency: proposal.financial?.currency || 'PKR',
    transferredAt: new Date(),
    transferredBy: actorId,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// CREATE PROPOSAL
//   POST /api/proposals
// ═════════════════════════════════════════════════════════════════════════
export async function createProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      title,
      subtitle,
      proposalNumber,
      revisionNo,
      proposalType = 'project',
      parentProposalId,

      clientId,
      leadId,
      salespersonId,
      technicalLeadId,
      projectManagerId,

      companySnapshot,

      sections,
      technical,
      financial,
      lineItems,

      proposalDate,
      validUntil,

      status,

      projectCreationMode = 'auto',

      tags,
      internalNotes,

      createdBy,
    } = req.body;

    if (!title || !String(title).trim()) {
      res.status(400).json({ success: false, message: 'title is required' });
      return;
    }

    if (!PROPOSAL_TYPES.includes(proposalType)) {
      res.status(400).json({
        success: false,
        message: `Invalid proposalType. Allowed: ${PROPOSAL_TYPES.join(', ')}`,
      });
      return;
    }
    if (status !== undefined && !PROPOSAL_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${PROPOSAL_STATUSES.join(', ')}`,
      });
      return;
    }
    if (!PROJECT_CREATION_MODES.includes(projectCreationMode)) {
      res.status(400).json({
        success: false,
        message: `Invalid projectCreationMode. Allowed: ${PROJECT_CREATION_MODES.join(', ')}`,
      });
      return;
    }

    const sectionsRes = validateSections(sections);
    if (!sectionsRes.ok) {
      res.status(400).json({ success: false, message: sectionsRes.error });
      return;
    }
    const itemsRes = validateLineItems(lineItems);
    if (!itemsRes.ok) {
      res.status(400).json({ success: false, message: itemsRes.error });
      return;
    }
    const financialRes = validateFinancial(financial);
    if (!financialRes.ok) {
      res.status(400).json({ success: false, message: financialRes.error });
      return;
    }
    const technicalRes = validateTechnical(technical);
    if (!technicalRes.ok) {
      res.status(400).json({ success: false, message: technicalRes.error });
      return;
    }
    const tagsRes = validateTags(tags);
    if (!tagsRes.ok) {
      res.status(400).json({ success: false, message: tagsRes.error });
      return;
    }

    let resolvedClientId: mongoose.Types.ObjectId | null = null;
    if (clientId) {
      if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
        res.status(400).json({ success: false, message: 'Invalid clientId' });
        return;
      }
      const c = await Client.findOne({ _id: clientId, isDeleted: false }).select('_id');
      if (!c) {
        res.status(400).json({ success: false, message: 'Client not found' });
        return;
      }
      resolvedClientId = c._id;
    }

    let resolvedLeadId: mongoose.Types.ObjectId | null = null;
    if (leadId) {
      if (!mongoose.Types.ObjectId.isValid(String(leadId))) {
        res.status(400).json({ success: false, message: 'Invalid leadId' });
        return;
      }
      const l = await Lead.findOne({ _id: leadId, isDeleted: false }).select('_id');
      if (!l) {
        res.status(400).json({ success: false, message: 'Lead not found' });
        return;
      }
      resolvedLeadId = l._id;
    }

    let resolvedSalespersonId: mongoose.Types.ObjectId | null = null;
    if (salespersonId) {
      if (!mongoose.Types.ObjectId.isValid(String(salespersonId))) {
        res.status(400).json({ success: false, message: 'Invalid salespersonId' });
        return;
      }
      const e = await Employee.findOne({ _id: salespersonId, isDeleted: false }).select('_id');
      if (!e) {
        res.status(400).json({ success: false, message: 'Salesperson not found' });
        return;
      }
      resolvedSalespersonId = e._id;
    }

    let resolvedTechLeadId: mongoose.Types.ObjectId | null = null;
    if (technicalLeadId) {
      if (!mongoose.Types.ObjectId.isValid(String(technicalLeadId))) {
        res.status(400).json({ success: false, message: 'Invalid technicalLeadId' });
        return;
      }
      const e = await Employee.findOne({ _id: technicalLeadId, isDeleted: false }).select('_id');
      if (!e) {
        res.status(400).json({ success: false, message: 'Technical lead not found' });
        return;
      }
      resolvedTechLeadId = e._id;
    }

    let resolvedPmId: mongoose.Types.ObjectId | null = null;
    if (projectManagerId) {
      if (!mongoose.Types.ObjectId.isValid(String(projectManagerId))) {
        res.status(400).json({ success: false, message: 'Invalid projectManagerId' });
        return;
      }
      const e = await Employee.findOne({ _id: projectManagerId, isDeleted: false }).select('_id');
      if (!e) {
        res.status(400).json({ success: false, message: 'Project manager not found' });
        return;
      }
      resolvedPmId = e._id;
    }

    let resolvedParentId: mongoose.Types.ObjectId | null = null;
    if (parentProposalId) {
      if (!mongoose.Types.ObjectId.isValid(String(parentProposalId))) {
        res.status(400).json({ success: false, message: 'Invalid parentProposalId' });
        return;
      }
      const p = await Proposal.findOne({
        _id: parentProposalId,
        isDeleted: false,
      }).select('_id');
      if (!p) {
        res.status(400).json({ success: false, message: 'Parent proposal not found' });
        return;
      }
      resolvedParentId = p._id;
    }

    let creatorId: mongoose.Types.ObjectId | null = null;
    if (createdBy) {
      if (!mongoose.Types.ObjectId.isValid(String(createdBy))) {
        res.status(400).json({ success: false, message: 'Invalid createdBy id' });
        return;
      }
      const e = await Employee.findOne({ _id: createdBy, isDeleted: false }).select('_id');
      if (!e) {
        res.status(400).json({ success: false, message: 'createdBy employee not found' });
        return;
      }
      creatorId = e._id;
    } else if (req.user?._id) {
      creatorId = req.user._id;
    }

    let resolvedSections = sectionsRes.parsed ?? [];
    if (resolvedSections.length === 0) {
      resolvedSections = DEFAULT_PROPOSAL_SECTIONS.map((s, i) => ({
        key: s.key,
        title: s.title,
        content: {},
        order: i,
        visible: true,
      }));
    }

    const financialParsed = financialRes.parsed ?? {};
    const totals = computeProposalTotals(
      itemsRes.parsed ?? [],
      financialParsed,
      financialParsed.paymentMilestones ?? [],
      financialParsed.currency || 'PKR'
    );

    const clientSnapshot = await buildClientSnapshot(resolvedClientId);
    const salespersonSnapshot = await buildSalespersonSnapshot(resolvedSalespersonId);
    const companySnap = buildCompanySnapshot(companySnapshot);

    const technicalParsed = technicalRes.parsed ?? {};
    if (!Array.isArray(technicalParsed.pages)) technicalParsed.pages = [];
    if (!technicalParsed.defaults) {
      technicalParsed.defaults = {
        size: 'A4',
        orientation: 'portrait',
        margins: { top: 48, right: 48, bottom: 48, left: 48 },
      };
    }
    if (!technicalParsed.toc) {
      technicalParsed.toc = {
        enabled: false,
        title: 'Table of Contents',
        maxDepth: 3,
        showPageNumbers: true,
      };
    }

    const proposal = new Proposal({
      title: String(title).trim(),
      subtitle: str(subtitle, 300),
      proposalNumber: str(proposalNumber, 60),
      revisionNo: num(revisionNo) ?? 1,
      version: 1,
      parentProposalId: resolvedParentId,
      proposalType: proposalType as ProposalType,

      clientId: resolvedClientId,
      leadId: resolvedLeadId,
      salespersonId: resolvedSalespersonId,
      technicalLeadId: resolvedTechLeadId,
      projectManagerId: resolvedPmId,

      clientSnapshot,
      salespersonSnapshot,
      companySnapshot: companySnap,

      sections: resolvedSections,
      technical: technicalParsed,
      financial: financialParsed,
      lineItems: itemsRes.parsed ?? [],
      totals,

      proposalDate: date(proposalDate) ?? new Date(),
      validUntil: date(validUntil),

      status: (status as ProposalStatus) || 'draft',
      projectCreationMode: projectCreationMode as ProjectCreationMode,

      tags: tagsRes.parsed ?? [],
      internalNotes: str(internalNotes, 5000),

      createdBy: creatorId,
      updatedBy: creatorId,
    });

    await proposal.save();

    const fresh = await Proposal.findById(proposal._id)
      .populate('clientId', 'clientId name clientType status')
      .populate('leadId', 'leadId name companyName')
      .populate('salespersonId', 'name employeeId designation department email phoneNo')
      .populate('technicalLeadId', 'name employeeId designation')
      .populate('projectManagerId', 'name employeeId designation')
      .populate('createdBy', 'name employeeId');

    res.status(201).json({
      success: true,
      message: 'Proposal created successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('createProposal error:', err);

    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0] || 'field';
      res.status(409).json({
        success: false,
        message: `${field} is already registered`,
      });
      return;
    }

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

// ═════════════════════════════════════════════════════════════════════════
// LIST PROPOSALS
//   GET /api/proposals
// ═════════════════════════════════════════════════════════════════════════
export async function listProposals(req: AuthRequest, res: Response): Promise<void> {
  try {
    const {
      status,
      proposalType,
      clientId,
      leadId,
      salespersonId,
      projectId,
      pricingMode,
      projectCreationMode,
      isExpired,
      proposalDateFrom,
      proposalDateTo,
      search,
      tags,
      onlyDeleted,
      page = '1',
      limit = '20',
      sort = '-createdAt',
    } = req.query;

    const filter: any = {
      isDeleted: onlyDeleted === 'true',
    };

    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ProposalStatus => (PROPOSAL_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }

    if (proposalType) {
      const list = String(proposalType)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ProposalType => (PROPOSAL_TYPES as string[]).includes(s));
      if (list.length === 1) filter.proposalType = list[0];
      else if (list.length > 1) filter.proposalType = { $in: list };
    }

    if (clientId) {
      if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
        res.status(400).json({ success: false, message: 'Invalid clientId' });
        return;
      }
      filter.clientId = clientId;
    }
    if (leadId) {
      if (!mongoose.Types.ObjectId.isValid(String(leadId))) {
        res.status(400).json({ success: false, message: 'Invalid leadId' });
        return;
      }
      filter.leadId = leadId;
    }
    if (salespersonId) {
      if (!mongoose.Types.ObjectId.isValid(String(salespersonId))) {
        res.status(400).json({ success: false, message: 'Invalid salespersonId' });
        return;
      }
      filter.salespersonId = salespersonId;
    }
    if (projectId) {
      if (!mongoose.Types.ObjectId.isValid(String(projectId))) {
        res.status(400).json({ success: false, message: 'Invalid projectId' });
        return;
      }
      filter.projectId = projectId;
    }

    if (pricingMode) {
      if (!PRICING_MODES.includes(pricingMode as PricingMode)) {
        res.status(400).json({
          success: false,
          message: `Invalid pricingMode. Allowed: ${PRICING_MODES.join(', ')}`,
        });
        return;
      }
      filter['financial.pricingMode'] = pricingMode;
    }
    if (projectCreationMode) {
      if (!PROJECT_CREATION_MODES.includes(projectCreationMode as ProjectCreationMode)) {
        res.status(400).json({
          success: false,
          message: `Invalid projectCreationMode. Allowed: ${PROJECT_CREATION_MODES.join(', ')}`,
        });
        return;
      }
      filter.projectCreationMode = projectCreationMode;
    }

    if (isExpired === 'true') {
      filter.status = { $in: ['sent', 'viewed'] };
      filter.expiresAt = { $lt: new Date() };
    } else if (isExpired === 'false') {
      filter.$or = [
        { expiresAt: { $exists: false } },
        { expiresAt: null },
        { expiresAt: { $gte: new Date() } },
      ];
    }

    if (proposalDateFrom || proposalDateTo) {
      filter.proposalDate = {};
      if (proposalDateFrom) filter.proposalDate.$gte = new Date(String(proposalDateFrom));
      if (proposalDateTo) filter.proposalDate.$lte = new Date(String(proposalDateTo));
    }

    if (tags) {
      const tagList = String(tags)
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      if (tagList.length) filter.tags = { $in: tagList };
    }

    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { subtitle: { $regex: search, $options: 'i' } },
        { proposalId: { $regex: search, $options: 'i' } },
        { proposalNumber: { $regex: search, $options: 'i' } },
        { internalNotes: { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page as string));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string)));
    const skip = (pageNum - 1) * limitNum;

    const [proposals, total] = await Promise.all([
      Proposal.find(filter)
        .populate('clientId', 'clientId name clientType status')
        .populate('leadId', 'leadId name companyName')
        .populate('salespersonId', 'name employeeId designation department')
        .populate('projectId', 'projectId name status')
        .populate('createdBy', 'name employeeId')
        .sort(sort as string)
        .skip(skip)
        .limit(limitNum),
      Proposal.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: proposals,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  } catch (err: any) {
    console.error('listProposals error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// LIST PROPOSAL OPTIONS
// ═════════════════════════════════════════════════════════════════════════
export async function listProposalOptions(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { search, status, clientId, limit = '100' } = req.query;

    const filter: any = { isDeleted: false };

    if (search) {
      filter.$or = [
        { title: { $regex: String(search), $options: 'i' } },
        { proposalId: { $regex: String(search), $options: 'i' } },
        { proposalNumber: { $regex: String(search), $options: 'i' } },
      ];
    }
    if (status) {
      const list = String(status)
        .split(',')
        .map((s) => s.trim())
        .filter((s): s is ProposalStatus => (PROPOSAL_STATUSES as string[]).includes(s));
      if (list.length === 1) filter.status = list[0];
      else if (list.length > 1) filter.status = { $in: list };
    }
    if (clientId) {
      if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
        res.status(400).json({ success: false, message: 'Invalid clientId' });
        return;
      }
      filter.clientId = clientId;
    }

    const limitNum = Math.min(500, Math.max(1, parseInt(String(limit), 10) || 100));

    const proposals = await Proposal.find(filter)
      .select('_id proposalId title status proposalDate totals.total totals.currency')
      .sort('-proposalDate')
      .limit(limitNum)
      .lean();

    res.json({ success: true, data: proposals });
  } catch (err: any) {
    console.error('listProposalOptions error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// GET PROPOSAL BY ID
// ═════════════════════════════════════════════════════════════════════════
export async function getProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId))
      .populate('clientId', 'clientId name clientType status email phoneNo')
      .populate('leadId', 'leadId name companyName email phoneNo status')
      .populate('salespersonId', 'name employeeId designation department phoneNo email')
      .populate('technicalLeadId', 'name employeeId designation department')
      .populate('projectManagerId', 'name employeeId designation department')
      .populate('projectId', 'projectId name status progress')
      .populate('createdBy', 'name employeeId')
      .populate('updatedBy', 'name employeeId');

    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    res.json({ success: true, data: proposal });
  } catch (err: any) {
    console.error('getProposal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// UPDATE PROPOSAL
//   PATCH /api/proposals/:proposalId
// ═════════════════════════════════════════════════════════════════════════
export async function updateProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    const isMainAdmin = req.user!.isMainAdmin;
    const canEdit = await req.user!.can('proposals', 'edit');
    if (!isMainAdmin && !canEdit) {
      res.status(403).json({ success: false, message: 'You cannot edit proposals' });
      return;
    }

    if (proposal.isLocked && !isMainAdmin) {
      res.status(400).json({
        success: false,
        message: 'Proposal is locked (accepted/rejected). Create a revision to make changes.',
      });
      return;
    }

    const {
      title,
      subtitle,
      proposalNumber,
      proposalType,

      clientId,
      leadId,
      salespersonId,
      technicalLeadId,
      projectManagerId,

      companySnapshot,

      sections,
      technical,
      financial,
      lineItems,

      proposalDate,
      validUntil,

      status,
      statusReason,

      projectCreationMode,

      tags,
      internalNotes,
    } = req.body;

    if (proposalType !== undefined && !PROPOSAL_TYPES.includes(proposalType)) {
      res.status(400).json({
        success: false,
        message: `Invalid proposalType. Allowed: ${PROPOSAL_TYPES.join(', ')}`,
      });
      return;
    }
    if (status !== undefined && !PROPOSAL_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${PROPOSAL_STATUSES.join(', ')}`,
      });
      return;
    }
    if (
      projectCreationMode !== undefined &&
      !PROJECT_CREATION_MODES.includes(projectCreationMode)
    ) {
      res.status(400).json({
        success: false,
        message: `Invalid projectCreationMode. Allowed: ${PROJECT_CREATION_MODES.join(', ')}`,
      });
      return;
    }

    let parsedSections: IProposalSection[] | undefined;
    if (sections !== undefined) {
      const r = validateSections(sections);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedSections = r.parsed;
    }

    let parsedItems: IProposalLineItem[] | undefined;
    if (lineItems !== undefined) {
      const r = validateLineItems(lineItems);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedItems = r.parsed;
    }

    let parsedFinancial: Record<string, any> | undefined;
    if (financial !== undefined) {
      const r = validateFinancial(financial);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedFinancial = r.parsed;
    }

    let parsedTechnical: Record<string, any> | undefined;
    if (technical !== undefined) {
      const r = validateTechnical(technical);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedTechnical = r.parsed;
    }

    let parsedTags: string[] | undefined;
    if (tags !== undefined) {
      const r = validateTags(tags);
      if (!r.ok) {
        res.status(400).json({ success: false, message: r.error });
        return;
      }
      parsedTags = r.parsed;
    }

    let resolvedClientId: mongoose.Types.ObjectId | null | undefined;
    let newClientSnapshot: IClientSnapshot | null | undefined;

    if (clientId !== undefined) {
      if (clientId === null || clientId === '') {
        resolvedClientId = null;
        newClientSnapshot = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(clientId))) {
          res.status(400).json({ success: false, message: 'Invalid clientId' });
          return;
        }
        const c = await Client.findOne({ _id: clientId, isDeleted: false }).select('_id');
        if (!c) {
          res.status(400).json({ success: false, message: 'Client not found' });
          return;
        }
        resolvedClientId = c._id;
        newClientSnapshot = await buildClientSnapshot(c._id);
      }
    }

    let resolvedLeadId: mongoose.Types.ObjectId | null | undefined;
    if (leadId !== undefined) {
      if (leadId === null || leadId === '') {
        resolvedLeadId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(leadId))) {
          res.status(400).json({ success: false, message: 'Invalid leadId' });
          return;
        }
        const l = await Lead.findOne({ _id: leadId, isDeleted: false }).select('_id');
        if (!l) {
          res.status(400).json({ success: false, message: 'Lead not found' });
          return;
        }
        resolvedLeadId = l._id;
      }
    }

    let resolvedSalespersonId: mongoose.Types.ObjectId | null | undefined;
    let newSalespersonSnapshot: ISalespersonSnapshot | null | undefined;

    if (salespersonId !== undefined) {
      if (salespersonId === null || salespersonId === '') {
        resolvedSalespersonId = null;
        newSalespersonSnapshot = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(salespersonId))) {
          res.status(400).json({ success: false, message: 'Invalid salespersonId' });
          return;
        }
        const e = await Employee.findOne({ _id: salespersonId, isDeleted: false }).select('_id');
        if (!e) {
          res.status(400).json({ success: false, message: 'Salesperson not found' });
          return;
        }
        resolvedSalespersonId = e._id;
        newSalespersonSnapshot = await buildSalespersonSnapshot(e._id);
      }
    }

    let resolvedTechLeadId: mongoose.Types.ObjectId | null | undefined;
    if (technicalLeadId !== undefined) {
      if (technicalLeadId === null || technicalLeadId === '') {
        resolvedTechLeadId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(technicalLeadId))) {
          res.status(400).json({ success: false, message: 'Invalid technicalLeadId' });
          return;
        }
        const e = await Employee.findOne({ _id: technicalLeadId, isDeleted: false }).select('_id');
        if (!e) {
          res.status(400).json({ success: false, message: 'Technical lead not found' });
          return;
        }
        resolvedTechLeadId = e._id;
      }
    }

    let resolvedPmId: mongoose.Types.ObjectId | null | undefined;
    if (projectManagerId !== undefined) {
      if (projectManagerId === null || projectManagerId === '') {
        resolvedPmId = null;
      } else {
        if (!mongoose.Types.ObjectId.isValid(String(projectManagerId))) {
          res.status(400).json({ success: false, message: 'Invalid projectManagerId' });
          return;
        }
        const e = await Employee.findOne({ _id: projectManagerId, isDeleted: false }).select('_id');
        if (!e) {
          res.status(400).json({ success: false, message: 'Project manager not found' });
          return;
        }
        resolvedPmId = e._id;
      }
    }

    if (title !== undefined) proposal.title = String(title).trim();
    if (subtitle !== undefined) proposal.subtitle = str(subtitle, 300);
    if (proposalNumber !== undefined) proposal.proposalNumber = str(proposalNumber, 60);
    if (proposalType !== undefined) proposal.proposalType = proposalType as ProposalType;

    if (resolvedClientId !== undefined) proposal.clientId = resolvedClientId;
    if (newClientSnapshot !== undefined) proposal.clientSnapshot = newClientSnapshot;
    if (resolvedLeadId !== undefined) proposal.leadId = resolvedLeadId;
    if (resolvedSalespersonId !== undefined) proposal.salespersonId = resolvedSalespersonId;
    if (newSalespersonSnapshot !== undefined) proposal.salespersonSnapshot = newSalespersonSnapshot;
    if (resolvedTechLeadId !== undefined) proposal.technicalLeadId = resolvedTechLeadId;
    if (resolvedPmId !== undefined) proposal.projectManagerId = resolvedPmId;

    if (companySnapshot !== undefined) {
      proposal.companySnapshot = buildCompanySnapshot(companySnapshot);
    }

    if (parsedSections !== undefined) {
      proposal.sections = parsedSections;
      proposal.markModified('sections');
    }
    if (parsedItems !== undefined) {
      proposal.lineItems = parsedItems;
      proposal.markModified('lineItems');
    }
    if (parsedFinancial !== undefined) {
      proposal.financial = {
        ...(proposal.financial || {}),
        ...parsedFinancial,
      } as any;
      proposal.markModified('financial');
    }
    if (parsedTechnical !== undefined) {
      const merged: any = {
        ...(proposal.technical || {}),
        ...parsedTechnical,
      };
      if (parsedTechnical.pages !== undefined) {
        merged.pages = parsedTechnical.pages;
      }
      if (parsedTechnical.toc !== undefined) {
        merged.toc = parsedTechnical.toc;
      }
      if (parsedTechnical.defaults !== undefined) {
        merged.defaults = parsedTechnical.defaults;
      }
      proposal.technical = merged;
      proposal.markModified('technical');
    }

    if (proposalDate !== undefined) {
      proposal.proposalDate = date(proposalDate) ?? new Date();
    }
    if (validUntil !== undefined) proposal.validUntil = date(validUntil);

    if (status !== undefined) proposal.status = status as ProposalStatus;
    if (statusReason !== undefined) {
      proposal.statusReason = str(statusReason, 500);
    }
    if (projectCreationMode !== undefined) {
      proposal.projectCreationMode = projectCreationMode as ProjectCreationMode;
    }

    if (parsedTags !== undefined) {
      proposal.tags = parsedTags;
      proposal.markModified('tags');
    }
    if (internalNotes !== undefined) {
      proposal.internalNotes = str(internalNotes, 5000);
    }

    proposal.updatedBy = req.user?._id ?? null;

    await proposal.save();

    const fresh = await Proposal.findById(proposal._id)
      .populate('clientId', 'clientId name clientType status')
      .populate('leadId', 'leadId name companyName')
      .populate('salespersonId', 'name employeeId designation department')
      .populate('projectId', 'projectId name status')
      .populate('createdBy', 'name employeeId');

    res.json({
      success: true,
      message: 'Proposal updated successfully',
      data: fresh,
    });
  } catch (err: any) {
    console.error('updateProposal error:', err);

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

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: SECTIONS
// ═════════════════════════════════════════════════════════════════════════
export async function addProposalSection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const r = validateSections([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid section' });
      return;
    }
    const section = r.parsed[0];

    if (proposal.sections.some((s) => s.key === section.key)) {
      res.status(409).json({
        success: false,
        message: `Section with key "${section.key}" already exists`,
      });
      return;
    }

    if (!Number.isFinite(Number((req.body as any).order))) {
      section.order = proposal.sections.length;
    }

    proposal.sections.push(section);
    proposal.markModified('sections');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.status(201).json({
      success: true,
      message: 'Section added',
      data: proposal.sections,
    });
  } catch (err: any) {
    console.error('addProposalSection error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProposalSection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const sectionKey = asString(req.params.sectionKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const section = proposal.sections.find(
      (s) => String(s.key).toLowerCase() === sectionKey.toLowerCase()
    );
    if (!section) {
      res.status(404).json({ success: false, message: 'Section not found' });
      return;
    }

    const { title, content, plainText, order, visible, locked } = req.body;

    if (title !== undefined) section.title = String(title).trim().slice(0, 200);
    if (content !== undefined && typeof content === 'object') {
      section.content = content;
    }
    if (plainText !== undefined) section.plainText = str(plainText, 20000);
    if (order !== undefined && Number.isFinite(Number(order))) {
      section.order = Number(order);
    }
    if (visible !== undefined) section.visible = visible === true;
    if (locked !== undefined) section.locked = locked === true;

    proposal.markModified('sections');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Section updated',
      data: proposal.sections,
    });
  } catch (err: any) {
    console.error('updateProposalSection error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProposalSection(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const sectionKey = asString(req.params.sectionKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const before = proposal.sections.length;
    proposal.sections = proposal.sections.filter(
      (s) => String(s.key).toLowerCase() !== sectionKey.toLowerCase() || s.locked === true
    );

    if (proposal.sections.length === before) {
      res.status(404).json({
        success: false,
        message: 'Section not found or is locked',
      });
      return;
    }

    proposal.markModified('sections');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Section removed',
      data: proposal.sections,
    });
  } catch (err: any) {
    console.error('removeProposalSection error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: LINE ITEMS
// ═════════════════════════════════════════════════════════════════════════
export async function addProposalLineItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const r = validateLineItems([req.body]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid line item' });
      return;
    }
    const item = r.parsed[0];

    if (!Number.isFinite(Number((req.body as any).order))) {
      item.order = proposal.lineItems.length;
    }

    proposal.lineItems.push(item);
    proposal.markModified('lineItems');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.status(201).json({
      success: true,
      message: 'Line item added',
      data: proposal.lineItems,
      totals: proposal.totals,
    });
  } catch (err: any) {
    console.error('addProposalLineItem error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProposalLineItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const lineItemId = asString(req.params.lineItemId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const item = proposal.lineItems.find(
      (i: any) => String(i._id) === lineItemId
    );
    if (!item) {
      res.status(404).json({ success: false, message: 'Line item not found' });
      return;
    }

    const merged = {
      ...(item as any),
      ...req.body,
      _id: (item as any)._id,
    };
    const r = validateLineItems([merged]);
    if (!r.ok || !r.parsed?.length) {
      res.status(400).json({ success: false, message: r.error || 'Invalid line item' });
      return;
    }
    const updated = r.parsed[0];

    Object.assign(item, updated);
    proposal.markModified('lineItems');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Line item updated',
      data: proposal.lineItems,
      totals: proposal.totals,
    });
  } catch (err: any) {
    console.error('updateProposalLineItem error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProposalLineItem(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const lineItemId = asString(req.params.lineItemId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const before = proposal.lineItems.length;
    proposal.lineItems = proposal.lineItems.filter(
      (i: any) => String(i._id) !== lineItemId
    );

    if (proposal.lineItems.length === before) {
      res.status(404).json({ success: false, message: 'Line item not found' });
      return;
    }

    proposal.markModified('lineItems');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Line item removed',
      data: proposal.lineItems,
      totals: proposal.totals,
    });
  } catch (err: any) {
    console.error('removeProposalLineItem error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: PAYMENT MILESTONES
// ═════════════════════════════════════════════════════════════════════════
export async function setProposalPaymentMilestones(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const r = validatePaymentMilestones(req.body.paymentMilestones);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }

    proposal.financial.paymentMilestones = r.parsed ?? [];
    proposal.markModified('financial');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Payment milestones updated',
      data: proposal.financial.paymentMilestones,
      totals: proposal.totals,
    });
  } catch (err: any) {
    console.error('setProposalPaymentMilestones error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function markMilestonePaid(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const milestoneId = asString(req.params.milestoneId);
    const { isPaid } = req.body;

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    const milestone: any = proposal.financial.paymentMilestones.find(
      (m: any) => String(m._id) === milestoneId
    );
    if (!milestone) {
      res.status(404).json({ success: false, message: 'Milestone not found' });
      return;
    }

    milestone.isPaid = isPaid === true;
    milestone.paidAt = milestone.isPaid ? new Date() : undefined;
    proposal.markModified('financial');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Milestone updated',
      data: proposal.financial.paymentMilestones,
    });
  } catch (err: any) {
    console.error('markMilestonePaid error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: PAGES
// ═════════════════════════════════════════════════════════════════════════

export async function addProposalPage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const pages = proposal.technical?.pages ?? [];
    if (pages.length >= PROPOSAL_PAGES_MAX) {
      res.status(400).json({
        success: false,
        message: `Maximum ${PROPOSAL_PAGES_MAX} pages allowed`,
      });
      return;
    }

    const defaults = (proposal.technical?.defaults as any) || {};
    const bodyWithDefaults = {
      ...req.body,
      size: req.body.size ?? defaults.size ?? 'A4',
      orientation: req.body.orientation ?? defaults.orientation ?? 'portrait',
      margins: req.body.margins ?? defaults.margins,
    };

    const r = validatePage(bodyWithDefaults, pages.length);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }
    const page = r.parsed!;

    if (!Number.isFinite(Number(req.body?.order))) {
      page.order = pages.length;
    }

    if (!proposal.technical) proposal.technical = {} as any;
    proposal.technical.pages.push(page);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.status(201).json({
      success: true,
      message: 'Page added',
      data: page,
      pages: proposal.technical.pages,
    });
  } catch (err: any) {
    console.error('addProposalPage error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProposalPage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const page = (proposal.technical?.pages ?? []).find((p: any) => p.key === pageKey);
    if (!page) {
      res.status(404).json({ success: false, message: 'Page not found' });
      return;
    }

    const merged: any = { ...plain<IProposalPage>(page), ...req.body, key: page.key };
    const r = validatePage(merged, page.order ?? 0);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }

    Object.assign(page, r.parsed!);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Page updated',
      data: page,
      pages: proposal.technical.pages,
    });
  } catch (err: any) {
    console.error('updateProposalPage error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProposalPage(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const pages = proposal.technical?.pages ?? [];
    const before = pages.length;
    proposal.technical.pages = pages.filter((p: any) => p.key !== pageKey);

    if (proposal.technical.pages.length === before) {
      res.status(404).json({ success: false, message: 'Page not found' });
      return;
    }

    reorderPages(proposal.technical as any);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Page removed',
      pages: proposal.technical.pages,
    });
  } catch (err: any) {
    console.error('removeProposalPage error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function reorderProposalPages(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const { order } = req.body;

    if (!Array.isArray(order)) {
      res.status(400).json({ success: false, message: 'order must be an array of page keys' });
      return;
    }

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const pages = proposal.technical?.pages ?? [];
    const map = new Map(pages.map((p: any) => [p.key, p]));
    const reordered: any[] = [];

    order.forEach((key: string, i: number) => {
      const p = map.get(key);
      if (p) {
        p.order = i;
        reordered.push(p);
        map.delete(key);
      }
    });
    let tail = reordered.length;
    for (const p of map.values()) {
      p.order = tail++;
      reordered.push(p);
    }

    proposal.technical.pages = reordered;
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Pages reordered',
      pages: proposal.technical.pages,
    });
  } catch (err: any) {
    console.error('reorderProposalPages error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: BLOCKS
// ═════════════════════════════════════════════════════════════════════════

export async function addProposalBlock(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const page = (proposal.technical?.pages ?? []).find((p: any) => p.key === pageKey);
    if (!page) {
      res.status(404).json({ success: false, message: 'Page not found' });
      return;
    }
    if ((page.blocks?.length ?? 0) >= PROPOSAL_BLOCKS_PER_PAGE_MAX) {
      res.status(400).json({
        success: false,
        message: `Maximum ${PROPOSAL_BLOCKS_PER_PAGE_MAX} blocks per page`,
      });
      return;
    }

    const r = validateBlock(req.body, page.blocks?.length ?? 0);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }
    const block = r.parsed!;

    if (!Number.isFinite(Number(req.body?.order))) {
      block.order = page.blocks?.length ?? 0;
    }

    page.blocks.push(block);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.status(201).json({
      success: true,
      message: 'Block added',
      data: block,
      blocks: page.blocks,
    });
  } catch (err: any) {
    console.error('addProposalBlock error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProposalBlock(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const blockKey = asString(req.params.blockKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const page = (proposal.technical?.pages ?? []).find((p: any) => p.key === pageKey);
    if (!page) {
      res.status(404).json({ success: false, message: 'Page not found' });
      return;
    }

    const block = (page.blocks ?? []).find((b: any) => b.key === blockKey);
    if (!block) {
      res.status(404).json({ success: false, message: 'Block not found' });
      return;
    }

    const merged: any = {
      ...plain<IProposalBlock>(block),
      ...req.body,
      key: block.key,
    };
    const r = validateBlock(merged, block.order ?? 0);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }

    Object.assign(block, r.parsed!);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Block updated',
      data: block,
      blocks: page.blocks,
    });
  } catch (err: any) {
    console.error('updateProposalBlock error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProposalBlock(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const blockKey = asString(req.params.blockKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const page = (proposal.technical?.pages ?? []).find((p: any) => p.key === pageKey);
    if (!page) {
      res.status(404).json({ success: false, message: 'Page not found' });
      return;
    }

    const before = page.blocks.length;
    page.blocks = page.blocks.filter((b: any) => b.key !== blockKey);

    if (page.blocks.length === before) {
      res.status(404).json({ success: false, message: 'Block not found' });
      return;
    }

    reorderBlocks(page as any);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Block removed',
      blocks: page.blocks,
    });
  } catch (err: any) {
    console.error('removeProposalBlock error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function reorderProposalBlocks(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const { order } = req.body;

    if (!Array.isArray(order)) {
      res.status(400).json({ success: false, message: 'order must be an array of block keys' });
      return;
    }

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const page = (proposal.technical?.pages ?? []).find((p: any) => p.key === pageKey);
    if (!page) {
      res.status(404).json({ success: false, message: 'Page not found' });
      return;
    }

    const map = new Map(page.blocks.map((b: any) => [b.key, b]));
    const reordered: any[] = [];
    order.forEach((key: string, i: number) => {
      const b = map.get(key);
      if (b) {
        b.order = i;
        reordered.push(b);
        map.delete(key);
      }
    });
    let tail = reordered.length;
    for (const b of map.values()) {
      b.order = tail++;
      reordered.push(b);
    }

    page.blocks = reordered;
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Blocks reordered',
      blocks: page.blocks,
    });
  } catch (err: any) {
    console.error('reorderProposalBlocks error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// SUB-RESOURCE: TABLE ROWS / COLUMNS
// ═════════════════════════════════════════════════════════════════════════

function locateTable(
  proposal: any,
  pageKey: string,
  blockKey: string
): { page: any; block: any; table: ITableBlockData } | null {
  const page = (proposal.technical?.pages ?? []).find((p: any) => p.key === pageKey);
  if (!page) return null;
  const block = (page.blocks ?? []).find((b: any) => b.key === blockKey);
  if (!block || block.type !== 'table' || !block.table) return null;
  return { page, block, table: block.table };
}

export async function addProposalTableColumn(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const blockKey = asString(req.params.blockKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const found = locateTable(proposal, pageKey, blockKey);
    if (!found) {
      res.status(404).json({ success: false, message: 'Table block not found' });
      return;
    }
    const { table } = found;

    if (table.columns.length >= PROPOSAL_TABLE_COLUMNS_MAX) {
      res.status(400).json({
        success: false,
        message: `Maximum ${PROPOSAL_TABLE_COLUMNS_MAX} columns`,
      });
      return;
    }

    const r = validateTableColumn(req.body, table.columns.length);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }
    const col = r.parsed!;

    if (table.columns.some((c: any) => c.key === col.key)) {
      res.status(409).json({
        success: false,
        message: `Column key "${col.key}" already exists`,
      });
      return;
    }

    addTableColumn(table, col);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.status(201).json({
      success: true,
      message: 'Column added',
      data: col,
      table: found.table,
    });
  } catch (err: any) {
    console.error('addProposalTableColumn error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProposalTableColumn(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const blockKey = asString(req.params.blockKey);
    const columnKey = asString(req.params.columnKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const found = locateTable(proposal, pageKey, blockKey);
    if (!found) {
      res.status(404).json({ success: false, message: 'Table block not found' });
      return;
    }
    const { table } = found;

    if (!table.columns.some((c: any) => c.key === columnKey)) {
      res.status(404).json({ success: false, message: 'Column not found' });
      return;
    }
    if (table.columns.length <= 1) {
      res.status(400).json({
        success: false,
        message: 'Cannot remove the last remaining column',
      });
      return;
    }

    removeTableColumn(table, columnKey);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Column removed',
      table: found.table,
    });
  } catch (err: any) {
    console.error('removeProposalTableColumn error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function addProposalTableRow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const blockKey = asString(req.params.blockKey);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const found = locateTable(proposal, pageKey, blockKey);
    if (!found) {
      res.status(404).json({ success: false, message: 'Table block not found' });
      return;
    }
    const { table } = found;

    if (table.rows.length >= PROPOSAL_TABLE_ROWS_MAX) {
      res.status(400).json({
        success: false,
        message: `Maximum ${PROPOSAL_TABLE_ROWS_MAX} rows`,
      });
      return;
    }

    const validKeys = new Set(table.columns.map((c: any) => c.key));
    const r = validateTableRow(req.body, table.rows.length, validKeys);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }
    const row = r.parsed!;

    addTableRow(table, row.cells);
    const created = table.rows[table.rows.length - 1];
    if (row.isHeader) created.isHeader = true;
    if (row.isSubtotal) created.isSubtotal = true;
    if (row.notes) created.notes = row.notes;

    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.status(201).json({
      success: true,
      message: 'Row added',
      data: created,
      table: found.table,
    });
  } catch (err: any) {
    console.error('addProposalTableRow error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProposalTableRow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const blockKey = asString(req.params.blockKey);
    const rowId = asString(req.params.rowId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const found = locateTable(proposal, pageKey, blockKey);
    if (!found) {
      res.status(404).json({ success: false, message: 'Table block not found' });
      return;
    }
    const { table } = found;

    const row: any = table.rows.find((r: any) => String(r._id) === rowId);
    if (!row) {
      res.status(404).json({ success: false, message: 'Row not found' });
      return;
    }

    const validKeys = new Set(table.columns.map((c: any) => c.key));
    const merged = {
      cells: { ...(row.cells ?? {}), ...((req.body && req.body.cells) ?? {}) },
      isHeader: req.body.isHeader ?? row.isHeader,
      isSubtotal: req.body.isSubtotal ?? row.isSubtotal,
      notes: req.body.notes ?? row.notes,
    };
    const r = validateTableRow(merged, 0, validKeys);
    if (!r.ok) {
      res.status(400).json({ success: false, message: r.error });
      return;
    }

    Object.assign(row, r.parsed!);
    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Row updated',
      data: row,
      table: found.table,
    });
  } catch (err: any) {
    console.error('updateProposalTableRow error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function removeProposalTableRow(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const pageKey = asString(req.params.pageKey);
    const blockKey = asString(req.params.blockKey);
    const rowId = asString(req.params.rowId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    const found = locateTable(proposal, pageKey, blockKey);
    if (!found) {
      res.status(404).json({ success: false, message: 'Table block not found' });
      return;
    }
    const { table } = found;

    const before = table.rows.length;
    table.rows = table.rows.filter((r: any) => String(r._id) !== rowId);
    if (table.rows.length === before) {
      res.status(404).json({ success: false, message: 'Row not found' });
      return;
    }

    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Row removed',
      table: found.table,
    });
  } catch (err: any) {
    console.error('removeProposalTableRow error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// TOC / PAGE DEFAULTS
// ═════════════════════════════════════════════════════════════════════════

export async function getProposalTableOfContents(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    const maxDepth = (proposal.technical?.toc?.maxDepth ?? 3) as HeadingLevel;
    const entries = buildTableOfContents(proposal.technical as any, maxDepth);

    res.json({
      success: true,
      data: {
        enabled: proposal.technical?.toc?.enabled ?? false,
        title: proposal.technical?.toc?.title ?? 'Table of Contents',
        maxDepth,
        showPageNumbers: proposal.technical?.toc?.showPageNumbers !== false,
        entries,
      },
    });
  } catch (err: any) {
    console.error('getProposalTableOfContents error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProposalTocSettings(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    if (!proposal.technical) proposal.technical = {} as any;
    const t = proposal.technical as any;
    if (!t.toc) {
      t.toc = { enabled: false, title: 'Table of Contents', maxDepth: 3, showPageNumbers: true };
    }

    const { enabled, title, maxDepth, showPageNumbers } = req.body;
    if (enabled !== undefined) t.toc.enabled = enabled === true;
    if (title !== undefined) t.toc.title = str(title, 120) || 'Table of Contents';
    if (maxDepth !== undefined) {
      const md = num(maxDepth);
      if (md !== undefined && md >= 1 && md <= PROPOSAL_TOC_MAX_DEPTH) {
        t.toc.maxDepth = md as HeadingLevel;
      }
    }
    if (showPageNumbers !== undefined) t.toc.showPageNumbers = showPageNumbers !== false;

    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'TOC settings updated',
      data: t.toc,
    });
  } catch (err: any) {
    console.error('updateProposalTocSettings error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function updateProposalPageDefaults(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.isLocked && !req.user!.isMainAdmin) {
      res.status(400).json({ success: false, message: 'Proposal is locked' });
      return;
    }

    if (!proposal.technical) proposal.technical = {} as any;
    const t = proposal.technical as any;
    const existing = t.defaults ?? {};

    const body = req.body || {};
    const size = body.size ?? existing.size ?? 'A4';
    const orientation = body.orientation ?? existing.orientation ?? 'portrait';
    if (!PAGE_SIZES.includes(size)) {
      res.status(400).json({
        success: false,
        message: `size must be one of: ${PAGE_SIZES.join(', ')}`,
      });
      return;
    }
    if (!PAGE_ORIENTATIONS.includes(orientation)) {
      res.status(400).json({
        success: false,
        message: `orientation must be one of: ${PAGE_ORIENTATIONS.join(', ')}`,
      });
      return;
    }

    t.defaults = {
      size,
      orientation,
      margins: {
        top: num(body.margins?.top) ?? existing.margins?.top ?? 48,
        right: num(body.margins?.right) ?? existing.margins?.right ?? 48,
        bottom: num(body.margins?.bottom) ?? existing.margins?.bottom ?? 48,
        left: num(body.margins?.left) ?? existing.margins?.left ?? 48,
      },
    };

    proposal.markModified('technical');
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Page defaults updated',
      data: t.defaults,
    });
  } catch (err: any) {
    console.error('updateProposalPageDefaults error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// STATUS TRANSITIONS
// ═════════════════════════════════════════════════════════════════════════

export async function changeProposalStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const { status, statusReason } = req.body;

    if (!status || !PROPOSAL_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `Invalid status. Allowed: ${PROPOSAL_STATUSES.join(', ')}`,
      });
      return;
    }

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    const previous = proposal.status;
    proposal.status = status as ProposalStatus;
    if (statusReason !== undefined) {
      proposal.statusReason = str(statusReason, 500);
    }
    proposal.updatedBy = req.user?._id ?? null;

    await proposal.save();

    let createdProjectId: string | null = null;
    if (
      status === 'accepted' &&
      previous !== 'accepted' &&
      proposal.projectCreationMode === 'auto'
    ) {
      const result = await createProjectFromProposal(proposal, req.user?._id ?? null);
      if (result.ok) {
        createdProjectId = String(result.projectId);
      } else {
        console.warn(
          `Auto-project creation failed for proposal ${proposal.proposalId}: ${result.error}`
        );
      }
    }

    const fresh = await Proposal.findById(proposal._id)
      .populate('clientId', 'clientId name clientType status')
      .populate('salespersonId', 'name employeeId designation department')
      .populate('projectId', 'projectId name status');

    res.json({
      success: true,
      message: createdProjectId
        ? 'Proposal accepted and project created'
        : 'Proposal status updated',
      data: fresh,
      projectId: createdProjectId,
    });
  } catch (err: any) {
    console.error('changeProposalStatus error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function acceptProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const {
      clientSignatureUrl,
      clientSignedByName,
      clientSignedByDesignation,
      clientSignedAt,
      forceCreateProject,
    } = req.body;

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    if (proposal.status === 'accepted') {
      res.status(400).json({ success: false, message: 'Proposal is already accepted' });
      return;
    }

    if (!proposal.clientId) {
      res.status(400).json({
        success: false,
        message: 'Cannot accept a proposal without a linked client',
      });
      return;
    }

    proposal.status = 'accepted';
    proposal.acceptedAt = new Date();
    proposal.isLocked = true;
    if (clientSignatureUrl !== undefined) {
      proposal.clientSignatureUrl = str(clientSignatureUrl, 500);
    }
    if (clientSignedByName !== undefined) {
      proposal.clientSignedByName = str(clientSignedByName, 120);
    }
    if (clientSignedByDesignation !== undefined) {
      proposal.clientSignedByDesignation = str(clientSignedByDesignation, 120);
    }
    proposal.clientSignedAt = date(clientSignedAt) ?? new Date();
    proposal.updatedBy = req.user?._id ?? null;

    await proposal.save();

    let createdProjectId: string | null = null;
    const shouldCreate =
      forceCreateProject === true || proposal.projectCreationMode === 'auto';

    if (shouldCreate) {
      const result = await createProjectFromProposal(proposal, req.user?._id ?? null);
      if (result.ok) {
        createdProjectId = String(result.projectId);
      } else {
        console.warn(
          `Project creation failed for proposal ${proposal.proposalId}: ${result.error}`
        );
      }
    }

    if (proposal.leadId) {
      try {
        await Lead.updateOne(
          { _id: proposal.leadId, isDeleted: false },
          {
            $set: {
              status: 'won',
              clientId: proposal.clientId,
              convertedAt: new Date(),
              convertedBy: req.user?._id ?? null,
            },
          }
        );
      } catch (leadErr) {
        console.warn('Failed to update lead on accept:', leadErr);
      }
    }

    const fresh = await Proposal.findById(proposal._id)
      .populate('clientId', 'clientId name clientType status')
      .populate('leadId', 'leadId name companyName status')
      .populate('salespersonId', 'name employeeId designation department')
      .populate('projectId', 'projectId name status');

    res.json({
      success: true,
      message: createdProjectId
        ? 'Proposal accepted and project created'
        : 'Proposal accepted',
      data: fresh,
      projectId: createdProjectId,
    });
  } catch (err: any) {
    console.error('acceptProposal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function rejectProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const { statusReason } = req.body;

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    proposal.status = 'rejected';
    proposal.rejectedAt = new Date();
    proposal.isLocked = true;
    if (statusReason !== undefined) {
      proposal.statusReason = str(statusReason, 500);
    }
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Proposal rejected',
      data: proposal,
    });
  } catch (err: any) {
    console.error('rejectProposal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function sendProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    if (proposal.status !== 'draft' && proposal.status !== 'internal_review') {
      res.status(400).json({
        success: false,
        message: `Cannot send a proposal in status "${proposal.status}"`,
      });
      return;
    }

    proposal.status = 'sent';
    proposal.sentAt = new Date();
    if (!proposal.validUntil && proposal.financial?.validityDays) {
      const d = new Date();
      d.setDate(d.getDate() + proposal.financial.validityDays);
      proposal.validUntil = d;
      proposal.expiresAt = d;
    }
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Proposal sent',
      data: proposal,
    });
  } catch (err: any) {
    console.error('sendProposal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function createProjectFromProposalHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }
    if (proposal.status !== 'accepted') {
      res.status(400).json({
        success: false,
        message: 'Only accepted proposals can create projects',
      });
      return;
    }
    if (proposal.projectId) {
      res.status(400).json({
        success: false,
        message: 'Project already exists for this proposal',
        projectId: proposal.projectId,
      });
      return;
    }

    const result = await createProjectFromProposal(proposal, req.user?._id ?? null);
    if (!result.ok) {
      res.status(400).json({ success: false, message: result.error });
      return;
    }

    res.json({
      success: true,
      message: 'Project created successfully',
      projectId: result.projectId,
    });
  } catch (err: any) {
    console.error('createProjectFromProposalHandler error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Core: turn an accepted proposal into a Project ───────────────────────
async function createProjectFromProposal(
  proposal: any,
  actorId: mongoose.Types.ObjectId | null
): Promise<{ ok: boolean; projectId?: mongoose.Types.ObjectId; error?: string }> {
  try {
    if (proposal.projectId) {
      return { ok: false, error: 'Project already exists for this proposal' };
    }
    if (!proposal.clientId) {
      return { ok: false, error: 'Proposal has no linked client' };
    }
    if (!proposal.projectManagerId && !proposal.salespersonId) {
      return {
        ok: false,
        error: 'Proposal needs a projectManagerId or salespersonId to create a project',
      };
    }

    const pmId = proposal.projectManagerId ?? proposal.salespersonId;
    const snapshot = buildProjectTransferSnapshot(proposal, actorId);

    const projectMilestones = snapshot.milestones.map((m) => ({
      title: m.title,
      description: m.description,
      dueDate: m.dueDate,
      isCompleted: false,
    }));

    const now = new Date();
    const deadline = snapshot.technical.estimatedDurationDays
      ? new Date(now.getTime() + snapshot.technical.estimatedDurationDays * 86_400_000)
      : undefined;

    const project = new Project({
      name: proposal.title,
      description: proposal.subtitle,

      projectType: 'client',
      clientId: proposal.clientId,
      leadId: proposal.leadId ?? null,
      projectManager: pmId,

      budget: snapshot.budget ?? 0,
      currency: snapshot.currency || 'PKR',
      startDate: now,
      deadline,

      status: 'planning',
      priority: 'medium',
      progress: 0,
      progressMode: 'auto',

      milestones: projectMilestones,
      tags: proposal.tags ?? [],

      sourceProposalId: proposal._id,
      proposalSnapshot: {
        proposalId: proposal.proposalId,
        title: proposal.title,
        subtitle: proposal.subtitle,
        proposalType: proposal.proposalType,

        technical: snapshot.technical,
        sections: snapshot.sections,
        deliverables: snapshot.deliverables,
        assumptions: snapshot.assumptions,
        dependencies: snapshot.dependencies,
        outOfScope: snapshot.outOfScope,
        milestones: snapshot.milestones,

        budget: snapshot.budget,
        currency: snapshot.currency,

        clientSnapshot: proposal.clientSnapshot
          ? {
              name: proposal.clientSnapshot.name,
              displayName: proposal.clientSnapshot.displayName,
              email: proposal.clientSnapshot.email,
              phoneNo: proposal.clientSnapshot.phoneNo,
              address: proposal.clientSnapshot.address
                ? {
                    line1: proposal.clientSnapshot.address.line1,
                    line2: proposal.clientSnapshot.address.line2,
                    city: proposal.clientSnapshot.address.city,
                    state: proposal.clientSnapshot.address.state,
                    postalCode: proposal.clientSnapshot.address.postalCode,
                    country: proposal.clientSnapshot.address.country,
                  }
                : undefined,
              primaryContact: proposal.clientSnapshot.primaryContact
                ? {
                    name: proposal.clientSnapshot.primaryContact.name,
                    designation: proposal.clientSnapshot.primaryContact.designation,
                    email: proposal.clientSnapshot.primaryContact.email,
                    phoneNo: proposal.clientSnapshot.primaryContact.phoneNo,
                  }
                : undefined,
            }
          : null,
        salespersonSnapshot: proposal.salespersonSnapshot
          ? {
              name: proposal.salespersonSnapshot.name,
              designation: proposal.salespersonSnapshot.designation,
              email: proposal.salespersonSnapshot.email,
              phoneNo: proposal.salespersonSnapshot.phoneNo,
            }
          : null,

        transferredAt: new Date(),
        transferredBy: actorId,
        transferMode: proposal.projectCreationMode === 'auto' ? 'auto' : 'manual',
      },

      createdBy: actorId ?? proposal.createdBy ?? null,
    });

    await project.save();

    proposal.projectId = project._id;
    proposal.projectCreated = true;
    proposal.projectTransferSnapshot = snapshot;
    proposal.markModified('projectTransferSnapshot');
    await proposal.save();

    return { ok: true, projectId: project._id };
  } catch (err: any) {
    console.error('createProjectFromProposal error:', err);
    return { ok: false, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════
// DELETE (soft) / RESTORE
// ═════════════════════════════════════════════════════════════════════════
export async function deleteProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('proposals', 'delete'))) {
        res.status(403).json({ success: false, message: 'You cannot delete proposals' });
        return;
      }
    }

    proposal.isDeleted = true;
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({ success: true, message: 'Proposal deleted successfully' });
  } catch (err: any) {
    console.error('deleteProposal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

export async function restoreProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);

    const proposal = await Proposal.findOne({
      ...(mongoose.Types.ObjectId.isValid(proposalId)
        ? { _id: proposalId }
        : { proposalId }),
    });
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    if (!req.user!.isMainAdmin) {
      if (!(await req.user!.can('proposals', 'edit'))) {
        res.status(403).json({ success: false, message: 'You cannot restore proposals' });
        return;
      }
    }

    proposal.isDeleted = false;
    proposal.deletedAt = undefined;
    proposal.updatedBy = req.user?._id ?? null;
    await proposal.save();

    res.json({
      success: true,
      message: 'Proposal restored successfully',
      data: proposal,
    });
  } catch (err: any) {
    console.error('restoreProposal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// REVISIONS
// ═════════════════════════════════════════════════════════════════════════
export async function createProposalRevision(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);
    const parent = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!parent) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    const clone: any = parent.toObject({ virtuals: false });
    delete clone._id;
    delete clone.proposalId;
    delete clone.createdAt;
    delete clone.updatedAt;
    delete clone.sentAt;
    delete clone.viewedAt;
    delete clone.acceptedAt;
    delete clone.rejectedAt;
    delete clone.expiresAt;
    delete clone.validUntil;
    delete clone.shareToken;
    delete clone.shareTokenExpiresAt;
    delete clone.pdfUrl;
    delete clone.pdfGeneratedAt;
    delete clone.projectId;
    delete clone.projectCreated;
    delete clone.projectTransferSnapshot;
    delete clone.clientSignatureUrl;
    delete clone.clientSignedByName;
    delete clone.clientSignedByDesignation;
    delete clone.clientSignedAt;
    delete clone.__v;

    if (clone.technical?.pages?.length) {
      for (const page of clone.technical.pages) {
        page.key = genKey('page');
        if (page.blocks?.length) {
          for (const block of page.blocks) {
            block.key = genKey('blk');
          }
        }
      }
    }

    const draft = new Proposal({
      ...clone,
      parentProposalId: parent._id,
      revisionNo: (parent.revisionNo ?? 1) + 1,
      version: 1,
      status: 'draft',
      isLocked: false,
      viewCount: 0,
      createdBy: req.user?._id ?? null,
      updatedBy: req.user?._id ?? null,
    });

    await draft.save();

    res.status(201).json({
      success: true,
      message: `Revision ${draft.revisionNo} created`,
      data: draft,
    });
  } catch (err: any) {
    console.error('createProposalRevision error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// STATS
// ═════════════════════════════════════════════════════════════════════════
export async function getProposalStats(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const baseFilter = { isDeleted: false };

    const [
      total,
      draft,
      sent,
      viewed,
      accepted,
      rejected,
      expired,
      convertedToProject,
      autoMode,
      manualMode,
      byStatusRaw,
      byTypeRaw,
      bySalespersonRaw,
      totalsAgg,
      acceptedTotalsAgg,
      avgProposalValueAgg,
      conversionRateAgg,
    ] = await Promise.all([
      Proposal.countDocuments(baseFilter),
      Proposal.countDocuments({ ...baseFilter, status: 'draft' }),
      Proposal.countDocuments({ ...baseFilter, status: 'sent' }),
      Proposal.countDocuments({ ...baseFilter, status: 'viewed' }),
      Proposal.countDocuments({ ...baseFilter, status: 'accepted' }),
      Proposal.countDocuments({ ...baseFilter, status: 'rejected' }),
      Proposal.countDocuments({
        ...baseFilter,
        status: { $in: ['sent', 'viewed'] },
        expiresAt: { $lt: new Date() },
      }),
      Proposal.countDocuments({ ...baseFilter, projectCreated: true }),
      Proposal.countDocuments({ ...baseFilter, projectCreationMode: 'auto' }),
      Proposal.countDocuments({ ...baseFilter, projectCreationMode: 'manual' }),

      Proposal.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),

      Proposal.aggregate([
        { $match: baseFilter },
        { $group: { _id: '$proposalType', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),

      Proposal.aggregate([
        { $match: { ...baseFilter, salespersonId: { $ne: null } } },
        {
          $group: {
            _id: '$salespersonId',
            count: { $sum: 1 },
            won: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
            totalValue: { $sum: '$totals.total' },
          },
        },
        { $sort: { count: -1 } },
        { $limit: 10 },
      ]),

      Proposal.aggregate([
        {
          $match: {
            ...baseFilter,
            status: { $nin: ['rejected', 'expired', 'cancelled'] },
          },
        },
        {
          $group: {
            _id: null,
            pipelineValue: { $sum: '$totals.total' },
          },
        },
      ]),

      Proposal.aggregate([
        { $match: { ...baseFilter, status: 'accepted' } },
        {
          $group: {
            _id: null,
            acceptedValue: { $sum: '$totals.total' },
          },
        },
      ]),

      Proposal.aggregate([
        { $match: { ...baseFilter, 'totals.total': { $gt: 0 } } },
        {
          $group: {
            _id: null,
            avgValue: { $avg: '$totals.total' },
          },
        },
      ]),

      Proposal.aggregate([
        {
          $match: {
            ...baseFilter,
            status: { $in: ['accepted', 'rejected', 'expired'] },
          },
        },
        {
          $group: {
            _id: null,
            won: { $sum: { $cond: [{ $eq: ['$status', 'accepted'] }, 1, 0] } },
            closed: { $sum: 1 },
          },
        },
      ]),
    ]);

    const byStatus: Record<string, number> = {};
    for (const s of PROPOSAL_STATUSES) byStatus[s] = 0;
    for (const row of byStatusRaw) {
      const key = String(row._id ?? 'unknown');
      byStatus[key] = (byStatus[key] ?? 0) + row.count;
    }

    const pipelineValue = totalsAgg[0]?.pipelineValue ?? 0;
    const acceptedValue = acceptedTotalsAgg[0]?.acceptedValue ?? 0;
    const avgProposalValue = avgProposalValueAgg[0]?.avgValue ?? 0;
    const closedWon = conversionRateAgg[0]?.won ?? 0;
    const closedTotal = conversionRateAgg[0]?.closed ?? 0;
    const conversionRate =
      closedTotal > 0 ? +((closedWon / closedTotal) * 100).toFixed(2) : 0;

    const salesIds = bySalespersonRaw.map((r) => r._id);
    const employees = await Employee.find({
      _id: { $in: salesIds },
      isDeleted: false,
    }).select('name employeeId designation');
    const empMap = new Map(employees.map((e) => [String(e._id), e]));

    const bySalesperson = bySalespersonRaw.map((r) => {
      const emp = empMap.get(String(r._id));
      return {
        salespersonId: r._id,
        name: emp?.name ?? '(unknown)',
        employeeId: emp?.employeeId,
        designation: emp?.designation,
        proposalCount: r.count,
        wonCount: r.won,
        totalValue: +Number(r.totalValue || 0).toFixed(2),
      };
    });

    res.json({
      success: true,
      data: {
        total,
        draft,
        sent,
        viewed,
        accepted,
        rejected,
        expired,
        convertedToProject,
        autoMode,
        manualMode,
        breakdown: {
          byStatus,
          byType: byTypeRaw.map((d) => ({
            proposalType: d._id || 'project',
            count: d.count,
          })),
          bySalesperson,
        },
        financials: {
          pipelineValue: +Number(pipelineValue).toFixed(2),
          acceptedValue: +Number(acceptedValue).toFixed(2),
          avgProposalValue: +Number(avgProposalValue).toFixed(2),
          conversionRate,
        },
      },
    });
  } catch (err: any) {
    console.error('getProposalStats error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// PROPOSALS FOR A SPECIFIC CLIENT
// ═════════════════════════════════════════════════════════════════════════
export async function listProposalsByClient(req: AuthRequest, res: Response): Promise<void> {
  try {
    const clientId = asString(req.params.clientId);

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      res.status(400).json({ success: false, message: 'Invalid clientId' });
      return;
    }

    const client = await Client.findOne({ _id: clientId, isDeleted: false }).select('_id');
    if (!client) {
      res.status(404).json({ success: false, message: 'Client not found' });
      return;
    }

    const proposals = await Proposal.find({
      clientId: client._id,
      isDeleted: false,
    })
      .populate('salespersonId', 'name employeeId designation department')
      .populate('projectId', 'projectId name status')
      .sort('-proposalDate');

    res.json({ success: true, data: proposals });
  } catch (err: any) {
    console.error('listProposalsByClient error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// HARD DELETE
// ═════════════════════════════════════════════════════════════════════════
export async function hardDeleteProposal(req: AuthRequest, res: Response): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);

    if (!req.user!.isMainAdmin) {
      res.status(403).json({
        success: false,
        message: 'Only the main admin can permanently delete proposals',
      });
      return;
    }

    const proposal = await Proposal.findOne(
      mongoose.Types.ObjectId.isValid(proposalId)
        ? { _id: proposalId }
        : { proposalId }
    );

    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    if (!proposal.isDeleted) {
      res.status(400).json({
        success: false,
        message:
          'Proposal must be soft-deleted first. Call DELETE /proposals/:id before permanent delete.',
      });
      return;
    }

    if (proposal.projectId) {
      res.status(400).json({
        success: false,
        message: 'Cannot permanently delete — a project is linked to this proposal',
        projectId: proposal.projectId,
      });
      return;
    }

    await Proposal.deleteOne({ _id: proposal._id });

    res.json({
      success: true,
      message: `Proposal ${proposal.proposalId} permanently deleted`,
      data: { proposalId: proposal.proposalId, _id: proposal._id },
    });
  } catch (err: any) {
    console.error('hardDeleteProposal error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ═════════════════════════════════════════════════════════════════════════
// DOWNLOAD PROPOSAL AS .DOCX
//   GET /api/proposals/:proposalId/download-docx
// ═════════════════════════════════════════════════════════════════════════
export async function downloadProposalDocx(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const proposalId = asString(req.params.proposalId);

    const proposal = await Proposal.findOne(buildLookupQuery(proposalId));
    if (!proposal) {
      res.status(404).json({ success: false, message: 'Proposal not found' });
      return;
    }

    const buffer = generateProposalDocx(proposal);

    const safeTitle = (proposal.title || 'Proposal')
      .replace(/[^a-z0-9]/gi, '_')
      .slice(0, 60);
    const filename = `${proposal.proposalNumber ?? proposal.proposalId}_${safeTitle}.docx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"`
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  } catch (err: any) {
    console.error('downloadProposalDocx error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to generate document',
      error: err?.message ?? String(err),
    });
  }
}