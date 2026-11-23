// Sample-value generation for the OpenAPI spec.
//
// The interactive console pre-fills the JSON body from `requestBody.content['application/json'].example`.
// Every request schema declares a concrete `example`, so the console can seed the editor instead of
// leaving a blank textarea that forces the integrator to guess the expected shape. Response schemas
// carry no hand-written examples (the console never renders them), so the response side is derived
// from each property's `example` / enum / format / type and any `$ref` resolved against the spec's
// own components. Generation runs once at spec-build time; the JSON payload stays plain JSON.

export type SpecForSamples = {
  components?: { schemas?: Record<string, SchemaObject> };
  paths?: Record<string, Record<string, unknown>>;
};

type Spec = SpecForSamples;

type SchemaObject = {
  type?: string;
  format?: string;
  nullable?: boolean;
  default?: unknown;
  enum?: readonly unknown[];
  example?: unknown;
  properties?: Record<string, SchemaObject>;
  items?: SchemaObject;
  required?: string[];
  $ref?: string;
};

/** Deterministic placeholder UUIDs — readable, never mistakable for a real record. */
const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000001';
const ISO_DATE_TIME = '2026-11-15T09:30:00.000Z';

/**
 * Route-aware values for path parameters whose placeholder is meaningless, or actively wrong, in
 * a pre-filled console. `renewalEpoch` is seconds, not a date, and `externalId` must not be a UUID.
 */
const PARAM_EXAMPLES: Record<string, string> = {
  accountId: 'WALLX-CUST-8812',
  customerId: 'CUST-8812',
  renewalEpoch: '1768478400',
  externalId: 'CUST-8812',
  shareToken: '9f2c7be4d1a85c0361e7f4b2a6d8c0e3',
};

function resolveRef(ref: string, spec: Spec): SchemaObject | undefined {
  const prefix = '#/components/schemas/';
  if (!ref.startsWith(prefix)) return undefined;
  return spec.components?.schemas?.[ref.slice(prefix.length)];
}

function resolve(schema: SchemaObject, spec: Spec, seen: Set<string>): SchemaObject {
  if (!schema.$ref) return schema;
  if (seen.has(schema.$ref)) return {};
  seen.add(schema.$ref);
  return resolveRef(schema.$ref, spec) ?? {};
}

function leafValue(schema: SchemaObject): unknown {
  if (schema.enum && schema.enum.length > 0) return schema.enum[0];
  switch (schema.format) {
    case 'uuid':
      return PLACEHOLDER_UUID;
    case 'date':
      return '2026-11-15';
    case 'date-time':
      return ISO_DATE_TIME;
    case 'email':
      return 'folake.adeleke@example.com';
    case 'uri':
      return 'https://cdn.example.com/receipts/receipt-001.jpg';
    default:
      break;
  }
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'integer':
    case 'number':
      return 0;
    case 'boolean':
      return false;
    default:
      return null;
  }
}

function buildValue(schema: SchemaObject, spec: Spec, seen: Set<string>): unknown {
  const resolved = resolve(schema, spec, seen);

  if (resolved.example !== undefined) return resolved.example;
  if (resolved.default !== undefined) return resolved.default;

  if (resolved.type === 'array') {
    return resolved.items ? [buildValue(resolved.items, spec, seen)] : [];
  }

  if (resolved.properties) {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(resolved.properties)) {
      out[key] = buildValue(child, spec, seen);
    }
    return out;
  }

  if (resolved.enum && resolved.enum.length > 0) return resolved.enum[0];

  return leafValue(resolved);
}

function withoutKey(data: unknown, key: string): unknown {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return data;
  return Object.fromEntries(Object.entries(data as Record<string, unknown>).filter(([k]) => k !== key));
}

/**
 * Fills in `example` on every request-body schema across the spec.
 * - If the body's merged sample contains `requestId` (the error envelope shape), re-shapes it as a
 *   success envelope so the console never pre-fills a rejection body.
 * - DELETE endpoints with an optional body get `data: null` instead of the full entity, because
 *   those routes answer with a tombstone, not the deleted record.
 */
export function attachRequestExamples(spec: Spec): void {
  const paths = spec.paths ?? {};

  for (const [, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem) as Array<[string, any]>) {
      if (!operation || typeof operation !== 'object') continue;
      const media = operation.requestBody?.content?.['application/json'];
      if (!media?.schema) continue;
      if (media.example !== undefined) continue;

      let example = buildValue(media.schema, spec, new Set());

      if (example && typeof example === 'object' && 'requestId' in (example as object)) {
        example = { data: { ok: true } };
      } else if (method === 'delete') {
        example = withoutKey(example, 'referenceId');
      }

      media.example = example;
    }
  }
}

/**
 * Fills in `example` on every response media type that lacks one, plus path- and query-parameter
 * examples so the console can prefill `{accountId}` with a usable value.
 */
export function attachResponseAndParameterExamples(spec: Spec): void {
  const paths = spec.paths ?? {};

  for (const [, pathItem] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(pathItem) as Array<[string, any]>) {
      if (!operation || typeof operation !== 'object') continue;

      if (method !== 'parameters' && Array.isArray(operation.parameters)) {
        for (const param of operation.parameters) {
          if (!param?.schema || param.example !== undefined || param.schema.example !== undefined) continue;
          const value = PARAM_EXAMPLES[param.name] ?? buildValue(param.schema, spec, new Set());
          if (value !== null && value !== 'string') param.example = value;
        }
      }

      const responses = operation.responses ?? {};
      for (const response of Object.values(responses) as any[]) {
        const media = response?.content?.['application/json'];
        if (!media?.schema || media.example !== undefined) continue;
        media.example = buildValue(media.schema, spec, new Set());
      }
    }
  }
}