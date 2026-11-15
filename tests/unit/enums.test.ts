import { describe, expect, it } from 'vitest';
import { ExpenseCategory, SalesSource } from '@prisma/client';

describe('Enums (reviewed plan §5.7 & P1-03)', () => {
  it('SalesSource has exactly 15 members including api, card, mobile_money, ussd, cheque, other', () => {
    const members = Object.values(SalesSource);
    expect(members).toHaveLength(15);
    expect(members).toContain('api');
    expect(members).toContain('card');
    expect(members).toContain('mobile_money');
    expect(members).toContain('ussd');
    expect(members).toContain('cheque');
    expect(members).toContain('other');
  });

  it('ExpenseCategory has exactly 27 members including power, statutory_contributions, staff_welfare, training, security, licenses_permits', () => {
    const members = Object.values(ExpenseCategory);
    expect(members).toHaveLength(27);
    expect(members).toContain('power');
    expect(members).toContain('statutory_contributions');
    expect(members).toContain('staff_welfare');
    expect(members).toContain('training');
    expect(members).toContain('security');
    expect(members).toContain('licenses_permits');
  });
});
