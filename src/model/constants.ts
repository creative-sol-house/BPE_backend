// model/constants.ts
// Single source of truth for departments & designations across
// User, Employee, and all controllers.

export const DEPARTMENTS = [
  'production',
  'quality_control',
  'maintenance',
  'store',
  'purchase',
  'accounts',
  'hr',
  'admin',
  'sales',
  'it',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  production: 'Production',
  quality_control: 'Quality Control',
  maintenance: 'Maintenance',
  store: 'Store',
  purchase: 'Purchase',
  accounts: 'Accounts',
  hr: 'HR',
  admin: 'Admin',
  sales: 'Sales',
  it: 'IT',
};

// Designation is free-text, but these are the suggested values for the
// dropdown / autocomplete in the UI. Validation only enforces max length.
export const SUGGESTED_DESIGNATIONS = [
  'Manager',
  'Assistant Manager',
  'Supervisor',
  'Operator',
  'Technician',
  'Accountant',
  'Clerk',
  'Driver',
  'Guard',
  'Helper',
] as const;

export const DESIGNATION_MAX_LENGTH = 100;