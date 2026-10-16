// model/proposal.ts
import mongoose, { Document, Schema, Types, Model } from 'mongoose';
import Counter from './counter';

// ─── Enums & Types ────────────────────────────────────────────────────────

export type ProposalStatus =
  | 'draft'
  | 'internal_review'
  | 'sent'
  | 'viewed'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export type ProposalCurrency = string;

export type ProposalType =
  | 'project'
  | 'service'
  | 'retainer'
  | 'maintenance'
  | 'custom';

export type PricingMode = 'fixed' | 'hourly' | 'milestone' | 'retainer';

export type LineItemCategory =
  | 'service'
  | 'product'
  | 'license'
  | 'support'
  | 'training'
  | 'travel'
  | 'misc';

export type DiscountType = 'flat' | 'percent';
export type TaxType = 'percent' | 'flat';

/** 'auto' → system creates project on acceptance.
 *  'manual' → user must create the project themselves. */
export type ProjectCreationMode = 'auto' | 'manual';

// ── NEW: Page / Block types ───────────────────────────────────────────────

export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A3' | 'Custom';
export type PageOrientation = 'portrait' | 'landscape';

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'bullets'
  | 'numbered'
  | 'table'
  | 'image'
  | 'code'
  | 'callout'
  | 'divider'
  | 'spacer'
  | 'signature'
  | 'custom';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type ColumnAlign = 'left' | 'center' | 'right';
export type ColumnWidthUnit = 'px' | '%' | 'fr';

// ─── Sub-document Interfaces ──────────────────────────────────────────────

export interface IProposalPaymentMilestone {
  _id?: Types.ObjectId;
  label: string;
  description?: string;
  percentage?: number;
  amount: number;
  dueDate?: Date;
  dueAfterDays?: number;
  isPaid: boolean;
  paidAt?: Date;
  notes?: string;
}

export interface IProposalSection {
  _id?: Types.ObjectId;
  key: string;
  title: string;
  content: any;              // TipTap JSON
  plainText?: string;
  order: number;
  visible: boolean;
  locked?: boolean;
}

export interface IProposalLineItem {
  _id?: Types.ObjectId;
  category: LineItemCategory;
  name: string;
  description?: string;
  serviceId?: Types.ObjectId | null;

  quantity: number;
  unit?: string;
  unitPrice: number;
  currency: ProposalCurrency;
  billingType?: string;

  discountType?: DiscountType;
  discountValue?: number;

  taxType?: TaxType;
  taxRate?: number;
  taxAmount?: number;

  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  taxAmountComputed: number;
  total: number;

  order: number;
  notes?: string;
}

export interface IProposalTotals {
  subtotal: number;
  totalDiscount: number;
  totalTax: number;
  total: number;
  advanceRequired: number;
  balanceDue: number;
  currency: ProposalCurrency;
}

export interface IClientSnapshot {
  clientId?: Types.ObjectId | null;
  name: string;
  displayName?: string;
  clientType?: string;
  email?: string;
  phoneNo?: string;
  website?: string;
  ntn?: string;
  strn?: string;
  cnic?: string;
  address?: {
    label: string;
    line1: string;
    line2?: string;
    city: string;
    state?: string;
    postalCode?: string;
    country: string;
  };
  primaryContact?: {
    name: string;
    designation?: string;
    email?: string;
    phoneNo?: string;
  };
  paymentTerms?: string;
  currency?: string;
  taxExempt?: boolean;
}

export interface ISalespersonSnapshot {
  employeeId?: Types.ObjectId | null;
  name: string;
  designation: string;
  department?: string;
  email?: string;
  phoneNo?: string;
  whatsapp?: string;
  extension?: string;
  linkedin?: string;
  profileImageUrl?: string;
  signatureUrl?: string;
}

export interface ICompanySnapshot {
  name: string;
  tagline?: string;
  logoUrl?: string;
  address?: string;
  email?: string;
  phoneNo?: string;
  website?: string;
  ntn?: string;
  strn?: string;
  registrationNo?: string;
  bankDetails?: {
    bankName: string;
    accountTitle: string;
    accountNumber: string;
    iban?: string;
    branch?: string;
  };
}

// ─── NEW: Table / Block / Page interfaces ─────────────────────────────────

export interface ITableColumn {
  _id?: Types.ObjectId;
  key: string;
  label: string;
  align?: ColumnAlign;
  width?: number;
  widthUnit?: ColumnWidthUnit;
  type?: 'text' | 'number' | 'currency' | 'date' | 'boolean' | 'link';
  hidden?: boolean;
}

export interface ITableRow {
  _id?: Types.ObjectId;
  /** Keyed by column.key — allows column reorder/rename without losing data */
  cells: Record<string, string | number | boolean | null>;
  isHeader?: boolean;
  isSubtotal?: boolean;
  notes?: string;
}

export interface ITableBlockData {
  columns: ITableColumn[];
  rows: ITableRow[];
  caption?: string;
  striped?: boolean;
  bordered?: boolean;
  compact?: boolean;
  showTotals?: boolean;
  totalColumnKeys?: string[];
}

export interface IProposalBlock {
  _id?: Types.ObjectId;
  key: string;
  type: BlockType;
  order: number;
  visible: boolean;
  locked?: boolean;

  heading?: {
    text: string;
    level: HeadingLevel;
    anchor?: string;
    align?: ColumnAlign;
    color?: string;
    icon?: string;
  };

  text?: {
    format: 'plain' | 'html' | 'tiptap';
    content: any;
    plainText?: string;
  };

  list?: {
    items: string[];
    ordered?: boolean;
    startAt?: number;
  };

  table?: ITableBlockData;

  image?: {
    url: string;
    alt?: string;
    caption?: string;
    width?: number;
    widthUnit?: ColumnWidthUnit;
    align?: ColumnAlign;
  };

  code?: {
    language?: string;
    code: string;
    showLineNumbers?: boolean;
  };

  callout?: {
    variant: 'info' | 'warning' | 'success' | 'danger' | 'note';
    title?: string;
    text: string;
  };

  spacer?: {
    height: number;
  };

  signature?: {
    label?: string;
    name?: string;
    designation?: string;
    imageUrl?: string;
    date?: Date;
  };

  custom?: Record<string, any>;
  style?: Record<string, any>;
}

export interface IProposalPage {
  _id?: Types.ObjectId;
  key: string;
  title?: string;
  order: number;

  size: PageSize;
  orientation: PageOrientation;
  customSize?: {
    width: number;
    height: number;
  };

  showHeader?: boolean;
  showFooter?: boolean;
  headerText?: string;
  footerText?: string;
  showPageNumber?: boolean;
  pageNumberFormat?: string;

  margins?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  background?: {
    color?: string;
    imageUrl?: string;
  };

  blocks: IProposalBlock[];

  visible: boolean;
  locked?: boolean;
  notes?: string;
}

export interface ITechnicalDetails {
  // ── LEGACY (kept for backward compat, all optional) ────────────
  approach?: string;
  techStack?: string[];
  architectureSummary?: string;
  modules?: { name: string; description?: string }[];
  deliverables?: string[];
  assumptions?: string[];
  dependencies?: string[];
  outOfScope?: string[];
  testingStrategy?: string;
  supportPlan?: string;
  phases?: { phase: string; duration?: string; deliverable?: string }[];
  estimatedDurationDays?: number;
  proposedMilestones?: {
    title: string;
    description?: string;
    dueDate?: Date;
  }[];

  // ── NEW: paginated, block-based content ────────────────────────
  pages: IProposalPage[];
  toc?: {
    enabled: boolean;
    title?: string;
    maxDepth?: HeadingLevel;
    showPageNumbers?: boolean;
  };
  defaults?: {
    size?: PageSize;
    orientation?: PageOrientation;
    margins?: { top: number; right: number; bottom: number; left: number };
  };
}

export interface IFinancialDetails {
  pricingMode: PricingMode;
  currency: ProposalCurrency;
  globalDiscountType?: DiscountType;
  globalDiscountValue?: number;
  globalDiscountAmount?: number;
  taxType?: TaxType;
  taxRate?: number;
  taxAmount?: number;
  taxLabel?: string;

  paymentTerms?: string;
  paymentMilestones: IProposalPaymentMilestone[];
  bankDetails?: {
    bankName: string;
    accountTitle: string;
    accountNumber: string;
    iban?: string;
    branch?: string;
  };
  validityDays?: number;
  validityDate?: Date;
  notes?: string;
}

// ─── Project transfer (technical-only) ────────────────────────────────────

export interface IProjectTransferSection {
  key: string;
  title: string;
  content: any;
  plainText?: string;
  order: number;
}

export interface IProjectTransferMilestone {
  title: string;
  description?: string;
  dueDate?: Date;
}

export interface IProjectTransferSnapshot {
  technical: ITechnicalDetails;
  sections: IProjectTransferSection[];
  deliverables?: string[];
  assumptions?: string[];
  dependencies?: string[];
  outOfScope?: string[];
  milestones: IProjectTransferMilestone[];
  budget?: number;
  currency: ProposalCurrency;
  transferredAt: Date;
  transferredBy?: Types.ObjectId | null;
}

// ─── Main Interface ───────────────────────────────────────────────────────

export interface IProposal extends Document {
  _id: Types.ObjectId;
  proposalId: string;

  // ── Identity ────────────────────────────────────────────────────
  title: string;
  subtitle?: string;
  proposalNumber?: string;
  revisionNo: number;
  version: number;
  parentProposalId?: Types.ObjectId | null;
  proposalType: ProposalType;

  // ── Relationships ───────────────────────────────────────────────
  clientId: Types.ObjectId | null;
  leadId: Types.ObjectId | null;
  salespersonId: Types.ObjectId | null;
  technicalLeadId?: Types.ObjectId | null;
  projectManagerId?: Types.ObjectId | null;
  projectId?: Types.ObjectId | null;

  // ── Snapshots ───────────────────────────────────────────────────
  clientSnapshot?: IClientSnapshot | null;
  salespersonSnapshot?: ISalespersonSnapshot | null;
  companySnapshot?: ICompanySnapshot | null;

  // ── Content ─────────────────────────────────────────────────────
  sections: IProposalSection[];
  technical: ITechnicalDetails;
  financial: IFinancialDetails;
  lineItems: IProposalLineItem[];
  totals: IProposalTotals;

  // ── Dates ───────────────────────────────────────────────────────
  proposalDate: Date;
  validUntil?: Date;
  sentAt?: Date;
  viewedAt?: Date;
  acceptedAt?: Date;
  rejectedAt?: Date;
  expiresAt?: Date;

  // ── Status ──────────────────────────────────────────────────────
  status: ProposalStatus;
  statusReason?: string;
  isLocked: boolean;

  // ── Acceptance / Project linkage ────────────────────────────────
  clientSignatureUrl?: string;
  clientSignedByName?: string;
  clientSignedByDesignation?: string;
  clientSignedAt?: Date;

  projectCreationMode: ProjectCreationMode;
  projectCreated: boolean;
  projectTransferSnapshot?: IProjectTransferSnapshot | null;

  // ── Sharing / Tracking ──────────────────────────────────────────
  shareToken?: string;
  shareTokenExpiresAt?: Date;
  viewCount: number;

  pdfUrl?: string;
  pdfGeneratedAt?: Date;

  // ── Notes / Tags ────────────────────────────────────────────────
  tags: string[];
  internalNotes?: string;

  // ── Audit ───────────────────────────────────────────────────────
  createdBy?: Types.ObjectId | null;
  updatedBy?: Types.ObjectId | null;
  isDeleted: boolean;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;

  // ── Virtuals ────────────────────────────────────────────────────
  isDraft: boolean;
  isSent: boolean;
  isAccepted: boolean;
  isRejected: boolean;
  isExpired: boolean;
  isEditable: boolean;
  isClientProposal: boolean;
  daysUntilExpiry: number | null;
  lineItemCount: number;
  sectionCount: number;
  pageCount: number;
  blockCount: number;
  primaryMilestone: IProposalPaymentMilestone | null;
  hasLinkedProject: boolean;
  hasLinkedLead: boolean;
}

// ─── Model statics ────────────────────────────────────────────────────────
export interface IProposalModel extends Model<IProposal> {
  findActive(filter?: Record<string, any>): Promise<IProposal[]>;
  findByClient(clientId: Types.ObjectId | string): Promise<IProposal[]>;
  findBySalesperson(employeeId: Types.ObjectId | string): Promise<IProposal[]>;
  findByLead(leadId: Types.ObjectId | string): Promise<IProposal[]>;
  findExpired(): Promise<IProposal[]>;
}

// ─── Constants ────────────────────────────────────────────────────────────

export const PROPOSAL_STATUSES: ProposalStatus[] = [
  'draft', 'internal_review', 'sent', 'viewed',
  'accepted', 'rejected', 'expired', 'cancelled',
];

export const PROPOSAL_TYPES: ProposalType[] = [
  'project', 'service', 'retainer', 'maintenance', 'custom',
];

export const PRICING_MODES: PricingMode[] = [
  'fixed', 'hourly', 'milestone', 'retainer',
];

export const LINE_ITEM_CATEGORIES: LineItemCategory[] = [
  'service', 'product', 'license', 'support', 'training', 'travel', 'misc',
];

export const DISCOUNT_TYPES: DiscountType[] = ['flat', 'percent'];
export const TAX_TYPES: TaxType[] = ['percent', 'flat'];
export const PROJECT_CREATION_MODES: ProjectCreationMode[] = ['auto', 'manual'];

export const PAGE_SIZES: PageSize[] = ['A4', 'Letter', 'Legal', 'A3', 'Custom'];
export const PAGE_ORIENTATIONS: PageOrientation[] = ['portrait', 'landscape'];
export const BLOCK_TYPES: BlockType[] = [
  'heading', 'paragraph', 'bullets', 'numbered', 'table',
  'image', 'code', 'callout', 'divider', 'spacer', 'signature', 'custom',
];

export const EDITABLE_PROPOSAL_STATUSES: ProposalStatus[] = [
  'draft', 'internal_review',
];

export const CLOSED_PROPOSAL_STATUSES: ProposalStatus[] = [
  'accepted', 'rejected', 'expired', 'cancelled',
];

export const DEFAULT_VALIDITY_DAYS = 30;

export const PROPOSAL_NAME_MAX = 200;
export const PROPOSAL_SUBTITLE_MAX = 300;
export const PROPOSAL_NOTES_MAX = 5000;
export const PROPOSAL_TAGS_MAX = 20;
export const PROPOSAL_SECTIONS_MAX = 100;
export const PROPOSAL_LINE_ITEMS_MAX = 500;
export const PROPOSAL_MILESTONES_MAX = 20;

// NEW limits
export const PROPOSAL_PAGES_MAX = 200;
export const PROPOSAL_BLOCKS_PER_PAGE_MAX = 100;
export const PROPOSAL_TABLE_COLUMNS_MAX = 30;
export const PROPOSAL_TABLE_ROWS_MAX = 500;
export const PROPOSAL_TOC_MAX_DEPTH = 6;

/** Section keys that should NOT be transferred to a project. */
export const PROPOSAL_FINANCIAL_SECTION_KEYS = [
  'financial_summary',
  'payment_terms',
  'terms_conditions',
] as const;

/** Block types that should NOT be transferred to a project. */
export const PROPOSAL_FINANCIAL_BLOCK_TYPES: BlockType[] = [
  // reserved for future 'pricing_table' etc.
];

export const DEFAULT_PROPOSAL_SECTIONS: { key: string; title: string }[] = [
  { key: 'executive_summary',  title: 'Executive Summary' },
  { key: 'problem_statement',  title: 'Problem Statement & Objectives' },
  { key: 'scope_of_work',      title: 'Scope of Work' },
  { key: 'technical_approach', title: 'Technical Approach' },
  { key: 'tech_stack',         title: 'Technology Stack' },
  { key: 'timeline',           title: 'Timeline & Milestones' },
  { key: 'financial_summary',  title: 'Financial Summary' },
  { key: 'payment_terms',      title: 'Payment Terms' },
  { key: 'terms_conditions',   title: 'Terms & Conditions' },
  { key: 'conclusion',         title: 'Conclusion' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function computeLineItemTotals(item: IProposalLineItem) {
  const subtotal = round2((item.quantity || 0) * (item.unitPrice || 0));

  let discountAmount = 0;
  if (item.discountType === 'percent') {
    discountAmount = round2(subtotal * ((item.discountValue || 0) / 100));
  } else if (item.discountType === 'flat') {
    discountAmount = round2(item.discountValue || 0);
  }
  if (discountAmount > subtotal) discountAmount = subtotal;

  const taxableAmount = round2(subtotal - discountAmount);

  let taxAmountComputed = 0;
  if (item.taxType === 'percent') {
    taxAmountComputed = round2(taxableAmount * ((item.taxRate || 0) / 100));
  } else if (item.taxType === 'flat') {
    taxAmountComputed = round2(item.taxAmount || 0);
  }

  const total = round2(taxableAmount + taxAmountComputed);

  return { subtotal, discountAmount, taxableAmount, taxAmountComputed, total };
}

export function computeProposalTotals(
  lineItems: IProposalLineItem[],
  financial: Pick<
    IFinancialDetails,
    'globalDiscountType' | 'globalDiscountValue' | 'taxType' | 'taxRate' | 'taxAmount'
  >,
  paymentMilestones: IProposalPaymentMilestone[],
  currency: ProposalCurrency,
): IProposalTotals {
  let subtotal = 0;
  let lineDiscount = 0;
  let lineTax = 0;

  for (const item of lineItems) {
    const t = computeLineItemTotals(item);
    subtotal += t.subtotal;
    lineDiscount += t.discountAmount;
    lineTax += t.taxAmountComputed;
  }

  subtotal = round2(subtotal);
  lineDiscount = round2(lineDiscount);
  lineTax = round2(lineTax);

  const afterLineDiscounts = round2(subtotal - lineDiscount);

  let globalDiscountAmount = 0;
  if (financial.globalDiscountType === 'percent') {
    globalDiscountAmount = round2(
      afterLineDiscounts * ((financial.globalDiscountValue || 0) / 100)
    );
  } else if (financial.globalDiscountType === 'flat') {
    globalDiscountAmount = round2(financial.globalDiscountValue || 0);
  }
  if (globalDiscountAmount > afterLineDiscounts) {
    globalDiscountAmount = afterLineDiscounts;
  }

  const taxableBase = round2(afterLineDiscounts - globalDiscountAmount);

  let globalTaxAmount = 0;
  if (financial.taxType === 'percent') {
    globalTaxAmount = round2(taxableBase * ((financial.taxRate || 0) / 100));
  } else if (financial.taxType === 'flat') {
    globalTaxAmount = round2(financial.taxAmount || 0);
  }

  const totalDiscount = round2(lineDiscount + globalDiscountAmount);
  const totalTax = round2(lineTax + globalTaxAmount);
  const total = round2(taxableBase + lineTax + globalTaxAmount);

  const advanceRequired = round2(
    paymentMilestones
      .filter((m) => m.percentage !== undefined && (m.dueAfterDays ?? 0) === 0)
      .reduce((s, m) => s + (m.amount || 0), 0)
  );

  return {
    subtotal,
    totalDiscount,
    totalTax,
    total,
    advanceRequired,
    balanceDue: round2(total - advanceRequired),
    currency,
  };
}

// ── NEW: Table / Page / Block helpers ─────────────────────────────────────

export function createTableColumn(partial: Partial<ITableColumn> = {}): ITableColumn {
  return {
    key: partial.key ?? `col_${Math.random().toString(36).slice(2, 9)}`,
    label: partial.label ?? 'Column',
    align: partial.align ?? 'left',
    width: partial.width ?? 1,
    widthUnit: partial.widthUnit ?? 'fr',
    type: partial.type ?? 'text',
    hidden: partial.hidden ?? false,
    ...partial,
  };
}

export function createTableRow(
  columns: ITableColumn[],
  values: Record<string, any> = {}
): ITableRow {
  const cells: Record<string, any> = {};
  for (const col of columns) cells[col.key] = values[col.key] ?? null;
  return { cells };
}

export function addTableColumn(table: ITableBlockData, column?: Partial<ITableColumn>) {
  const col = createTableColumn(column);
  table.columns.push(col);
  for (const row of table.rows) {
    if (row.cells[col.key] === undefined) row.cells[col.key] = null;
  }
  return col;
}

export function removeTableColumn(table: ITableBlockData, columnKey: string) {
  table.columns = table.columns.filter((c) => c.key !== columnKey);
  for (const row of table.rows) delete row.cells[columnKey];
}

export function addTableRow(table: ITableBlockData, values: Record<string, any> = {}) {
  const row = createTableRow(table.columns, values);
  table.rows.push(row);
  return row;
}

export function createPage(partial: Partial<IProposalPage> = {}): IProposalPage {
  return {
    key: partial.key ?? `page_${Math.random().toString(36).slice(2, 9)}`,
    title: partial.title ?? '',
    order: partial.order ?? 0,
    size: partial.size ?? 'A4',
    orientation: partial.orientation ?? 'portrait',
    showHeader: partial.showHeader ?? false,
    showFooter: partial.showFooter ?? true,
    showPageNumber: partial.showPageNumber ?? true,
    pageNumberFormat: partial.pageNumberFormat ?? 'Page {n} of {total}',
    margins: partial.margins ?? { top: 48, right: 48, bottom: 48, left: 48 },
    padding: partial.padding ?? { top: 0, right: 0, bottom: 0, left: 0 },
    blocks: partial.blocks ?? [],
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    ...partial,
  };
}

export function createBlock(partial: Partial<IProposalBlock> = {}): IProposalBlock {
  return {
    key: partial.key ?? `blk_${Math.random().toString(36).slice(2, 9)}`,
    type: partial.type ?? 'paragraph',
    order: partial.order ?? 0,
    visible: partial.visible ?? true,
    locked: partial.locked ?? false,
    ...partial,
  };
}

export function reorderPages(technical: ITechnicalDetails) {
  technical.pages
    .sort((a, b) => a.order - b.order)
    .forEach((p, i) => { p.order = i; });
}

export function reorderBlocks(page: IProposalPage) {
  page.blocks
    .sort((a, b) => a.order - b.order)
    .forEach((b, i) => { b.order = i; });
}

export interface ITocEntry {
  level: HeadingLevel;
  text: string;
  anchor?: string;
  pageKey: string;
  pageIndex: number;
  pageTitle?: string;
}

export function buildTableOfContents(
  technical: ITechnicalDetails,
  maxDepth: HeadingLevel = 3
): ITocEntry[] {
  const entries: ITocEntry[] = [];
  technical.pages
    .filter((p) => p.visible)
    .sort((a, b) => a.order - b.order)
    .forEach((page, pageIndex) => {
      page.blocks
        .filter((b) => b.visible && b.type === 'heading' && b.heading)
        .sort((a, b) => a.order - b.order)
        .forEach((block) => {
          const h = block.heading!;
          if (h.level > maxDepth) return;
          entries.push({
            level: h.level,
            text: h.text,
            anchor: h.anchor,
            pageKey: page.key,
            pageIndex,
            pageTitle: page.title,
          });
        });
    });
  return entries;
}

// ─── Sub-schemas ──────────────────────────────────────────────────────────

const paymentMilestoneSchema = new Schema<IProposalPaymentMilestone>(
  {
    label:        { type: String, required: true, trim: true, maxlength: 120 },
    description:  { type: String, trim: true, maxlength: 500 },
    percentage:   { type: Number, min: 0, max: 100 },
    amount:       { type: Number, default: 0, min: 0 },
    dueDate:      { type: Date },
    dueAfterDays: { type: Number, min: 0 },
    isPaid:       { type: Boolean, default: false },
    paidAt:       { type: Date },
    notes:        { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

const sectionSchema = new Schema<IProposalSection>(
  {
    key:       { type: String, required: true, trim: true, maxlength: 60 },
    title:     { type: String, required: true, trim: true, maxlength: 200 },
    content:   { type: Schema.Types.Mixed, default: {} },
    plainText: { type: String, trim: true, maxlength: 20000 },
    order:     { type: Number, default: 0 },
    visible:   { type: Boolean, default: true },
    locked:    { type: Boolean, default: false },
  },
  { _id: true }
);

const lineItemSchema = new Schema<IProposalLineItem>(
  {
    category:    { type: String, enum: LINE_ITEM_CATEGORIES, default: 'service', required: true },
    name:        { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    serviceId:   { type: Schema.Types.ObjectId, ref: 'Service', default: null },

    quantity:  { type: Number, required: true, min: 0, default: 1 },
    unit:      { type: String, trim: true, maxlength: 20 },
    unitPrice: { type: Number, required: true, min: 0, default: 0 },
    currency:  { type: String, default: 'PKR', trim: true, uppercase: true, maxlength: 3 },
    billingType: { type: String, trim: true, maxlength: 40 },

    discountType:  { type: String, enum: DISCOUNT_TYPES, default: undefined },
    discountValue: { type: Number, min: 0, default: 0 },

    taxType:   { type: String, enum: TAX_TYPES, default: undefined },
    taxRate:   { type: Number, min: 0, max: 100, default: 0 },
    taxAmount: { type: Number, min: 0, default: 0 },

    subtotal:          { type: Number, default: 0, min: 0 },
    discountAmount:    { type: Number, default: 0, min: 0 },
    taxableAmount:     { type: Number, default: 0, min: 0 },
    taxAmountComputed: { type: Number, default: 0, min: 0 },
    total:             { type: Number, default: 0, min: 0 },

    order: { type: Number, default: 0 },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

const totalsSchema = new Schema<IProposalTotals>(
  {
    subtotal:        { type: Number, default: 0, min: 0 },
    totalDiscount:   { type: Number, default: 0, min: 0 },
    totalTax:        { type: Number, default: 0, min: 0 },
    total:           { type: Number, default: 0, min: 0 },
    advanceRequired: { type: Number, default: 0, min: 0 },
    balanceDue:      { type: Number, default: 0, min: 0 },
    currency:        { type: String, default: 'PKR', trim: true, uppercase: true, maxlength: 3 },
  },
  { _id: false }
);

const clientSnapshotSchema = new Schema<IClientSnapshot>(
  {
    clientId:    { type: Schema.Types.ObjectId, ref: 'Client', default: null },
    name:        { type: String, required: true, trim: true, maxlength: 200 },
    displayName: { type: String, trim: true, maxlength: 120 },
    clientType:  { type: String, trim: true, maxlength: 40 },
    email:       { type: String, trim: true, lowercase: true },
    phoneNo:     { type: String, trim: true, maxlength: 30 },
    website:     { type: String, trim: true, maxlength: 200 },
    ntn:         { type: String, trim: true, maxlength: 20 },
    strn:        { type: String, trim: true, maxlength: 20 },
    cnic:        { type: String, trim: true, maxlength: 20 },
    address: {
      label:      { type: String, trim: true, maxlength: 40 },
      line1:      { type: String, trim: true, maxlength: 200 },
      line2:      { type: String, trim: true, maxlength: 200 },
      city:       { type: String, trim: true, maxlength: 100 },
      state:      { type: String, trim: true, maxlength: 100 },
      postalCode: { type: String, trim: true, maxlength: 20 },
      country:    { type: String, trim: true, maxlength: 100 },
    },
    primaryContact: {
      name:        { type: String, trim: true, maxlength: 120 },
      designation: { type: String, trim: true, maxlength: 120 },
      email:       { type: String, trim: true, lowercase: true },
      phoneNo:     { type: String, trim: true, maxlength: 30 },
    },
    paymentTerms: { type: String, trim: true, maxlength: 40 },
    currency:     { type: String, trim: true, uppercase: true, maxlength: 3 },
    taxExempt:    { type: Boolean, default: false },
  },
  { _id: false }
);

const salespersonSnapshotSchema = new Schema<ISalespersonSnapshot>(
  {
    employeeId:      { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    name:            { type: String, required: true, trim: true, maxlength: 120 },
    designation:     { type: String, required: true, trim: true, maxlength: 120 },
    department:      { type: String, trim: true, maxlength: 120 },
    email:           { type: String, trim: true, lowercase: true },
    phoneNo:         { type: String, trim: true, maxlength: 30 },
    whatsapp:        { type: String, trim: true, maxlength: 30 },
    extension:       { type: String, trim: true, maxlength: 10 },
    linkedin:        { type: String, trim: true, maxlength: 200 },
    profileImageUrl: { type: String, trim: true, maxlength: 500 },
    signatureUrl:    { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const companySnapshotSchema = new Schema<ICompanySnapshot>(
  {
    name:           { type: String, required: true, trim: true, maxlength: 200 },
    tagline:        { type: String, trim: true, maxlength: 300 },
    logoUrl:        { type: String, trim: true, maxlength: 500 },
    address:        { type: String, trim: true, maxlength: 500 },
    email:          { type: String, trim: true, lowercase: true },
    phoneNo:        { type: String, trim: true, maxlength: 30 },
    website:        { type: String, trim: true, maxlength: 200 },
    ntn:            { type: String, trim: true, maxlength: 20 },
    strn:           { type: String, trim: true, maxlength: 20 },
    registrationNo: { type: String, trim: true, maxlength: 50 },
    bankDetails: {
      bankName:      { type: String, trim: true, maxlength: 120 },
      accountTitle:  { type: String, trim: true, maxlength: 120 },
      accountNumber: { type: String, trim: true, maxlength: 50 },
      iban:          { type: String, trim: true, uppercase: true, maxlength: 34 },
      branch:        { type: String, trim: true, maxlength: 120 },
    },
  },
  { _id: false }
);

// ─── Project transfer sub-schemas ─────────────────────────────────────────

const transferredSectionSchema = new Schema<IProjectTransferSection>(
  {
    key:       { type: String, required: true, trim: true, maxlength: 60 },
    title:     { type: String, required: true, trim: true, maxlength: 200 },
    content:   { type: Schema.Types.Mixed, default: {} },
    plainText: { type: String, trim: true, maxlength: 20000 },
    order:     { type: Number, default: 0 },
  },
  { _id: false }
);

const transferredMilestoneSchema = new Schema<IProjectTransferMilestone>(
  {
    title:       { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    dueDate:     { type: Date },
  },
  { _id: false }
);

// ─── NEW: Table / Block / Page sub-schemas ────────────────────────────────

const tableColumnSchema = new Schema<ITableColumn>(
  {
    key:       { type: String, required: true, trim: true, maxlength: 60 },
    label:     { type: String, required: true, trim: true, maxlength: 200 },
    align:     { type: String, enum: ['left', 'center', 'right'], default: 'left' },
    width:     { type: Number, min: 0 },
    widthUnit: { type: String, enum: ['px', '%', 'fr'], default: 'fr' },
    type:      { type: String, enum: ['text', 'number', 'currency', 'date', 'boolean', 'link'], default: 'text' },
    hidden:    { type: Boolean, default: false },
  },
  { _id: true }
);

const tableRowSchema = new Schema<ITableRow>(
  {
    cells:      { type: Schema.Types.Mixed, default: {} },
    isHeader:   { type: Boolean, default: false },
    isSubtotal: { type: Boolean, default: false },
    notes:      { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

const tableBlockSchema = new Schema<ITableBlockData>(
  {
    columns: {
      type: [tableColumnSchema],
      default: [],
      validate: {
        validator: (arr: ITableColumn[]) => arr.length <= PROPOSAL_TABLE_COLUMNS_MAX,
        message: `At most ${PROPOSAL_TABLE_COLUMNS_MAX} columns allowed`,
      },
    },
    rows: {
      type: [tableRowSchema],
      default: [],
      validate: {
        validator: (arr: ITableRow[]) => arr.length <= PROPOSAL_TABLE_ROWS_MAX,
        message: `At most ${PROPOSAL_TABLE_ROWS_MAX} rows allowed`,
      },
    },
    caption:         { type: String, trim: true, maxlength: 300 },
    striped:         { type: Boolean, default: true },
    bordered:        { type: Boolean, default: true },
    compact:         { type: Boolean, default: false },
    showTotals:      { type: Boolean, default: false },
    totalColumnKeys: { type: [String], default: [] },
  },
  { _id: false }
);

const blockSchema = new Schema<IProposalBlock>(
  {
    key:     { type: String, required: true, trim: true, maxlength: 80 },
    type:    { type: String, enum: BLOCK_TYPES, required: true },
    order:   { type: Number, default: 0 },
    visible: { type: Boolean, default: true },
    locked:  { type: Boolean, default: false },

    heading: {
      text:   { type: String, trim: true, maxlength: 500 },
      level:  { type: Number, min: 1, max: 6, default: 2 },
      anchor: { type: String, trim: true, maxlength: 120 },
      align:  { type: String, enum: ['left', 'center', 'right'], default: 'left' },
      color:  { type: String, trim: true, maxlength: 30 },
      icon:   { type: String, trim: true, maxlength: 100 },
    },

    text: {
      format:    { type: String, enum: ['plain', 'html', 'tiptap'], default: 'tiptap' },
      content:   { type: Schema.Types.Mixed, default: {} },
      plainText: { type: String, trim: true, maxlength: 50000 },
    },

    list: {
      items:   { type: [String], default: [] },
      ordered: { type: Boolean, default: false },
      startAt: { type: Number, min: 1 },
    },

    table: { type: tableBlockSchema, default: undefined },

    image: {
      url:       { type: String, trim: true, maxlength: 1000 },
      alt:       { type: String, trim: true, maxlength: 300 },
      caption:   { type: String, trim: true, maxlength: 300 },
      width:     { type: Number, min: 0 },
      widthUnit: { type: String, enum: ['px', '%', 'fr'], default: 'px' },
      align:     { type: String, enum: ['left', 'center', 'right'], default: 'center' },
    },

    code: {
      language:        { type: String, trim: true, maxlength: 40 },
      code:            { type: String, trim: true, maxlength: 50000 },
      showLineNumbers: { type: Boolean, default: false },
    },

    callout: {
      variant: { type: String, enum: ['info', 'warning', 'success', 'danger', 'note'], default: 'info' },
      title:   { type: String, trim: true, maxlength: 200 },
      text:    { type: String, trim: true, maxlength: 5000 },
    },

    spacer: {
      height: { type: Number, min: 0, default: 16 },
    },

    signature: {
      label:       { type: String, trim: true, maxlength: 100 },
      name:        { type: String, trim: true, maxlength: 120 },
      designation: { type: String, trim: true, maxlength: 120 },
      imageUrl:    { type: String, trim: true, maxlength: 1000 },
      date:        { type: Date },
    },

    custom: { type: Schema.Types.Mixed, default: undefined },
    style:  { type: Schema.Types.Mixed, default: {} },
  },
  { _id: true }
);

const pageSchema = new Schema<IProposalPage>(
  {
    key:   { type: String, required: true, trim: true, maxlength: 80 },
    title: { type: String, trim: true, maxlength: 200 },
    order: { type: Number, default: 0 },

    size:        { type: String, enum: PAGE_SIZES, default: 'A4' },
    orientation: { type: String, enum: ['portrait', 'landscape'], default: 'portrait' },
    customSize: {
      width:  { type: Number, min: 0 },
      height: { type: Number, min: 0 },
    },

    showHeader:       { type: Boolean, default: false },
    showFooter:       { type: Boolean, default: true },
    headerText:       { type: String, trim: true, maxlength: 300 },
    footerText:       { type: String, trim: true, maxlength: 300 },
    showPageNumber:   { type: Boolean, default: true },
    pageNumberFormat: { type: String, trim: true, maxlength: 60, default: 'Page {n} of {total}' },

    margins: {
      top:    { type: Number, default: 48 },
      right:  { type: Number, default: 48 },
      bottom: { type: Number, default: 48 },
      left:   { type: Number, default: 48 },
    },
    padding: {
      top:    { type: Number, default: 0 },
      right:  { type: Number, default: 0 },
      bottom: { type: Number, default: 0 },
      left:   { type: Number, default: 0 },
    },
    background: {
      color:    { type: String, trim: true, maxlength: 30 },
      imageUrl: { type: String, trim: true, maxlength: 1000 },
    },

    blocks: {
      type: [blockSchema],
      default: [],
      validate: {
        validator: (arr: IProposalBlock[]) => arr.length <= PROPOSAL_BLOCKS_PER_PAGE_MAX,
        message: `At most ${PROPOSAL_BLOCKS_PER_PAGE_MAX} blocks per page`,
      },
    },

    visible: { type: Boolean, default: true },
    locked:  { type: Boolean, default: false },
    notes:   { type: String, trim: true, maxlength: 2000 },
  },
  { _id: true }
);

const projectTransferSnapshotSchema = new Schema<IProjectTransferSnapshot>(
  {
    technical:    { type: Schema.Types.Mixed, default: {} },
    sections:     { type: [transferredSectionSchema], default: [] },
    deliverables: { type: [String], default: [] },
    assumptions:  { type: [String], default: [] },
    dependencies: { type: [String], default: [] },
    outOfScope:   { type: [String], default: [] },
    milestones:   { type: [transferredMilestoneSchema], default: [] },
    budget:       { type: Number, min: 0 },
    currency: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 3,
      default: 'PKR',
    },
    transferredAt: { type: Date, default: Date.now },
    transferredBy: {
      type: Schema.Types.ObjectId,
      ref: 'Employee',
      default: null,
    },
  },
  { _id: false }
);

// ─── Main schema ──────────────────────────────────────────────────────────

const proposalSchema = new Schema<IProposal, IProposalModel>(
  {
    proposalId: { type: String, required: true, unique: true, trim: true },

    // ── Identity ───────────────────────────────────────────────────
    title:          { type: String, required: true, trim: true, maxlength: PROPOSAL_NAME_MAX },
    subtitle:       { type: String, trim: true, maxlength: PROPOSAL_SUBTITLE_MAX },
    proposalNumber: { type: String, trim: true, maxlength: 60 },
    revisionNo:     { type: Number, default: 1, min: 1 },
    version:        { type: Number, default: 1, min: 1 },
    parentProposalId: { type: Schema.Types.ObjectId, ref: 'Proposal', default: null },
    proposalType:   { type: String, enum: PROPOSAL_TYPES, default: 'project', required: true },

    // ── Relationships ──────────────────────────────────────────────
    clientId:      { type: Schema.Types.ObjectId, ref: 'Client',   default: null },
    leadId:        { type: Schema.Types.ObjectId, ref: 'Lead',     default: null },
    salespersonId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    technicalLeadId:   { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    projectManagerId:  { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    projectId:     { type: Schema.Types.ObjectId, ref: 'Project',  default: null },

    // ── Snapshots ──────────────────────────────────────────────────
    clientSnapshot:      { type: clientSnapshotSchema,      default: null },
    salespersonSnapshot: { type: salespersonSnapshotSchema, default: null },
    companySnapshot:     { type: companySnapshotSchema,     default: null },

    // ── Content ────────────────────────────────────────────────────
    sections: {
      type: [sectionSchema],
      default: [],
      validate: {
        validator: (arr: IProposalSection[]) => arr.length <= PROPOSAL_SECTIONS_MAX,
        message: `At most ${PROPOSAL_SECTIONS_MAX} sections allowed`,
      },
    },

    technical: {
      // ── Legacy fields (kept for backward-compat) ─────────────────
      approach:            { type: String, trim: true, maxlength: 5000 },
      techStack:           { type: [String], default: [] },
      architectureSummary: { type: String, trim: true, maxlength: 5000 },
      modules: {
        type: [new Schema(
          {
            name:        { type: String, required: true, trim: true, maxlength: 200 },
            description: { type: String, trim: true, maxlength: 1000 },
          },
          { _id: false }
        )],
        default: [],
      },
      deliverables:    { type: [String], default: [] },
      assumptions:     { type: [String], default: [] },
      dependencies:    { type: [String], default: [] },
      outOfScope:      { type: [String], default: [] },
      testingStrategy: { type: String, trim: true, maxlength: 3000 },
      supportPlan:     { type: String, trim: true, maxlength: 3000 },
      phases: {
        type: [new Schema(
          {
            phase:       { type: String, required: true, trim: true, maxlength: 200 },
            duration:    { type: String, trim: true, maxlength: 100 },
            deliverable: { type: String, trim: true, maxlength: 500 },
          },
          { _id: false }
        )],
        default: [],
      },
      estimatedDurationDays: { type: Number, min: 0 },
      proposedMilestones: {
        type: [new Schema(
          {
            title:       { type: String, required: true, trim: true, maxlength: 200 },
            description: { type: String, trim: true, maxlength: 1000 },
            dueDate:     { type: Date },
          },
          { _id: false }
        )],
        default: [],
      },

      // ── NEW: paginated, block-based content ──────────────────────
      pages: {
        type: [pageSchema],
        default: [],
        validate: {
          validator: (arr: IProposalPage[]) => arr.length <= PROPOSAL_PAGES_MAX,
          message: `At most ${PROPOSAL_PAGES_MAX} pages allowed`,
        },
      },
      toc: {
        enabled:         { type: Boolean, default: false },
        title:           { type: String, trim: true, maxlength: 120, default: 'Table of Contents' },
        maxDepth:        { type: Number, min: 1, max: 6, default: 3 },
        showPageNumbers: { type: Boolean, default: true },
      },
      defaults: {
        size:        { type: String, enum: PAGE_SIZES, default: 'A4' },
        orientation: { type: String, enum: ['portrait', 'landscape'], default: 'portrait' },
        margins: {
          top:    { type: Number, default: 48 },
          right:  { type: Number, default: 48 },
          bottom: { type: Number, default: 48 },
          left:   { type: Number, default: 48 },
        },
      },
    },

    financial: {
      pricingMode:   { type: String, enum: PRICING_MODES, default: 'fixed', required: true },
      currency:      { type: String, default: 'PKR', trim: true, uppercase: true, maxlength: 3 },
      globalDiscountType:   { type: String, enum: DISCOUNT_TYPES, default: undefined },
      globalDiscountValue:  { type: Number, min: 0, default: 0 },
      globalDiscountAmount: { type: Number, min: 0, default: 0 },

      taxType:   { type: String, enum: TAX_TYPES, default: undefined },
      taxRate:   { type: Number, min: 0, max: 100, default: 0 },
      taxAmount: { type: Number, min: 0, default: 0 },
      taxLabel:  { type: String, trim: true, maxlength: 100 },

      paymentTerms: { type: String, trim: true, maxlength: 40 },

      paymentMilestones: {
        type: [paymentMilestoneSchema],
        default: [],
        validate: {
          validator: (arr: IProposalPaymentMilestone[]) => arr.length <= PROPOSAL_MILESTONES_MAX,
          message: `At most ${PROPOSAL_MILESTONES_MAX} milestones allowed`,
        },
      },

      bankDetails: {
        bankName:      { type: String, trim: true, maxlength: 120 },
        accountTitle:  { type: String, trim: true, maxlength: 120 },
        accountNumber: { type: String, trim: true, maxlength: 50 },
        iban:          { type: String, trim: true, uppercase: true, maxlength: 34 },
        branch:        { type: String, trim: true, maxlength: 120 },
      },

      validityDays: { type: Number, min: 0, max: 365, default: DEFAULT_VALIDITY_DAYS },
      validityDate: { type: Date },
      notes:        { type: String, trim: true, maxlength: PROPOSAL_NOTES_MAX },
    },

    lineItems: {
      type: [lineItemSchema],
      default: [],
      validate: {
        validator: (arr: IProposalLineItem[]) => arr.length <= PROPOSAL_LINE_ITEMS_MAX,
        message: `At most ${PROPOSAL_LINE_ITEMS_MAX} line items allowed`,
      },
    },

    totals: { type: totalsSchema, default: () => ({}) },

    // ── Dates ──────────────────────────────────────────────────────
    proposalDate: { type: Date, default: () => new Date(), required: true },
    validUntil:   { type: Date },
    sentAt:       { type: Date },
    viewedAt:     { type: Date },
    acceptedAt:   { type: Date },
    rejectedAt:   { type: Date },
    expiresAt:    { type: Date, index: true },

    // ── Status ─────────────────────────────────────────────────────
    status:       { type: String, enum: PROPOSAL_STATUSES, default: 'draft', required: true, index: true },
    statusReason: { type: String, trim: true, maxlength: 500 },
    isLocked:     { type: Boolean, default: false },

    // ── Acceptance / Project linkage ───────────────────────────────
    clientSignatureUrl:        { type: String, trim: true, maxlength: 500 },
    clientSignedByName:        { type: String, trim: true, maxlength: 120 },
    clientSignedByDesignation: { type: String, trim: true, maxlength: 120 },
    clientSignedAt:            { type: Date },

    projectCreationMode: {
      type: String,
      enum: PROJECT_CREATION_MODES,
      default: 'auto',
      required: true,
    },
    projectCreated: { type: Boolean, default: false },

    projectTransferSnapshot: {
      type: projectTransferSnapshotSchema,
      default: null,
    },

    // ── Sharing / Tracking ─────────────────────────────────────────
    shareToken:          { type: String, trim: true, index: true, sparse: true },
    shareTokenExpiresAt: { type: Date },
    viewCount:           { type: Number, default: 0, min: 0 },

    pdfUrl:         { type: String, trim: true, maxlength: 500 },
    pdfGeneratedAt: { type: Date },

    // ── Notes / Tags ───────────────────────────────────────────────
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr: string[]) => arr.length <= PROPOSAL_TAGS_MAX,
        message: `At most ${PROPOSAL_TAGS_MAX} tags allowed`,
      },
    },
    internalNotes: { type: String, trim: true, maxlength: PROPOSAL_NOTES_MAX },

    // ── Audit ──────────────────────────────────────────────────────
    createdBy: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true, versionKey: false },
    toObject: { virtuals: true, versionKey: false },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────
proposalSchema.index({ status: 1, isDeleted: 1 });
proposalSchema.index({ clientId: 1, status: 1, isDeleted: 1 });
proposalSchema.index({ leadId: 1, status: 1, isDeleted: 1 });
proposalSchema.index({ salespersonId: 1, status: 1, isDeleted: 1 });
proposalSchema.index({ projectId: 1 }, { sparse: true });
proposalSchema.index({ proposalType: 1, isDeleted: 1 });
proposalSchema.index({ proposalDate: -1 });
proposalSchema.index({ expiresAt: 1, status: 1 });
proposalSchema.index({ createdAt: -1 });
proposalSchema.index(
  { title: 'text', subtitle: 'text', proposalNumber: 'text', internalNotes: 'text' },
  { name: 'proposal_text_search' }
);

// ─── Virtuals ─────────────────────────────────────────────────────────────
proposalSchema.virtual('isDraft').get(function () { return this.status === 'draft'; });
proposalSchema.virtual('isSent').get(function () { return this.status === 'sent' || this.status === 'viewed'; });
proposalSchema.virtual('isAccepted').get(function () { return this.status === 'accepted'; });
proposalSchema.virtual('isRejected').get(function () { return this.status === 'rejected'; });
proposalSchema.virtual('isExpired').get(function () {
  if (this.status === 'expired') return true;
  if (this.expiresAt && this.expiresAt.getTime() < Date.now()) return true;
  return false;
});

proposalSchema.virtual('isEditable').get(function () {
  if (this.isLocked) return false;
  return EDITABLE_PROPOSAL_STATUSES.includes(this.status);
});

proposalSchema.virtual('isClientProposal').get(function () { return !!this.clientId; });
proposalSchema.virtual('hasLinkedProject').get(function () { return !!this.projectId; });
proposalSchema.virtual('hasLinkedLead').get(function () { return !!this.leadId; });

proposalSchema.virtual('daysUntilExpiry').get(function () {
  if (!this.expiresAt) return null;
  return Math.ceil((this.expiresAt.getTime() - Date.now()) / 86_400_000);
});

proposalSchema.virtual('lineItemCount').get(function () { return this.lineItems?.length ?? 0; });
proposalSchema.virtual('sectionCount').get(function () { return this.sections?.length ?? 0; });

proposalSchema.virtual('pageCount').get(function () {
  return this.technical?.pages?.length ?? 0;
});

proposalSchema.virtual('blockCount').get(function () {
  if (!this.technical?.pages?.length) return 0;
  return this.technical.pages.reduce((sum, p) => sum + (p.blocks?.length ?? 0), 0);
});

proposalSchema.virtual('primaryMilestone').get(function () {
  if (!this.financial?.paymentMilestones?.length) return null;
  return this.financial.paymentMilestones[0] ?? null;
});

// ─── Auto-generate proposalId ─────────────────────────────────────────────
proposalSchema.pre('validate', async function () {
  if (this.isNew && !this.proposalId) {
    const seq = await Counter.next('proposalId');
    this.proposalId = `PRO-${String(seq).padStart(5, '0')}`;
  }
});

// ─── Pre-save lifecycle ───────────────────────────────────────────────────
proposalSchema.pre('save', function () {
  // ── Compute per-line totals ────────────────────────────────────
  if (this.isModified('lineItems') || this.isNew) {
    for (const item of this.lineItems ?? []) {
      const t = computeLineItemTotals(item);
      item.subtotal = t.subtotal;
      item.discountAmount = t.discountAmount;
      item.taxableAmount = t.taxableAmount;
      item.taxAmountComputed = t.taxAmountComputed;
      item.total = t.total;
    }
  }

  // ── Compute proposal totals ────────────────────────────────────
  if (
    this.isModified('lineItems') ||
    this.isModified('financial') ||
    this.isNew
  ) {
    const totals = computeProposalTotals(
      this.lineItems ?? [],
      this.financial ?? {},
      this.financial?.paymentMilestones ?? [],
      this.financial?.currency ?? 'PKR',
    );
    this.totals = totals;
  }

  // ── NEW: Normalize page/block/row ordering ────────────────────
  if (this.isModified('technical') || this.isNew) {
    if (this.technical?.pages?.length) {
      this.technical.pages
        .sort((a, b) => a.order - b.order)
        .forEach((page, i) => {
          page.order = i;
          if (page.blocks?.length) {
            page.blocks
              .sort((a, b) => a.order - b.order)
              .forEach((blk, j) => { blk.order = j; });
          }
        });
    }
  }

  // ── Compute validity date when sent ────────────────────────────
  if (this.isModified('status') && this.status === 'sent') {
    if (!this.sentAt) this.sentAt = new Date();
    if (!this.validUntil && this.financial?.validityDays) {
      const d = new Date();
      d.setDate(d.getDate() + this.financial.validityDays);
      this.validUntil = d;
      this.expiresAt = d;
    }
  }

  // ── Acceptance ─────────────────────────────────────────────────
  if (this.isModified('status') && this.status === 'accepted') {
    if (!this.acceptedAt) this.acceptedAt = new Date();
    this.isLocked = true;
  }

  // ── Rejection ──────────────────────────────────────────────────
  if (this.isModified('status') && this.status === 'rejected') {
    if (!this.rejectedAt) this.rejectedAt = new Date();
    this.isLocked = true;
  }

  // ── Soft delete ────────────────────────────────────────────────
  if (this.isModified('isDeleted') && this.isDeleted && !this.deletedAt) {
    this.deletedAt = new Date();
  }
});

// ─── Statics ──────────────────────────────────────────────────────────────
proposalSchema.statics.findActive = function (filter: Record<string, any> = {}) {
  return this.find({ ...filter, status: { $nin: ['cancelled'] }, isDeleted: false });
};

proposalSchema.statics.findByClient = function (clientId: Types.ObjectId | string) {
  return this.find({ clientId, isDeleted: false }).sort({ createdAt: -1 });
};

proposalSchema.statics.findBySalesperson = function (employeeId: Types.ObjectId | string) {
  return this.find({ salespersonId: employeeId, isDeleted: false }).sort({ createdAt: -1 });
};

proposalSchema.statics.findByLead = function (leadId: Types.ObjectId | string) {
  return this.find({ leadId, isDeleted: false }).sort({ createdAt: -1 });
};

proposalSchema.statics.findExpired = function () {
  return this.find({
    status: { $in: ['sent', 'viewed'] },
    expiresAt: { $lt: new Date() }, 
    isDeleted: false,
  });
};

// ─── Model export ─────────────────────────────────────────────────────────
const Proposal =
  (mongoose.models.Proposal as IProposalModel) ||
  mongoose.model<IProposal, IProposalModel>('Proposal', proposalSchema);

export default Proposal;