/**
 * Template categories for task templates
 */

export const TEMPLATE_CATEGORIES = [
  'code-review',
  'data-processing',
  'content-generation',
  'research',
  'translation',
  'testing',
  'analysis',
  'other',
] as const;

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

/**
 * Validate if a string is a valid template category
 */
export function isValidTemplateCategory(category: string): category is TemplateCategory {
  return TEMPLATE_CATEGORIES.includes(category as TemplateCategory);
}

/**
 * Get template category display names
 */
export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = {
  'code-review': 'Code Review',
  'data-processing': 'Data Processing',
  'content-generation': 'Content Generation',
  'research': 'Research',
  'translation': 'Translation',
  'testing': 'Testing',
  'analysis': 'Analysis',
  'other': 'Other',
};
