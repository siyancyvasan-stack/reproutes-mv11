import { describe, expect, it } from 'vitest';
import { normalizeInternationalNumber } from '../src/modules/contacts/phone.js';

describe('normalizeInternationalNumber', () => {
  it('normalizes Sri Lankan local numbers', () => expect(normalizeInternationalNumber('077-123 4567')).toBe('94771234567'));
  it('keeps international digits and removes formatting', () => expect(normalizeInternationalNumber('+94 77 123 4567')).toBe('94771234567'));
  it('supports 00 international prefixes', () => expect(normalizeInternationalNumber('0094 77 123 4567')).toBe('94771234567'));
  it('rejects missing and implausible numbers', () => { expect(normalizeInternationalNumber('')).toBeNull(); expect(normalizeInternationalNumber('123')).toBeNull(); });
});
