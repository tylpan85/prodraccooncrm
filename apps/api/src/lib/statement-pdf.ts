import PDFDocument from 'pdfkit';

export interface StatementPdfInput {
  customerDisplayName: string | null;
  dateFrom: string | null;
  dateTo: string | null;
  generatedAt: string | Date;
  jobs: Array<{
    jobNumber: string | null;
    doneAt: string | Date;
    serviceName: string | null;
    invoiceNumber: string | null;
    invoiceStatus: string | null;
    totalCents: number;
    amountDueCents: number;
  }>;
  payments: Array<{
    paidAt: string | Date;
    invoiceNumber: string;
    paymentMethodName: string;
    reference: string | null;
    amountCents: number;
  }>;
  totalsCents: { billed: number; paid: number; outstanding: number };
  companyName: string | null;
  companyAddress: string | null;
  companyPhone: string | null;
  companyWebsite: string | null;
}

const fmtMoney = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

const fmtDate = (d: string | Date | null): string => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export async function buildCustomerStatementPdf(input: StatementPdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Company header
    doc.fontSize(18).font('Helvetica-Bold').text(input.companyName ?? 'Company');
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#444');
    if (input.companyAddress) doc.text(input.companyAddress);
    if (input.companyPhone) doc.text(input.companyPhone);
    if (input.companyWebsite) doc.text(input.companyWebsite);
    doc.fillColor('#000');

    // Statement meta (right side)
    const metaTop = 50;
    const metaX = 380;
    doc.fontSize(22).font('Helvetica-Bold').text('STATEMENT', metaX, metaTop, { align: 'right', width: 165 });
    doc.fontSize(10).font('Helvetica');
    const range =
      input.dateFrom || input.dateTo
        ? `${input.dateFrom ?? '…'} → ${input.dateTo ?? '…'}`
        : 'All time';
    doc.text(range, metaX, metaTop + 30, { align: 'right', width: 165 });
    doc.text(`Generated: ${fmtDate(input.generatedAt)}`, metaX, metaTop + 45, {
      align: 'right',
      width: 165,
    });

    // Customer
    doc.moveDown(2);
    const custY = Math.max(doc.y, 160);
    doc.fontSize(10).font('Helvetica-Bold').text('CUSTOMER', 50, custY);
    doc.font('Helvetica').text(input.customerDisplayName ?? '—', 50, custY + 14);

    let y = custY + 60;

    // Jobs section
    doc.font('Helvetica-Bold').fontSize(12).text('Completed jobs', 50, y);
    y += 20;
    doc.fontSize(9);
    doc.text('Date', 50, y);
    doc.text('Job #', 110, y);
    doc.text('Service', 165, y);
    doc.text('Invoice', 330, y);
    doc.text('Status', 395, y);
    doc.text('Total', 455, y, { width: 50, align: 'right' });
    doc.text('Due', 510, y, { width: 40, align: 'right' });
    y += 12;
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#cccccc').stroke().strokeColor('#000');
    y += 6;
    doc.font('Helvetica');

    if (input.jobs.length === 0) {
      doc.fillColor('#888').text('No completed jobs in range.', 50, y);
      doc.fillColor('#000');
      y += 14;
    } else {
      for (const j of input.jobs) {
        if (y > 680) {
          doc.addPage();
          y = 50;
        }
        doc.text(fmtDate(j.doneAt), 50, y, { width: 55 });
        doc.text(j.jobNumber ?? '—', 110, y, { width: 50 });
        doc.text(j.serviceName ?? '—', 165, y, { width: 160 });
        doc.text(j.invoiceNumber ?? '—', 330, y, { width: 60 });
        doc.text(j.invoiceStatus ?? '—', 395, y, { width: 55 });
        doc.text(fmtMoney(j.totalCents), 455, y, { width: 50, align: 'right' });
        doc.text(fmtMoney(j.amountDueCents), 510, y, { width: 40, align: 'right' });
        y += 14;
      }
    }

    // Payments section
    y += 16;
    if (y > 660) {
      doc.addPage();
      y = 50;
    }
    doc.font('Helvetica-Bold').fontSize(12).text('Payments received', 50, y);
    y += 20;
    doc.fontSize(9);
    doc.text('Date', 50, y);
    doc.text('Invoice', 110, y);
    doc.text('Method', 175, y);
    doc.text('Reference', 290, y);
    doc.text('Amount', 480, y, { width: 70, align: 'right' });
    y += 12;
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#cccccc').stroke().strokeColor('#000');
    y += 6;
    doc.font('Helvetica');

    if (input.payments.length === 0) {
      doc.fillColor('#888').text('No payments in range.', 50, y);
      doc.fillColor('#000');
      y += 14;
    } else {
      for (const p of input.payments) {
        if (y > 680) {
          doc.addPage();
          y = 50;
        }
        doc.text(fmtDate(p.paidAt), 50, y, { width: 55 });
        doc.text(p.invoiceNumber, 110, y, { width: 60 });
        doc.text(p.paymentMethodName, 175, y, { width: 110 });
        doc.text(p.reference ?? '—', 290, y, { width: 185 });
        doc.text(fmtMoney(p.amountCents), 480, y, { width: 70, align: 'right' });
        y += 14;
      }
    }

    // Totals
    y += 20;
    if (y > 700) {
      doc.addPage();
      y = 50;
    }
    doc.moveTo(350, y).lineTo(550, y).strokeColor('#cccccc').stroke().strokeColor('#000');
    y += 8;
    const totalsRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10);
      doc.text(label, 350, y, { width: 100, align: 'right' });
      doc.text(value, 450, y, { width: 100, align: 'right' });
      y += 16;
    };
    totalsRow('Billed', fmtMoney(input.totalsCents.billed));
    totalsRow('Paid', `-${fmtMoney(input.totalsCents.paid)}`);
    totalsRow('Outstanding', fmtMoney(input.totalsCents.outstanding), true);

    doc.end();
  });
}
