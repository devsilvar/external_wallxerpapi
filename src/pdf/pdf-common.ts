export const PDF_PAGE_SIZE = 'A4';
export const PDF_MARGIN = 40;

export const COMMERCIAL_INVOICE_DISCLAIMER =
  'This is a commercial billing document generated via Wowo. This document does not constitute a statutory FIRS Tax Invoice, VAT receipt or tax return filing. Statutory tax compliance and fiscalisation (if required by applicable law) remain the sole responsibility of the billing entity.';

export function formatCurrencyForPdf(amount: string | number): string {
  const num = typeof amount === 'number' ? amount : parseFloat(amount);
  return `NGN ${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
