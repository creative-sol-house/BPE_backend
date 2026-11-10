// model/constants.ts
// Single source of truth for departments & designations across
// User, Employee, and all controllers.

export const DEPARTMENTS = [
  'management',
  'administration',
  'hr',
  'accounts',
  'web_design_development',
  'mobile_app_development',
  'software_development',
  'seo',
  'marketing',
  'business_development_international',
  'business_development_local',
  'qa_qc',
  'rnd',
  'audit',
] as const;

export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  management: 'Management',
  administration: 'Administration',
  hr: 'HR',
  accounts: 'Accounts',
  web_design_development: 'Web Design & Development',
  mobile_app_development: 'Mobile App Development',
  software_development: 'Software Development',
  seo: 'Search Engine Optimization',
  marketing: 'Marketing',
  business_development_international: 'Business Development (International)',
  business_development_local: 'Business Development (Local)',
  qa_qc: 'QA & QC',
  rnd: 'R&D',
  audit: 'Audit (Internal & External)',
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