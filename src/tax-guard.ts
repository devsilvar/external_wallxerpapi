/**
 * src/tax-guard.ts
 *
 * The external surface never computes tax. This is the only place that decides
 * a tax rate, and it always decides zero. isDeductible covers expenses, which
 * default to true in the SME schema and feed idx_expense_tax_calc.
 */
export const EXTERNAL_TAX = {
  vatRate: 0,
  vatAmount: 0,
  isTaxable: false,
  isDeductible: false,
} as const;
