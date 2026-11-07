import { UserRole } from '../types';

/**
 * Administrators inherit access to the manager workspace. Other portals remain
 * isolated because agent and factory-manager screens have different workflows.
 */
export const canAccessRole = (userRole: UserRole, allowedRole?: UserRole) =>
  !allowedRole || userRole === allowedRole || (userRole === 'admin' && allowedRole === 'manager');
