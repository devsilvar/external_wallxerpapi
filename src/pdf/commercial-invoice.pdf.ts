import PDFDocument from 'pdfkit';
import { COMMERCIAL_INVOICE_DISCLAIMER, PDF_MARGIN, PDF_PAGE_SIZE } from './pdf-common.js';
import { toDateOnly } from '../lib/dates.js';
import { formatMoney } from '../lib/money.js';

export interface InvoicePdfData {
  invoiceNumber: string;
  externalRef: string;
  issueDate: Date;
  dueDate: Date;
  status: string;
  customerName: string;
  customerEmail?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  subtotal: Parameters<typeof formatMoney>[0];
  discount: Parameters<typeof formatMoney>[0];
  total: Parameters<typeof formatMoney>[0];
  currency: string;
  notes?: string | null;
  paymentTerms?: string | null;
  lines: Array<{
    description: string;
    quantity: Parameters<typeof formatMoney>[0];
    unitPrice: Parameters<typeof formatMoney>[0];
    lineTotal: Parameters<typeof formatMoney>[0];
    sortOrder?: number;
  }>;
}

export interface BusinessPdfData {
  businessName: string;
  ownerName: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export function generateCommercialInvoicePdf(
  invoice: InvoicePdfData,
  business: BusinessPdfData
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: PDF_PAGE_SIZE,
        margin: PDF_MARGIN,
        compress: false,
        info: {
          Title: `Commercial Invoice - ${invoice.invoiceNumber}`,
          Author: business.businessName,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (err) => reject(err));

      const pageWidth = doc.page.width;
      const contentWidth = pageWidth - PDF_MARGIN * 2;

      // -----------------------------------------------------------------------
      // Header: Document Title & Metadata
      // -----------------------------------------------------------------------
      doc
        .font('Helvetica-Bold')
        .fontSize(22)
        .fillColor('#111827')
        .text('COMMERCIAL INVOICE', PDF_MARGIN, PDF_MARGIN, { align: 'left' });

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor('#4B5563')
        .text(`Invoice Number: ${invoice.invoiceNumber}`, PDF_MARGIN, PDF_MARGIN + 30)
        .text(`Reference: ${invoice.externalRef}`, PDF_MARGIN, PDF_MARGIN + 45)
        .text(`Issue Date: ${toDateOnly(invoice.issueDate)}`, PDF_MARGIN, PDF_MARGIN + 60)
        .text(`Due Date: ${toDateOnly(invoice.dueDate)}`, PDF_MARGIN, PDF_MARGIN + 75)
        .text(`Status: ${invoice.status.toUpperCase()}`, PDF_MARGIN, PDF_MARGIN + 90);

      // Business Info (Right Aligned)
      const rightX = pageWidth - PDF_MARGIN - 220;
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor('#111827')
        .text(business.businessName, rightX, PDF_MARGIN, { width: 220, align: 'right' });

      let bizY = PDF_MARGIN + 16;
      doc.font('Helvetica').fontSize(9).fillColor('#4B5563');

      if (business.address) {
        doc.text(business.address, rightX, bizY, { width: 220, align: 'right' });
        bizY += 13;
      }
      if (business.city || business.state) {
        const cityState = [business.city, business.state].filter(Boolean).join(', ');
        doc.text(cityState, rightX, bizY, { width: 220, align: 'right' });
        bizY += 13;
      }
      if (business.contactEmail) {
        doc.text(business.contactEmail, rightX, bizY, { width: 220, align: 'right' });
        bizY += 13;
      }
      if (business.contactPhone) {
        doc.text(business.contactPhone, rightX, bizY, { width: 220, align: 'right' });
        bizY += 13;
      }

      // -----------------------------------------------------------------------
      // Bill To (Customer Details)
      // -----------------------------------------------------------------------
      const billToY = Math.max(PDF_MARGIN + 115, bizY + 15);
      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#111827')
        .text('BILL TO:', PDF_MARGIN, billToY);

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor('#374151')
        .text(invoice.customerName, PDF_MARGIN, billToY + 16);

      let custY = billToY + 30;
      doc.font('Helvetica').fontSize(9).fillColor('#4B5563');

      if (invoice.customerAddress) {
        doc.text(invoice.customerAddress, PDF_MARGIN, custY, { width: 250 });
        custY += 13;
      }
      if (invoice.customerEmail) {
        doc.text(invoice.customerEmail, PDF_MARGIN, custY);
        custY += 13;
      }
      if (invoice.customerPhone) {
        doc.text(invoice.customerPhone, PDF_MARGIN, custY);
        custY += 13;
      }

      // -----------------------------------------------------------------------
      // Line Items Table
      // -----------------------------------------------------------------------
      let tableY = Math.max(custY + 20, billToY + 70);

      const colDescX = PDF_MARGIN;
      const colDescW = contentWidth * 0.50;
      const colQtyX = colDescX + colDescW;
      const colQtyW = contentWidth * 0.12;
      const colPriceX = colQtyX + colQtyW;
      const colPriceW = contentWidth * 0.18;
      const colTotalX = colPriceX + colPriceW;
      const colTotalW = contentWidth * 0.20;

      // Table Header
      doc
        .rect(PDF_MARGIN, tableY, contentWidth, 20)
        .fill('#F3F4F6');

      doc
        .font('Helvetica-Bold')
        .fontSize(9)
        .fillColor('#374151')
        .text('DESCRIPTION', colDescX + 6, tableY + 6, { width: colDescW - 12 })
        .text('QTY', colQtyX, tableY + 6, { width: colQtyW - 6, align: 'right' })
        .text('UNIT PRICE', colPriceX, tableY + 6, { width: colPriceW - 6, align: 'right' })
        .text('AMOUNT', colTotalX, tableY + 6, { width: colTotalW - 6, align: 'right' });

      tableY += 24;

      // Render Rows
      let itemsOnPage = 0;
      const maxItemsFirstPage = 12;

      for (const item of invoice.lines) {
        if (itemsOnPage >= maxItemsFirstPage) {
          // Add continuation page past 12 line items
          drawFooter(doc, pageWidth);
          doc.addPage();
          tableY = PDF_MARGIN;
          itemsOnPage = 0;

          // Continuation Table Header
          doc
            .rect(PDF_MARGIN, tableY, contentWidth, 20)
            .fill('#F3F4F6');

          doc
            .font('Helvetica-Bold')
            .fontSize(9)
            .fillColor('#374151')
            .text('DESCRIPTION (Cont.)', colDescX + 6, tableY + 6, { width: colDescW - 12 })
            .text('QTY', colQtyX, tableY + 6, { width: colQtyW - 6, align: 'right' })
            .text('UNIT PRICE', colPriceX, tableY + 6, { width: colPriceW - 6, align: 'right' })
            .text('AMOUNT', colTotalX, tableY + 6, { width: colTotalW - 6, align: 'right' });

          tableY += 24;
        }

        doc
          .font('Helvetica')
          .fontSize(9)
          .fillColor('#1F2937')
          .text(item.description, colDescX + 6, tableY, { width: colDescW - 12 })
          .text(formatMoney(item.quantity), colQtyX, tableY, { width: colQtyW - 6, align: 'right' })
          .text(formatMoney(item.unitPrice), colPriceX, tableY, { width: colPriceW - 6, align: 'right' })
          .text(formatMoney(item.lineTotal), colTotalX, tableY, { width: colTotalW - 6, align: 'right' });

        tableY += 18;
        itemsOnPage++;
      }

      // Bottom border for table
      doc
        .moveTo(PDF_MARGIN, tableY + 4)
        .lineTo(pageWidth - PDF_MARGIN, tableY + 4)
        .strokeColor('#E5E7EB')
        .stroke();

      tableY += 12;

      // -----------------------------------------------------------------------
      // Totals Box (Subtotal, Discount, Total) — NO VAT ROW!
      // -----------------------------------------------------------------------
      const totalsWidth = 200;
      const totalsX = pageWidth - PDF_MARGIN - totalsWidth;

      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#4B5563')
        .text('Subtotal:', totalsX, tableY, { width: 90, align: 'left' })
        .text(`${invoice.currency} ${formatMoney(invoice.subtotal)}`, totalsX + 90, tableY, {
          width: 110,
          align: 'right',
        });

      tableY += 16;

      const discountVal = parseFloat(formatMoney(invoice.discount));
      if (discountVal > 0) {
        doc
          .text('Discount:', totalsX, tableY, { width: 90, align: 'left' })
          .text(`-${invoice.currency} ${formatMoney(invoice.discount)}`, totalsX + 90, tableY, {
            width: 110,
            align: 'right',
          });
        tableY += 16;
      }

      // CRITICAL: NO VAT ROW AT ALL. Never render "VAT" or "VAT: ₦0".
      doc
        .rect(totalsX - 5, tableY - 2, totalsWidth + 5, 22)
        .fill('#F9FAFB');

      doc
        .font('Helvetica-Bold')
        .fontSize(11)
        .fillColor('#111827')
        .text('Total:', totalsX, tableY + 4, { width: 90, align: 'left' })
        .text(`${invoice.currency} ${formatMoney(invoice.total)}`, totalsX + 90, tableY + 4, {
          width: 110,
          align: 'right',
        });

      // Notes & Payment terms
      let notesY = tableY + 35;
      if (invoice.paymentTerms) {
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#374151')
          .text('Payment Terms: ', PDF_MARGIN, notesY, { continued: true })
          .font('Helvetica')
          .text(invoice.paymentTerms);
        notesY += 14;
      }

      if (invoice.notes) {
        doc
          .font('Helvetica-Bold')
          .fontSize(9)
          .fillColor('#374151')
          .text('Notes: ', PDF_MARGIN, notesY, { continued: true })
          .font('Helvetica')
          .text(invoice.notes);
      }

      // Draw footer on current page
      drawFooter(doc, pageWidth);

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function drawFooter(doc: PDFKit.PDFDocument, pageWidth: number) {
  const footerY = doc.page.height - PDF_MARGIN - 35;
  const contentWidth = pageWidth - PDF_MARGIN * 2;

  doc
    .moveTo(PDF_MARGIN, footerY)
    .lineTo(pageWidth - PDF_MARGIN, footerY)
    .strokeColor('#E5E7EB')
    .stroke();

  doc
    .font('Helvetica')
    .fontSize(7)
    .fillColor('#9CA3AF')
    .text(COMMERCIAL_INVOICE_DISCLAIMER, PDF_MARGIN, footerY + 6, {
      width: contentWidth,
      align: 'center',
      lineGap: 1.5,
    });
}
