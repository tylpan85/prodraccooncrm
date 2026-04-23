import PDFDocument from 'pdfkit';

export interface InvoicePdfInput {
  invoiceNumber: string;
  status: string;
  createdAt: string | Date;
  dueDate: string | null;
  paidAt: string | Date | null;
  customerDisplayName: string | null;
  serviceNameSnapshot: string | null;
  serviceDate: string | Date | null;
  subtotalCents: number;
  totalCents: number;
  paidCents: number;
  amountDueCents: number;
  lineItems: Array<{ description: string; priceCents: number }>;
  payments: Array<{
    paymentMethodName: string;
    amountCents: number;
    reference: string | null;
    paidAt: string | Date;
  }>;
  companyNameSnapshot: string | null;
  companyAddressSnapshot: string | null;
  companyPhoneSnapshot: string | null;
  companyWebsiteSnapshot: string | null;
}

const fmtMoney = (cents: number): string =>
  `$${(cents / 100).toFixed(2)}`;

const fmtDate = (d: string | Date | null): string => {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

export async function buildInvoicePdf(inv: InvoicePdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Company header
    doc.fontSize(18).font('Helvetica-Bold').text(inv.companyNameSnapshot ?? 'Company', { continued: false });
    doc.moveDown(0.2);
    doc.fontSize(10).font('Helvetica').fillColor('#444');
    if (inv.companyAddressSnapshot) doc.text(inv.companyAddressSnapshot);
    if (inv.companyPhoneSnapshot) doc.text(inv.companyPhoneSnapshot);
    if (inv.companyWebsiteSnapshot) doc.text(inv.companyWebsiteSnapshot);
    doc.fillColor('#000');

    // Invoice meta (right side)
    const metaTop = 50;
    const metaX = 380;
    doc.fontSize(22).font('Helvetica-Bold').text('INVOICE', metaX, metaTop, { align: 'right', width: 165 });
    doc.fontSize(10).font('Helvetica');
    doc.text(`# ${inv.invoiceNumber}`, metaX, metaTop + 30, { align: 'right', width: 165 });
    doc.text(`Date: ${fmtDate(inv.createdAt)}`, metaX, metaTop + 45, { align: 'right', width: 165 });
    let metaY = metaTop + 60;
    if (inv.serviceDate) {
      doc.text(`Service Date: ${fmtDate(inv.serviceDate)}`, metaX, metaY, { align: 'right', width: 165 });
      metaY += 15;
    }
    if (inv.dueDate) doc.text(`Due: ${fmtDate(inv.dueDate)}`, metaX, metaY, { align: 'right', width: 165 });

    // Bill To
    doc.moveDown(2);
    const billY = Math.max(doc.y, 160);
    doc.fontSize(10).font('Helvetica-Bold').text('BILL TO', 50, billY);
    doc.font('Helvetica').text(inv.customerDisplayName ?? '—', 50, billY + 14);

    // Line items table
    let y = billY + 60;
    doc.font('Helvetica-Bold').fontSize(10);
    doc.text('Description', 50, y);
    doc.text('Amount', 450, y, { width: 100, align: 'right' });
    y += 14;
    doc.moveTo(50, y).lineTo(550, y).strokeColor('#cccccc').stroke().strokeColor('#000');
    y += 8;
    doc.font('Helvetica');

    const lines = inv.lineItems.length > 0
      ? inv.lineItems
      : [{ description: inv.serviceNameSnapshot ?? 'Service', priceCents: inv.totalCents }];

    for (const li of lines) {
      const desc = li.description ?? 'Service';
      const descHeight = doc.heightOfString(desc, { width: 380 });
      doc.text(desc, 50, y, { width: 380 });
      doc.text(fmtMoney(li.priceCents), 450, y, { width: 100, align: 'right' });
      y += Math.max(descHeight, 14) + 4;
      if (y > 680) {
        doc.addPage();
        y = 50;
      }
    }

    // Totals
    y += 10;
    doc.moveTo(350, y).lineTo(550, y).strokeColor('#cccccc').stroke().strokeColor('#000');
    y += 8;
    const totalsRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
      doc.text(label, 350, y, { width: 100, align: 'right' });
      doc.text(value, 450, y, { width: 100, align: 'right' });
      y += 16;
    };
    totalsRow('Subtotal', fmtMoney(inv.subtotalCents));
    totalsRow('Total', fmtMoney(inv.totalCents), true);
    if (inv.paidCents > 0) totalsRow('Paid', `-${fmtMoney(inv.paidCents)}`);
    totalsRow('Amount Due', fmtMoney(inv.amountDueCents), true);

    // Payments list
    if (inv.payments.length > 0) {
      y += 16;
      doc.font('Helvetica-Bold').fontSize(10).text('Payments', 50, y);
      y += 16;
      doc.font('Helvetica');
      for (const p of inv.payments) {
        const ref = p.reference ? ` (${p.reference})` : '';
        doc.text(
          `${fmtDate(p.paidAt)} — ${p.paymentMethodName}${ref}`,
          50,
          y,
          { width: 400 },
        );
        doc.text(fmtMoney(p.amountCents), 450, y, { width: 100, align: 'right' });
        y += 14;
      }
    }

    // PAID stamp overlay
    if (inv.status === 'paid') {
      doc.save();
      doc.rotate(-20, { origin: [300, 400] });
      doc.fontSize(110).fillColor('#dc2626').opacity(0.35).font('Helvetica-Bold');
      doc.text('PAID', 150, 350, { width: 300, align: 'center' });
      doc.opacity(1).fillColor('#000');
      doc.restore();
    }

    doc.end();
  });
}
