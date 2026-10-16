import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import type {
  IProposal,
  IProposalLineItem,
  IProposalSection,
  IProposalPaymentMilestone,
} from "../model/proposal";

// Resolves to src/services/templates/... in dev,
// and dist/services/templates/... in production (after copy step).
const TEMPLATE_PATH = path.join(
  __dirname,
  "templates",
  "Creative_Sol_House_Proposal_Template.docx"
);

const DEBUG = process.env.DOCX_DEBUG === "1";

// ─── Public API ────────────────────────────────────────────────────────────

export function generateProposalDocx(proposal: IProposal): Buffer {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Template not found at ${TEMPLATE_PATH}`);
  }

  const content = fs.readFileSync(TEMPLATE_PATH, "binary");
  const zip = new PizZip(content);

  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => "",
  });

  const data = buildTemplateData(proposal);

  if (DEBUG) {
    console.log("═══════════════════════════════════════════");
    console.log("📄 Template:", TEMPLATE_PATH);
    console.log("📄 Size:", content.length, "bytes");
    try {
      console.log(
        "📄 Modified:",
        fs.statSync(TEMPLATE_PATH).mtime.toISOString()
      );
    } catch {
      /* ignore */
    }
    console.log("📄 Data keys:", Object.keys(data));
    console.log(
      "📄 clientSnapshot:",
      JSON.stringify(data.clientSnapshot, null, 2)
    );
    console.log("📄 salespersonSnapshot:", JSON.stringify(data.salespersonSnapshot, null, 2));
    console.log("📄 companySnapshot:", JSON.stringify(data.companySnapshot, null, 2));
    console.log("📄 totals:", JSON.stringify(data.totals, null, 2));
    console.log("📄 lineItems count:", data.lineItems.length);
    console.log(
      "📄 paymentMilestones count:",
      data.financial.paymentMilestones.length
    );
    console.log("═══════════════════════════════════════════");
  }

  doc.render(data);

  return doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  }) as Buffer;
}

// ─── Data mapping ──────────────────────────────────────────────────────────

function buildTemplateData(proposal: IProposal) {
  const p: any = proposal.toObject
    ? proposal.toObject({ virtuals: false })
    : proposal;

  return {
    // Identity
    title: p.title ?? "",
    subtitle: p.subtitle ?? "",
    proposalNumber: p.proposalNumber ?? p.proposalId ?? "",
    revisionNo: p.revisionNo ?? 1,
    version: p.version ?? 1,
    proposalType: p.proposalType ?? "",

    // Dates
    proposalDate: fmtDate(p.proposalDate),
    validUntil: fmtDate(p.validUntil),
    expiresAt: fmtDate(p.expiresAt),

    // Client
    clientSnapshot: {
      name: p.clientSnapshot?.name ?? "",
      displayName: p.clientSnapshot?.displayName ?? "",
      email: p.clientSnapshot?.email ?? "",
      phoneNo: p.clientSnapshot?.phoneNo ?? "",
      website: p.clientSnapshot?.website ?? "",
      ntn: p.clientSnapshot?.ntn ?? "",
      strn: p.clientSnapshot?.strn ?? "",
      cnic: p.clientSnapshot?.cnic ?? "",
      address: {
        line1: p.clientSnapshot?.address?.line1 ?? "",
        line2: p.clientSnapshot?.address?.line2 ?? "",
        city: p.clientSnapshot?.address?.city ?? "",
        state: p.clientSnapshot?.address?.state ?? "",
        postalCode: p.clientSnapshot?.address?.postalCode ?? "",
        country: p.clientSnapshot?.address?.country ?? "",
      },
      primaryContact: {
        name: p.clientSnapshot?.primaryContact?.name ?? "",
        designation: p.clientSnapshot?.primaryContact?.designation ?? "",
        email: p.clientSnapshot?.primaryContact?.email ?? "",
        phoneNo: p.clientSnapshot?.primaryContact?.phoneNo ?? "",
      },
      paymentTerms: p.clientSnapshot?.paymentTerms ?? "",
    },

    // Salesperson
    salespersonSnapshot: {
      name: p.salespersonSnapshot?.name ?? "",
      designation: p.salespersonSnapshot?.designation ?? "",
      department: p.salespersonSnapshot?.department ?? "",
      email: p.salespersonSnapshot?.email ?? "",
      phoneNo: p.salespersonSnapshot?.phoneNo ?? "",
      whatsapp: p.salespersonSnapshot?.whatsapp ?? "",
      linkedin: p.salespersonSnapshot?.linkedin ?? "",
    },

    // Company
    companySnapshot: {
      name: p.companySnapshot?.name ?? "",
      tagline: p.companySnapshot?.tagline ?? "",
      address: p.companySnapshot?.address ?? "",
      email: p.companySnapshot?.email ?? "",
      phoneNo: p.companySnapshot?.phoneNo ?? "",
      website: p.companySnapshot?.website ?? "",
      ntn: p.companySnapshot?.ntn ?? "",
      strn: p.companySnapshot?.strn ?? "",
      registrationNo: p.companySnapshot?.registrationNo ?? "",
      bankDetails: {
        bankName: p.companySnapshot?.bankDetails?.bankName ?? "",
        accountTitle: p.companySnapshot?.bankDetails?.accountTitle ?? "",
        accountNumber: p.companySnapshot?.bankDetails?.accountNumber ?? "",
        iban: p.companySnapshot?.bankDetails?.iban ?? "",
        branch: p.companySnapshot?.bankDetails?.branch ?? "",
      },
    },

    // Sections loop
    sections: (p.sections ?? [])
      .filter((s: IProposalSection) => s.visible !== false)
      .sort(
        (a: IProposalSection, b: IProposalSection) =>
          (a.order ?? 0) - (b.order ?? 0)
      )
      .map((s: IProposalSection) => ({
        title: s.title ?? "",
        plainText: s.plainText ?? tiptapToPlain(s.content),
      })),

    // Line items loop
    lineItems: (p.lineItems ?? [])
      .slice()
      .sort(
        (a: IProposalLineItem, b: IProposalLineItem) =>
          (a.order ?? 0) - (b.order ?? 0)
      )
      .map((item: IProposalLineItem) => ({
        name: item.name ?? "",
        description: item.description ?? "",
        category: item.category ?? "",
        quantity: fmtNum(item.quantity),
        unit: item.unit ?? "",
        unitPrice: fmtMoney(
          item.unitPrice,
          item.currency ?? p.financial?.currency
        ),
        currency: item.currency ?? p.financial?.currency ?? "PKR",
        discountAmount: fmtMoney(item.discountAmount),
        taxAmountComputed: fmtMoney(item.taxAmountComputed),
        subtotal: fmtMoney(item.subtotal),
        total: fmtMoney(item.total),
        notes: item.notes ?? "",
      })),

    // Totals
    totals: {
      subtotal: fmtMoney(p.totals?.subtotal),
      totalDiscount: fmtMoney(p.totals?.totalDiscount),
      totalTax: fmtMoney(p.totals?.totalTax),
      total: fmtMoney(p.totals?.total),
      advanceRequired: fmtMoney(p.totals?.advanceRequired),
      balanceDue: fmtMoney(p.totals?.balanceDue),
      currency: p.totals?.currency ?? p.financial?.currency ?? "PKR",
    },

    // Financial
    financial: {
      pricingMode: p.financial?.pricingMode ?? "",
      currency: p.financial?.currency ?? "PKR",
      taxLabel: p.financial?.taxLabel ?? "",
      paymentTerms: p.financial?.paymentTerms ?? "",
      validityDays: p.financial?.validityDays ?? 30,
      notes: p.financial?.notes ?? "",
      paymentMilestones: (p.financial?.paymentMilestones ?? []).map(
        (m: IProposalPaymentMilestone) => ({
          label: m.label ?? "",
          description: m.description ?? "",
          percentage: m.percentage ?? "",
          amount: fmtMoney(m.amount),
          dueDate: fmtDate(m.dueDate),
          notes: m.notes ?? "",
        })
      ),
    },

    // Acceptance
    clientSignedByName: p.clientSignedByName ?? "",
    clientSignedByDesignation: p.clientSignedByDesignation ?? "",
    clientSignedAt: fmtDate(p.clientSignedAt),
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function fmtDate(d?: Date | string | null): string {
  if (!d) return "";
  const date = new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtMoney(n?: number | null, currency?: string): string {
  if (n === null || n === undefined) return "";
  const num = Number(n);
  if (Number.isNaN(num)) return "";
  const formatted = num.toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}

function fmtNum(n?: number | null): string {
  if (n === null || n === undefined) return "";
  const num = Number(n);
  return Number.isNaN(num) ? "" : String(num);
}

function tiptapToPlain(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  if (typeof content !== "object") return "";

  const walk = (node: any): string => {
    if (!node) return "";
    if (node.type === "text") return node.text ?? "";
    if (Array.isArray(node.content)) return node.content.map(walk).join("\n");
    return "";
  };

  return walk(content);
}