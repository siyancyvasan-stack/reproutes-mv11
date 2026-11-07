import { describe, expect, it } from 'vitest';
import { Role } from '../src/lib/enums.js';
import { filterSchema, hasDefaultExportPermission } from '../src/modules/exports/export.service.js';

describe('export security policy', () => {
  it('denies factory access to private field activity and invoices by default', () => {
    expect(hasDefaultExportPermission(Role.FACTORY_MANAGER, 'daily_activity')).toBe(false);
    expect(hasDefaultExportPermission(Role.FACTORY_MANAGER, 'route_history')).toBe(false);
    expect(hasDefaultExportPermission(Role.FACTORY_MANAGER, 'invoices')).toBe(false);
    expect(hasDefaultExportPermission(Role.FACTORY_MANAGER, 'stock_report')).toBe(true);
  });

  it('permits agents only for self-scoped dataset definitions', () => {
    expect(hasDefaultExportPermission(Role.AGENT, 'orders')).toBe(true);
    expect(hasDefaultExportPermission(Role.AGENT, 'attendance')).toBe(true);
    expect(hasDefaultExportPermission(Role.AGENT, 'agents')).toBe(false);
    expect(hasDefaultExportPermission(Role.AGENT, 'products')).toBe(false);
  });

  it('rejects unknown filters, reversed dates, and ranges over one year', () => {
    expect(filterSchema.safeParse({ unexpected: 'field' }).success).toBe(false);
    expect(filterSchema.safeParse({ from: '2026-08-16', to: '2026-08-15' }).success).toBe(false);
    expect(filterSchema.safeParse({ from: '2024-01-01', to: '2026-08-15' }).success).toBe(false);
    expect(filterSchema.safeParse({ from: '2026-08-01', to: '2026-08-15', status: 'COMPLETED' }).success).toBe(true);
    expect(filterSchema.safeParse({ from: '2026-08-01', to: '2026-08-15', fuelType: 'PETROL', search: 'Colombo' }).success).toBe(true);
    expect(filterSchema.safeParse({ fuelType: 'INVALID' }).success).toBe(false);
  });
});
