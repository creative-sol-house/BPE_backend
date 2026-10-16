// services/proposalDocxRenderer.ts
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import sizeOf from 'image-size';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  ISectionOptions,
  Packer,
  PageOrientation,
  Paragraph,
  ParagraphChild,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

import type {
  IProposal,
  IProposalPage,
  IProposalBlock,
  ITableBlockData,
  ITableColumn,
  ITableRow,
  HeadingLevel as HeadingLevelType,
  PageSize,
  PageOrientation as PageOrientationType,
} from '../model/proposal';

// ═════════════════════════════════════════════════════════════════════════
// TYPES
// ═════════════════════════════════════════════════════════════════════════

export interface RenderOptions {
  /** Absolute path to the .docx template (with header/footer pre-set). */
  templatePath: string;
  /** Absolute path where the final .docx should be written. */
  outputPath: string;
  /** Absolute directory to save inline images (temp cache). Optional. */
  imageCacheDir?: string;
  /** Default currency formatting locale. */
  locale?: string;
}

export interface RenderResult {
  outputPath: string;
  bytes: number;
  pagesRendered: number;
  blocksRendered: number;
}

// ═════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═════════════════════════════════════════════════════════════════════════

/** Page-size dimensions in twips (1 inch = 1440 twips). */
const PAGE_DIMENSIONS: Record<
  Exclude<PageSize, 'Custom'>,
  { width: number; height: number }
> = {
  A4:     { width: 11906, height: 16838 },
  Letter: { width: 12240, height: 15840 },
  Legal:  { width: 12240, height: 20160 },
  A3:     { width: 16838, height: 23811 },
};

const HEADING_LEVEL_MAP: Record<HeadingLevelType, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

const CALLOUT_COLORS: Record<string, string> = {
  info:    '1F6FEB',
  warning: 'D29922',
  success: '2DA44E',
  danger:  'CF222E',
  note:    '6E7781',
};

// ═════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═════════════════════════════════════════════════════════════════════════

/** Strip HTML tags from a string (used as a fallback). */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

/** Flatten TipTap JSON into plain text paragraphs. */
function flattenTiptap(node: any, out: string[] = []): string[] {
  if (!node || typeof node !== 'object') return out;
  if (node.type === 'text' && typeof node.text === 'string') {
    if (out.length === 0) out.push('');
    out[out.length - 1] += node.text;
  }
  if (node.type === 'hardBreak') {
    if (out.length === 0) out.push('');
    out[out.length - 1] += '\n';
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) flattenTiptap(child, out);
  }
  if (node.type === 'paragraph' || node.type === 'heading') {
    out.push('');
  }
  return out;
}

/** Convert any text block payload to plain paragraphs. */
function textBlockToParagraphs(block: IProposalBlock): string[] {
  const t = block.text;
  if (!t) return [];

  if (t.format === 'plain') {
    return String(t.plainText || t.content || '').split(/\n+/);
  }
  if (t.format === 'html') {
    const raw = typeof t.content === 'string' ? t.content : String(t.plainText || '');
    return stripHtml(raw).split(/\n+/);
  }
  // tiptap
  const out = flattenTiptap(t.content).filter((s) => s.trim().length > 0);
  return out.length ? out : String(t.plainText || '').split(/\n+/);
}

/** Fetch an image and return { buffer, width, height, type }. */
async function loadImage(
  url: string,
  cacheDir?: string
): Promise<{ buffer: Buffer; width: number; height: number; type: string } | null> {
  try {
    let buffer: Buffer;

    if (url.startsWith('data:image/')) {
      const base64 = url.split(',')[1] || '';
      buffer = Buffer.from(base64, 'base64');
    } else if (url.startsWith('http://') || url.startsWith('https://')) {
      const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 15000 });
      buffer = Buffer.from(res.data);
    } else {
      const local = cacheDir ? path.join(cacheDir, path.basename(url)) : url;
      buffer = await fs.readFile(local);
    }

    const dim = sizeOf(buffer);
    if (!dim.width || !dim.height) return null;

    return {
      buffer,
      width: dim.width,
      height: dim.height,
      type: dim.type || 'png',
    };
  } catch (err) {
    console.warn('[docx] image load failed:', url, err);
    return null;
  }
}

/** Clamp a numeric image width to a page-safe max (twips). */
function imageSizeToTwips(
  imgW: number,
  imgH: number,
  desiredWidthTwips: number
): { width: number; height: number } {
  const ratio = imgH / imgW;
  return {
    width: desiredWidthTwips,
    height: Math.round(desiredWidthTwips * ratio),
  };
}

// ═════════════════════════════════════════════════════════════════════════
// BLOCK RENDERERS
// ═════════════════════════════════════════════════════════════════════════

async function renderHeading(block: IProposalBlock): Promise<Paragraph> {
  const h = block.heading!;
  const align =
    h.align === 'center'
      ? AlignmentType.CENTER
      : h.align === 'right'
        ? AlignmentType.RIGHT
        : AlignmentType.LEFT;

  return new Paragraph({
    heading: HEADING_LEVEL_MAP[h.level] ?? HeadingLevel.HEADING_2,
    alignment: align,
    children: [
      new TextRun({
        text: h.text,
        bold: true,
        color: h.color?.replace('#', '') || undefined,
      }),
    ],
  });
}

function renderParagraphs(block: IProposalBlock): Paragraph[] {
  const lines = textBlockToParagraphs(block);
  return lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line, size: 22 })],
        spacing: { after: 120 },
      })
  );
}

function renderList(block: IProposalBlock): Paragraph[] {
  const l = block.list!;
  const out: Paragraph[] = [];
  for (let i = 0; i < l.items.length; i++) {
    const bullet = l.ordered ? `${(l.startAt ?? 1) + i}. ` : '\u2022  ';
    out.push(
      new Paragraph({
        children: [new TextRun({ text: bullet + l.items[i], size: 22 })],
        indent: { left: 360, hanging: 260 },
        spacing: { after: 80 },
      })
    );
  }
  return out;
}

async function renderImage(
  block: IProposalBlock,
  cacheDir?: string
): Promise<Paragraph | null> {
  const im = block.image!;
  const loaded = await loadImage(im.url, cacheDir);
  if (!loaded) {
    return new Paragraph({
      children: [new TextRun({ text: `[image: ${im.alt || im.url}]`, italics: true })],
    });
  }

  // Target width default: 5 inches = 7200 twips
  const desiredTwips = im.width
    ? im.widthUnit === 'px'
      ? Math.round((im.width / 96) * 1440)
      : im.widthUnit === '%'
        ? Math.round(7200 * (im.width / 100))
        : 7200
    : 7200;
  const sized = imageSizeToTwips(loaded.width, loaded.height, desiredTwips);

  const align =
    im.align === 'left'
      ? AlignmentType.LEFT
      : im.align === 'right'
        ? AlignmentType.RIGHT
        : AlignmentType.CENTER;

  const children: ParagraphChild[] = [
    new ImageRun({
      data: loaded.buffer,
      transformation: { width: sized.width, height: sized.height },
      type: loaded.type === 'jpg' ? 'jpg' : loaded.type === 'jpeg' ? 'jpg' : 'png',
    }),
  ];

  const paras: Paragraph[] = [
    new Paragraph({ alignment: align, children }),
  ];
  if (im.caption) {
    paras.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: im.caption, italics: true, size: 18, color: '666666' }),
        ],
      })
    );
  }
  return paras[0]; // caption handled below in renderBlock — see note
}

async function renderImageWithCaption(
  block: IProposalBlock,
  cacheDir?: string
): Promise<Paragraph[]> {
  const im = block.image!;
  const loaded = await loadImage(im.url, cacheDir);
  if (!loaded) {
    return [
      new Paragraph({
        children: [new TextRun({ text: `[image: ${im.alt || im.url}]`, italics: true })],
      }),
    ];
  }

  const desiredTwips = im.width
    ? im.widthUnit === 'px'
      ? Math.round((im.width / 96) * 1440)
      : im.widthUnit === '%'
        ? Math.round(7200 * (im.width / 100))
        : 7200
    : 7200;
  const sized = imageSizeToTwips(loaded.width, loaded.height, desiredTwips);

  const align =
    im.align === 'left'
      ? AlignmentType.LEFT
      : im.align === 'right'
        ? AlignmentType.RIGHT
        : AlignmentType.CENTER;

  const out: Paragraph[] = [
    new Paragraph({
      alignment: align,
      children: [
        new ImageRun({
          data: loaded.buffer,
          transformation: { width: sized.width, height: sized.height },
          type: loaded.type === 'jpg' ? 'jpg' : loaded.type === 'jpeg' ? 'jpg' : 'png',
        }),
      ],
    }),
  ];

  if (im.caption) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: im.caption, italics: true, size: 18, color: '666666' }),
        ],
      })
    );
  }
  return out;
}

function renderCode(block: IProposalBlock): Paragraph[] {
  const c = block.code!;
  const lines = c.code.split('\n');
  return lines.map(
    (line, i) =>
      new Paragraph({
        children: [
          new TextRun({
            text: c.showLineNumbers ? `${String(i + 1).padStart(3, ' ')}  ${line}` : line,
            font: 'Consolas',
            size: 20,
          }),
        ],
        shading: { fill: 'F5F5F5' },
        spacing: { after: 0, line: 240 },
      })
  );
}

function renderCallout(block: IProposalBlock): Paragraph[] {
  const c = block.callout!;
  const color = CALLOUT_COLORS[c.variant] || '6E7781';
  const out: Paragraph[] = [];

  if (c.title) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: c.title, bold: true, color, size: 22 })],
        spacing: { before: 160, after: 40 },
      })
    );
  }
  for (const line of c.text.split('\n')) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: line, color, size: 22 })],
        spacing: { after: 60 },
      })
    );
  }
  return out;
}

function renderDivider(): Paragraph {
  return new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } },
    spacing: { before: 120, after: 120 },
    children: [],
  });
}

function renderSpacer(block: IProposalBlock): Paragraph {
  const height = block.spacer?.height ?? 16;
  const pt = Math.max(1, Math.round((height / 16) * 12));
  return new Paragraph({ children: [new TextRun({ text: '', size: pt * 2 })] });
}

function renderSignature(block: IProposalBlock): Paragraph[] {
  const s = block.signature!;
  const out: Paragraph[] = [];

  out.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  out.push(new Paragraph({ children: [new TextRun({ text: '' })] }));
  out.push(
    new Paragraph({
      children: [
        new TextRun({ text: '_______________________', size: 22 }),
      ],
    })
  );
  if (s.name) {
    out.push(
      new Paragraph({ children: [new TextRun({ text: s.name, bold: true, size: 22 })] })
    );
  }
  if (s.designation) {
    out.push(
      new Paragraph({ children: [new TextRun({ text: s.designation, size: 20, color: '555555' })] })
    );
  }
  if (s.date) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: new Date(s.date).toLocaleDateString(), size: 20, color: '777777' })],
      })
    );
  }
  return out;
}

function renderTable(block: IProposalBlock): Table {
  const t = block.table!;
  const columns = t.columns.filter((c) => !c.hidden);
  const visibleKeys = columns.map((c) => c.key);

  const headerCells = columns.map(
    (col) =>
      new TableCell({
        width: columnWidth(col, columns),
        shading: { fill: 'F2F2F2' },
        children: [
          new Paragraph({
            alignment: alignFor(col.align),
            children: [new TextRun({ text: col.label, bold: true, size: 20 })],
          }),
        ],
      })
  );

  const rows: TableRow[] = [];
  if (headerCells.length) rows.push(new TableRow({ children: headerCells }));

  for (const r of t.rows) {
    if (r.isHeader) {
      rows.push(
        new TableRow({
          children: columns.map(
            (col) =>
              new TableCell({
                width: columnWidth(col, columns),
                shading: { fill: 'F2F2F2' },
                children: [
                  new Paragraph({
                    alignment: alignFor(col.align),
                    children: [
                      new TextRun({
                        text: String(r.cells[col.key] ?? ''),
                        bold: true,
                        size: 20,
                      }),
                    ],
                  }),
                ],
              })
          ),
        })
      );
      continue;
    }

    rows.push(
      new TableRow({
        children: columns.map(
          (col) =>
            new TableCell({
              width: columnWidth(col, columns),
              shading: r.isSubtotal ? { fill: 'FAFAFA' } : undefined,
              children: [
                new Paragraph({
                  alignment: alignFor(col.align),
                  children: [
                    new TextRun({
                      text: formatCell(r.cells[col.key], col),
                      bold: r.isSubtotal === true,
                      size: 20,
                    }),
                  ],
                }),
              ],
            })
        ),
      })
    );
  }

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows,
    borders: t.bordered
      ? undefined
      : {
          top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        },
  });
}

function alignFor(a?: string): (typeof AlignmentType)[keyof typeof AlignmentType] {
  if (a === 'center') return AlignmentType.CENTER;
  if (a === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

function columnWidth(col: ITableColumn, all: ITableColumn[]): { size: number; type: (typeof WidthType)[keyof typeof WidthType] } {
  if (col.width && col.widthUnit === '%') {
    return { size: Math.round(col.width * 50), type: WidthType.PERCENTAGE };
  }
  if (col.widthUnit === 'fr' && typeof col.width === 'number') {
    const total = all.reduce((s, c) => s + (c.width ?? 1), 0) || 1;
    const pct = Math.round((col.width / total) * 100);
    return { size: pct * 50, type: WidthType.PERCENTAGE };
  }
  const equal = Math.round(100 / (all.length || 1));
  return { size: equal * 50, type: WidthType.PERCENTAGE };
}

function formatCell(value: any, col: ITableColumn): string {
  if (value === null || value === undefined) return '';
  if (col.type === 'number' && typeof value === 'number') return String(value);
  if (col.type === 'currency' && typeof value === 'number') {
    return value.toLocaleString(undefined, { minimumFractionDigits: 2 });
  }
  if (col.type === 'date') {
    const d = new Date(String(value));
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
  }
  if (col.type === 'boolean') return value ? '✓' : '—';
  return String(value);
}

// ═════════════════════════════════════════════════════════════════════════
// BLOCK DISPATCHER
// ═════════════════════════════════════════════════════════════════════════

type BlockOutput = Paragraph | Table | (Paragraph | Table)[];

async function renderBlock(
  block: IProposalBlock,
  cacheDir?: string
): Promise<BlockOutput | null> {
  if (!block.visible) return null;

  switch (block.type) {
    case 'heading':
      return block.heading ? renderHeading(block) : null;
    case 'paragraph':
      return renderParagraphs(block);
    case 'bullets':
    case 'numbered':
      return block.list ? renderList(block) : null;
    case 'table':
      return block.table ? renderTable(block) : null;
    case 'image':
      return block.image ? renderImageWithCaption(block, cacheDir) : null;
    case 'code':
      return block.code ? renderCode(block) : null;
    case 'callout':
      return block.callout ? renderCallout(block) : null;
    case 'divider':
      return renderDivider();
    case 'spacer':
      return renderSpacer(block);
    case 'signature':
      return block.signature ? renderSignature(block) : null;
    case 'custom':
      return renderParagraphs(block);
    default:
      return null;
  }
}

function flattenBlockOutput(out: BlockOutput | null): (Paragraph | Table)[] {
  if (!out) return [];
  return Array.isArray(out) ? out : [out];
}

// ═════════════════════════════════════════════════════════════════════════
// PAGE → SECTION
// ═════════════════════════════════════════════════════════════════════════

function sectionDimensionsFor(page: IProposalPage): {
  width: number;
  height: number;
  orientation: (typeof PageOrientation)[keyof typeof PageOrientation];
} {
  let base: { width: number; height: number };

  if (page.size === 'Custom' && page.customSize) {
    // custom size given in px → twips
    base = {
      width: Math.round((page.customSize.width / 96) * 1440),
      height: Math.round((page.customSize.height / 96) * 1440),
    };
  } else {
    base = PAGE_DIMENSIONS[(page.size as Exclude<PageSize, 'Custom'>) ?? 'A4'] ?? PAGE_DIMENSIONS.A4;
  }

  const isLandscape = page.orientation === 'landscape';
  const width = isLandscape ? base.height : base.width;
  const height = isLandscape ? base.width : base.height;

  return {
    width,
    height,
    orientation:
      page.orientation === 'landscape'
        ? PageOrientation.LANDSCAPE
        : PageOrientation.PORTRAIT,
  };
}

async function renderPageAsSection(
  page: IProposalPage,
  cacheDir: string | undefined,
  totalPages: number,
  pageIndex: number
): Promise<ISectionOptions | null> {
  if (!page.visible) return null;

  const dims = sectionDimensionsFor(page);
  const margins = page.margins ?? { top: 48, right: 48, bottom: 48, left: 48 };

  // Sort + filter blocks
  const blocks = (page.blocks ?? [])
    .filter((b) => b.visible)
    .sort((a, b) => a.order - b.order);

  const children: (Paragraph | Table)[] = [];

  for (const block of blocks) {
    const rendered = await renderBlock(block, cacheDir);
    children.push(...flattenBlockOutput(rendered));
  }

  // Header/footer text (page-level — template still owns the master chrome)
  const headerText = page.showHeader && page.headerText
    ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: page.headerText, size: 18, color: '777777' })] })]
    : undefined;

  const footerText = page.showFooter
    ? [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({
              text: page.footerText
                ? `${page.footerText}${page.showPageNumber ? `   |   ${(page.pageNumberFormat || 'Page {n} of {total}')
                    .replace('{n}', String(pageIndex + 1))
                    .replace('{total}', String(totalPages))}` : ''}`
                : page.showPageNumber
                  ? (page.pageNumberFormat || 'Page {n} of {total}')
                      .replace('{n}', String(pageIndex + 1))
                      .replace('{total}', String(totalPages))
                  : '',
              size: 18,
              color: '777777',
            }),
          ],
        }),
      ]
    : undefined;

  return {
    properties: {
      page: {
        size: { width: dims.width, height: dims.height, orientation: dims.orientation },
        margin: {
          top: margins.top * 20,
          right: margins.right * 20,
          bottom: margins.bottom * 20,
          left: margins.left * 20,
        },
      },
    },
    headers: headerText ? { default: { options: { children: headerText } } } : undefined,
    footers: footerText ? { default: { options: { children: footerText } } } : undefined,
    children,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// LEGACY → PAGE
// ═════════════════════════════════════════════════════════════════════════

function legacyTechnicalToPage(proposal: IProposal): IProposalPage | null {
  const t: any = proposal.technical || {};
  const hasAny =
    t.approach ||
    (t.techStack?.length ?? 0) > 0 ||
    t.architectureSummary ||
    (t.modules?.length ?? 0) > 0 ||
    (t.deliverables?.length ?? 0) > 0;

  if (!hasAny) return null;

  let order = 0;
  const blocks: IProposalBlock[] = [];

  const pushHeading = (text: string, level: HeadingLevelType = 2) =>
    blocks.push({
      key: `legacy_h_${order}`,
      type: 'heading',
      order: order++,
      visible: true,
      heading: { text, level },
    });

  const pushParagraph = (text: string) =>
    blocks.push({
      key: `legacy_p_${order}`,
      type: 'paragraph',
      order: order++,
      visible: true,
      text: { format: 'plain', content: text, plainText: text },
    });

  const pushBullets = (items: string[]) => {
    if (!items.length) return;
    blocks.push({
      key: `legacy_b_${order}`,
      type: 'bullets',
      order: order++,
      visible: true,
      list: { items },
    });
  };

  if (t.approach) {
    pushHeading('Approach');
    pushParagraph(t.approach);
  }
  if (t.architectureSummary) {
    pushHeading('Architecture Summary');
    pushParagraph(t.architectureSummary);
  }
  if (t.techStack?.length) {
    pushHeading('Technology Stack');
    pushBullets(t.techStack);
  }
  if (t.modules?.length) {
    pushHeading('Modules');
    blocks.push({
      key: `legacy_tbl_${order}`,
      type: 'table',
      order: order++,
      visible: true,
      table: {
        columns: [
          { key: 'name', label: 'Module', width: 1, widthUnit: 'fr' },
          { key: 'description', label: 'Description', width: 2, widthUnit: 'fr' },
        ],
        rows: t.modules.map((m: any) => ({
          cells: { name: m.name, description: m.description || '' },
        })),
        striped: true,
        bordered: true,
      },
    });
  }
  if (t.deliverables?.length) {
    pushHeading('Deliverables');
    pushBullets(t.deliverables);
  }
  if (t.assumptions?.length) {
    pushHeading('Assumptions');
    pushBullets(t.assumptions);
  }
  if (t.dependencies?.length) {
    pushHeading('Dependencies');
    pushBullets(t.dependencies);
  }
  if (t.outOfScope?.length) {
    pushHeading('Out of Scope');
    pushBullets(t.outOfScope);
  }
  if (t.testingStrategy) {
    pushHeading('Testing Strategy');
    pushParagraph(t.testingStrategy);
  }
  if (t.supportPlan) {
    pushHeading('Support Plan');
    pushParagraph(t.supportPlan);
  }

  if (!blocks.length) return null;

  return {
    key: 'page_legacy',
    title: 'Overview',
    order: 0,
    size: 'A4',
    orientation: 'portrait',
    showHeader: false,
    showFooter: true,
    showPageNumber: true,
    pageNumberFormat: 'Page {n} of {total}',
    margins: { top: 48, right: 48, bottom: 48, left: 48 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    blocks,
    visible: true,
    locked: false,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// MAIN RENDERER
// ═════════════════════════════════════════════════════════════════════════

export async function renderProposalToDocx(
  proposal: IProposal,
  options: RenderOptions
): Promise<RenderResult> {
  const { templatePath, outputPath, imageCacheDir, locale } = options;

  // ── 1. Resolve pages (with legacy fallback) ───────────────────────────
  let pages: IProposalPage[] = [];

  const tech: any = proposal.technical || {};
  if (Array.isArray(tech.pages) && tech.pages.length > 0) {
    pages = tech.pages
      .map((p: any) =>
        typeof p.toObject === 'function'
          ? (p.toObject({ virtuals: false }) as IProposalPage)
          : (p as IProposalPage)
      )
      .filter((p: IProposalPage) => p.visible !== false)
      .sort((a: IProposalPage, b: IProposalPage) => a.order - b.order);
  }

  if (pages.length === 0) {
    const fallback = legacyTechnicalToPage(proposal);
    if (fallback) pages = [fallback];
  }

  if (pages.length === 0) {
    // Nothing to render — create a single empty page with a title
    pages = [
      {
        key: 'page_empty',
        title: proposal.title || 'Proposal',
        order: 0,
        size: 'A4',
        orientation: 'portrait',
        showHeader: false,
        showFooter: true,
        showPageNumber: true,
        pageNumberFormat: 'Page {n} of {total}',
        margins: { top: 48, right: 48, bottom: 48, left: 48 },
        padding: { top: 0, right: 0, bottom: 0, left: 0 },
        blocks: [
          {
            key: 'blk_title',
            type: 'heading',
            order: 0,
            visible: true,
            heading: { text: proposal.title || 'Proposal', level: 1 },
          },
          {
            key: 'blk_empty',
            type: 'paragraph',
            order: 1,
            visible: true,
            text: {
              format: 'plain',
              content: 'No technical content has been added yet.',
              plainText: 'No technical content has been added yet.',
            },
          },
        ],
        visible: true,
        locked: false,
      },
    ];
  }

  // ── 2. Render each page as its own section ────────────────────────────
  const totalPages = pages.length;
  const sections: ISectionOptions[] = [];

  let blocksRendered = 0;

  for (let i = 0; i < pages.length; i++) {
    const section = await renderPageAsSection(pages[i], imageCacheDir, totalPages, i);
    if (!section) continue;
    sections.push(section);
    blocksRendered += (pages[i].blocks ?? []).filter((b) => b.visible).length;
  }

  // ── 3. Build a standalone Document (fallback path) ────────────────────
  const doc = new Document({
    creator: proposal.companySnapshot?.name || 'Proposal System',
    title: proposal.title,
    description: proposal.subtitle || '',
    sections,
  });

  const generatedBuffer = await Packer.toBuffer(doc);

  // ── 4. Inject into template (header/footer preserved) ─────────────────
  let finalBuffer: Buffer;

  try {
    const templateBytes = await fs.readFile(templatePath);
    const zip = new PizZip(templateBytes);

    // Replace the entire body of `word/document.xml` with the generated one
    // while keeping headers/footers/styles/theme intact.
    const generatedZip = new PizZip(generatedBuffer);
    const generatedDocXml = generatedZip.file('word/document.xml')?.asText();

    if (!generatedDocXml) {
      throw new Error('Generated document.xml missing');
    }

    // Read template's document.xml to preserve any top-level section properties
    const templateDocXml = zip.file('word/document.xml')?.asText();
    if (!templateDocXml) {
      throw new Error('Template document.xml missing');
    }

    // Extract body content from the generated XML
    const generatedBodyMatch = generatedDocXml.match(/<w:body>([\s\S]*)<\/w:body>/);
    const generatedBody = generatedBodyMatch ? generatedBodyMatch[1] : '';

    if (!generatedBody) {
      throw new Error('Could not extract body from generated document');
    }

    // Keep the template's <w:body> opening, replace inner content
    const newDocXml = templateDocXml.replace(
      /<w:body>([\s\S]*)<\/w:body>/,
      `<w:body>${generatedBody}</w:body>`
    );

    zip.file('word/document.xml', newDocXml);

    finalBuffer = zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  } catch (err) {
    console.warn('[docx] template injection failed, using plain document:', err);
    finalBuffer = generatedBuffer;
  }

  // ── 5. Write output ───────────────────────────────────────────────────
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, finalBuffer);

  return {
    outputPath,
    bytes: finalBuffer.length,
    pagesRendered: pages.length,
    blocksRendered,
  };
}

export default renderProposalToDocx;