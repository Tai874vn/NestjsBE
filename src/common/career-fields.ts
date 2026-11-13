/**
 * JobAura career fields. Keep identical to `careerFields` in the frontend (src/features/users/resume-career.ts)
 * and FIELDS in AIService app/career_fields.py: the seniority model is trained on this list,
 * and the job categories use the same names.
 */
export const CAREER_FIELDS = [
  'QA',
  'Data',
  'IT and security',
  'DevOps',
  'Software development',
  'Business analysis',
  'Project and product management',
  'Design',
  'HR and recruiting',
  'Marketing and PR',
  'Sales and business development',
  'Accounting',
  'Banking',
  'Finance',
  'Insurance',
  'Customer support',
  'Teaching',
  'Healthcare',
  'Food and hospitality',
  'Construction',
  'Aviation',
  'Automotive',
  'Agriculture',
  'Social work',
  'Legal',
  'Fitness',
  'Beauty and personal care',
  'Media and arts',
  'Apparel and fashion',
  'Real estate',
  'Logistics and transport',
  'Public safety and security',
  'Manufacturing and production',
  'Science and research',
  'Consulting',
  'Administration',
  'Engineering',
] as const;

export type CareerField = (typeof CAREER_FIELDS)[number];

export function isCareerField(value: unknown): value is CareerField {
  return CAREER_FIELDS.some((field) => field === value);
}
