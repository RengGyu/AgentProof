// Client-safe schema validation; no source compiler, repository or provider imports.
import Ajv from 'ajv';
import { containsSecretPattern } from './redact';
export const str = { type: 'string', maxLength: 600, minLength: 1 };
export const strings = (max = 32) => ({ type: 'array', items: str, maxItems: max, uniqueItems: true });
export const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
export const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const array = (items: unknown, maxItems: number) => ({ type: 'array', items, maxItems });
const ajv = new Ajv({ allErrors: false });
export function contract<T>(schema: object) { const validate = ajv.compile(schema); return (value: unknown): value is T => Boolean(validate(value)) && !containsSecretPattern(JSON.stringify(value)); }
