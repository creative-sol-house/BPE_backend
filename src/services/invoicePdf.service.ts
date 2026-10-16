// services/invoicePdf.service.ts
import PDFDocument from 'pdfkit';
import type { IInvoice } from '../model/accounting';

interface InvoicePdfOptions {
  companyName?: string;
  companyAddress?: string;
  companyEmail?: string;
  companyPhone?: string;
  companyNtn?: string;
  companyLogoUrl?: string;
}

const DEFAULT_COMPANY: Required<InvoicePdfOptions> = {
  companyName: 'CS_ERP',
  companyAddress: '',
  companyEmail: '',
  companyPhone: '',
  companyNtn: '',
  companyLogoUrl: '',
};

function fmtMoney(n: number, currency = 'PKR'): string {
  const v = Number(n || 0);
  return `${currency} ${v.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(d: any): string {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Generate an invoice PDF and return it as a Buffer.
 * The caller writes it to the HTTP response.
 */
export function generateInvoicePdf(
  invoice: IInvoice,
  options: InvoicePdfOptions = {}
): Promise<Buffer> {
  const company = { ...DEFAULT_COMPANY, ...options };

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ═════════════════════════════════════════════════════════
      // Header band
      // ═════════════════════════════════════════════════════════
      doc.rect(0, 0, doc.page.width, 90).fill('#0f172a');

      doc
        .fillColor('#ffffff')
        .fontSize(22)
        .font('Helvetica-Bold')
        .text(company.companyName, 40, 30);

      doc
        .fontSize(9)
        .font('Helvetica')
        .text('INVOICE', 40, 58);

      // Right side: invoice number + dates
      const rightX = doc.page.width - 260;

      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .text(invoice.invoiceNumber, rightX, 30, {
          width: 220,
          align: 'right',
        });

      doc
        .fontSize(8)
        .font('Helvetica')
        .text(
          `Issued: ${fmtDate(invoice.issueDate)}    Due: ${fmtDate(invoice.dueDate)}`,
          rightX,
          48,
          { width: 220, align: 'right' }
        );

      const statusText =
        invoice.status === 'paid'
          ? 'PAID'
          : invoice.status === 'overdue'
          ? 'OVERDUE'
          : invoice.status === 'partial'
          ? 'PARTIAL'
          : invoice.status.toUpperCase();

      doc
        .fontSize(11)
        .font('Helvetica-Bold')
        .fillColor(invoice.status === 'paid' ? '#22c55e' : '#f59e0b')
        .text(statusText, rightX, 66, { width: 220, align: 'right' });

      // Reset
      doc.fillColor('#0f172a').font('Helvetica');

      // ═════════════════════════════════════════════════════════
      // Bill-to
      // ═════════════════════════════════════════════════════════
      let y = 120;
      const leftCol = 40;
      const rightCol = doc.page.width / 2 + 10;
      const colWidth = doc.page.width / 2 - 50;

      doc.fontSize(9).font('Helvetica-Bold').fillColor('#64748b');
      doc.text('BILL TO', leftCol, y);
      doc.text('FROM', rightCol, y);

      y += 16;
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#0f172a');

      const client: any = invoice.clientId || {};
      const clientName = client.name || client.displayName || '—';
      const clientEmail = client.email || '';
      const clientPhone = client.phoneNo || '';
      const clientAddr = client.addresses?.[0];

      doc.text(clientName, leftCol, y, { width: colWidth });
      doc.text(company.companyName, rightCol, y, { width: colWidth });

      y += 14;
      doc.fontSize(9).font('Helvetica').fillColor('#475569');

      const clientLines: string[] = [];
      if (clientEmail) clientLines.push(clientEmail);
      if (clientPhone) clientLines.push(clientPhone);
      if (clientAddr) {
        const addr = [
          clientAddr.line1,
          clientAddr.line2,
          [clientAddr.city, clientAddr.state, clientAddr.postalCode]
            .filter(Boolean)
            .join(' '),
          clientAddr.country,
        ]
          .filter(Boolean)
          .join(', ');
        if (addr) clientLines.push(addr);
      }
      if (client.ntn) clientLines.push(`NTN: ${client.ntn}`);

      doc.text(clientLines.join('\n') || '—', leftCol, y, {
        width: colWidth,
        lineGap: 2,
      });

      const companyLines: string[] = [];
      if (company.companyAddress) companyLines.push(company.companyAddress);
      if (company.companyEmail) companyLines.push(company.companyEmail);
      if (company.companyPhone) companyLines.push(company.companyPhone);
      if (company.companyNtn) companyLines.push(`NTN: ${company.companyNtn}`);

      doc.text(companyLines.join('\n') || '—', rightCol, y, {
        width: colWidth,
        lineGap: 2,
      });

      // ═════════════════════════════════════════════════════════
      // Line items table
      // ═════════════════════════════════════════════════════════
      y = 240;

      const tableLeft = 40;
      const tableWidth = doc.page.width - 80;
      const colDesc = tableWidth * 0.5;
      const colQty = tableWidth * 0.12;
      const colPrice = tableWidth * 0.19;
      const colAmount = tableWidth * 0.19;

      // Header row
      doc.rect(tableLeft, y, tableWidth, 22).fill('#f1f5f9');
      doc.fillColor('#0f172a').fontSize(9).font('Helvetica-Bold');

      const headerY = y + 7;
      doc.text('#', tableLeft + 6, headerY, { width: 20 });
      doc.text('DESCRIPTION', tableLeft + 30, headerY, { width: colDesc - 30 });
      doc.text('QTY', tableLeft + colDesc, headerY, {
        width: colQty,
        align: 'right',
      });
      doc.text('UNIT PRICE', tableLeft + colDesc + colQty, headerY, {
        width: colPrice,
        align: 'right',
      });
      doc.text('AMOUNT', tableLeft + colDesc + colQty + colPrice, headerY, {
        width: colAmount - 6,
        align: 'right',
      });

      y += 22;

      // Body rows
      doc.font('Helvetica').fontSize(9).fillColor('#0f172a');
      const rowHeight = 24;

      (invoice.lines || []).forEach((line: any, idx: number) => {
        if (y > doc.page.height - 200) {
          doc.addPage();
          y = 40;
        }

        // Zebra
        if (idx % 2 === 1) {
          doc.rect(tableLeft, y, tableWidth, rowHeight).fill('#fafafa');
          doc.fillColor('#0f172a');
        }

        const rowY = y + 7;
        doc.text(String(idx + 1), tableLeft + 6, rowY, { width: 20 });
        doc.text(String(line.description || '').slice(0, 80), tableLeft + 30, rowY, {
          width: colDesc - 30,
        });
        doc.text(String(line.quantity || 0), tableLeft + colDesc, rowY, {
          width: colQty,
          align: 'right',
        });
        doc.text(fmtMoney(line.unitPrice, '').replace(/^PKR /, ''), tableLeft + colDesc + colQty, rowY, {
          width: colPrice,
          align: 'right',
        });
        doc.text(fmtMoney(line.amount, '').replace(/^PKR /, ''), tableLeft + colDesc + colQty + colPrice, rowY, {
          width: colAmount - 6,
          align: 'right',
        });

        // Divider
        doc
          .moveTo(tableLeft, y + rowHeight)
          .lineTo(tableLeft + tableWidth, y + rowHeight)
          .strokeColor('#e2e8f0')
          .stroke();

        y += rowHeight;
      });

      // ═════════════════════════════════════════════════════════
      // Totals
      // ═════════════════════════════════════════════════════════
      y += 12;

      const totalsX = doc.page.width - 260;
      const totalsWidth = 220;
      const totalsRowHeight = 20;

      doc.font('Helvetica').fontSize(9).fillColor('#475569');

      // Subtotal
      doc.text('Subtotal', totalsX, y, { width: totalsWidth - 90 });
      doc.text(fmtMoney(invoice.subTotal, invoice.currency), totalsX + 90, y, {
        width: 130,
        align: 'right',
      });
      y += totalsRowHeight;

      // Discount
      if (invoice.discountAmount > 0) {
        doc.text('Discount', totalsX, y, { width: totalsWidth - 90 });
        doc.text(
          `- ${fmtMoney(invoice.discountAmount, invoice.currency)}`,
          totalsX + 90,
          y,
          { width: 130, align: 'right' }
        );
        y += totalsRowHeight;
      }

      // Tax
      if (invoice.taxAmount > 0) {
        doc.text('Tax', totalsX, y, { width: totalsWidth - 90 });
        doc.text(fmtMoney(invoice.taxAmount, invoice.currency), totalsX + 90, y, {
          width: 130,
          align: 'right',
        });
        y += totalsRowHeight;
      }

      // Total band
      doc.rect(totalsX, y, totalsWidth, 28).fill('#0f172a');
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(10);
      doc.text('TOTAL', totalsX + 8, y + 9, { width: totalsWidth - 100 });
      doc.text(fmtMoney(invoice.totalAmount, invoice.currency), totalsX + 90, y + 9, {
        width: 122,
        align: 'right',
      });

      y += 28;

      // Paid / Balance
      if (invoice.paidAmount > 0) {
        doc.fillColor('#475569').font('Helvetica').fontSize(9);
        doc.text('Amount Paid', totalsX, y + 6, { width: totalsWidth - 90 });
        doc.text(
          `- ${fmtMoney(invoice.paidAmount, invoice.currency)}`,
          totalsX + 90,
          y + 6,
          { width: 130, align: 'right' }
        );
        y += 18;

        doc
          .fillColor('#0f172a')
          .font('Helvetica-Bold')
          .fontSize(10)
          .text('Balance Due', totalsX, y + 6, { width: totalsWidth - 90 });
        doc.text(fmtMoney(invoice.balanceDue, invoice.currency), totalsX + 90, y + 6, {
          width: 130,
          align: 'right',
        });
        y += 20;
      }

      // ═════════════════════════════════════════════════════════
      // Notes / Terms
      // ═════════════════════════════════════════════════════════
      if (invoice.notes || invoice.terms) {
        y += 20;

        if (y > doc.page.height - 120) {
          doc.addPage();
          y = 40;
        }

        doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
        if (invoice.notes) {
          doc.text('Notes', 40, y);
          y += 14;
          doc.font('Helvetica').fontSize(8).fillColor('#475569');
          doc.text(String(invoice.notes).slice(0, 500), 40, y, {
            width: doc.page.width - 80,
            lineGap: 2,
          });
          y += doc.heightOfString(String(invoice.notes).slice(0, 500), {
            width: doc.page.width - 80,
          });
          y += 10;
        }

        if (invoice.terms) {
          doc.font('Helvetica-Bold').fontSize(9).fillColor('#0f172a');
          doc.text('Terms & Conditions', 40, y);
          y += 14;
          doc.font('Helvetica').fontSize(8).fillColor('#475569');
          doc.text(String(invoice.terms).slice(0, 800), 40, y, {
            width: doc.page.width - 80,
            lineGap: 2,
          });
        }
      }

      // ═════════════════════════════════════════════════════════
      // Footer
      // ═════════════════════════════════════════════════════════
      const footerY = doc.page.height - 40;
      doc
        .fontSize(7)
        .fillColor('#94a3b8')
        .font('Helvetica')
        .text(
          `${company.companyName} — Invoice ${invoice.invoiceNumber}`,
          40,
          footerY,
          { width: doc.page.width - 80, align: 'center' }
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}