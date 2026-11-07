import { describe, expect, it } from 'vitest';
import { isContactLookupPath } from '../src/app.js';

describe('global rate-limit routing', () => {
  it.each([
    '/api/v1/contacts',
    '/api/v1/contacts/whatsapp-destination',
    '/api/v1/contacts/admin',
  ])('leaves authenticated contact limiting to the contact router for %s', (pathName) => {
    expect(isContactLookupPath(pathName)).toBe(true);
  });

  it.each([
    '/api/v1/contact',
    '/api/v1/contacts-malicious-prefix',
    '/api/v1/tracking/locations',
  ])('keeps unrelated endpoints in the shared limiter for %s', (pathName) => {
    expect(isContactLookupPath(pathName)).toBe(false);
  });
});
