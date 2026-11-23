// One-off: run the spec builder (tsx) and dump the JSON so it can be audited / snapshotted.
import { writeFileSync } from 'node:fs';

const { buildOpenApiSpec } = await import('../src/openapi.ts');
const spec = buildOpenApiSpec();
writeFileSync(new URL('../openapi.tmp.json', import.meta.url), JSON.stringify(spec, null, 2));
console.log('wrote openapi.tmp.json');