import Ajv, { ValidateFunction, ErrorObject } from 'ajv';
import { TaskTemplate } from '@opentr8/database';
import { SchemaValidationError } from '@opentr8/shared';

// Create Ajv instance with strict mode and all formats
const ajv = new Ajv({
  allErrors: true,
  strict: true,
  strictTypes: true,
  strictTuples: true,
  strictRequired: true,
  validateFormats: true,
});

// Cache compiled validators for performance
const inputValidatorCache = new Map<string, ValidateFunction>();
const outputValidatorCache = new Map<string, ValidateFunction>();

/**
 * Get or create a cached validator for a schema
 */
function getValidator(
  templateId: string,
  schema: unknown,
  cache: Map<string, ValidateFunction>
): ValidateFunction {
  let validator = cache.get(templateId);
  if (!validator) {
    try {
      validator = ajv.compile(schema as object);
      cache.set(templateId, validator);
    } catch (error) {
      throw new SchemaValidationError(
        `Invalid JSON schema: ${error instanceof Error ? error.message : 'Unknown error'}`,
        []
      );
    }
  }
  return validator;
}

/**
 * Format Ajv errors for API response
 */
function formatErrors(errors: ErrorObject[] | null | undefined): unknown[] {
  if (!errors) return [];
  return errors.map((err) => ({
    path: err.instancePath || '/',
    message: err.message || 'Unknown validation error',
    keyword: err.keyword,
    params: err.params,
  }));
}

/**
 * Validate task input against template's input schema
 * @param template - The task template containing the input schema
 * @param input - The input data to validate
 * @throws SchemaValidationError if validation fails
 */
export function validateInput(
  template: TaskTemplate,
  input: unknown
): void {
  const validator = getValidator(
    `${template.id}_input`,
    template.inputSchema,
    inputValidatorCache
  );

  const valid = validator(input);
  if (!valid) {
    throw new SchemaValidationError(
      'Task input does not match template schema',
      formatErrors(validator.errors)
    );
  }
}

/**
 * Validate task output/deliverables against template's output schema
 * @param template - The task template containing the output schema
 * @param output - The output data to validate
 * @throws SchemaValidationError if validation fails
 */
export function validateOutput(
  template: TaskTemplate,
  output: unknown
): void {
  const validator = getValidator(
    `${template.id}_output`,
    template.outputSchema,
    outputValidatorCache
  );

  const valid = validator(output);
  if (!valid) {
    throw new SchemaValidationError(
      'Task output does not match template schema',
      formatErrors(validator.errors)
    );
  }
}

/**
 * Check if a JSON schema is valid
 * @param schema - The schema to validate
 * @returns true if valid, throws SchemaValidationError if invalid
 */
export function isValidJsonSchema(schema: unknown): boolean {
  try {
    ajv.compile(schema as object);
    return true;
  } catch (error) {
    throw new SchemaValidationError(
      `Invalid JSON schema: ${error instanceof Error ? error.message : 'Unknown error'}`,
      []
    );
  }
}

/**
 * Clear cached validators for a template (useful when template is updated)
 * @param templateId - The template ID to clear from cache
 */
export function clearValidatorCache(templateId: string): void {
  inputValidatorCache.delete(`${templateId}_input`);
  outputValidatorCache.delete(`${templateId}_output`);
}

/**
 * Get validation result without throwing
 * Useful for non-blocking validation checks
 */
export function validateInputSafe(
  template: TaskTemplate,
  input: unknown
): { valid: boolean; errors: unknown[] } {
  try {
    validateInput(template, input);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return {
        valid: false,
        errors: error.details?.errors as unknown[] || [],
      };
    }
    throw error;
  }
}

/**
 * Get validation result without throwing
 * Useful for non-blocking validation checks
 */
export function validateOutputSafe(
  template: TaskTemplate,
  output: unknown
): { valid: boolean; errors: unknown[] } {
  try {
    validateOutput(template, output);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof SchemaValidationError) {
      return {
        valid: false,
        errors: error.details?.errors as unknown[] || [],
      };
    }
    throw error;
  }
}
