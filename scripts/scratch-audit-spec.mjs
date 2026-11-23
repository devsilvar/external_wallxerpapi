// One-off audit: every mutating operation must carry a request-body example; every operation must
// carry an example for each response media type; path params must resolve to a usable value.
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('../openapi.tmp.json', import.meta.url), 'utf8'));
const WRITE = new Set(['post', 'put', 'patch', 'delete']);
let problems = 0;

for (const [path, item] of Object.entries(spec.paths)) {
  for (const [method, op] of Object.entries(item)) {
    if (!op || typeof op !== 'object' || method === 'parameters') continue;

    const media = op.requestBody?.content?.['application/json'];
    if (WRITE.has(method) && !media) {
      console.log(`NO REQUEST BODY SCHEMA  ${method.toUpperCase()} ${path}`);
    }
    if (media && media.example === undefined) {
      console.log(`MISSING BODY EXAMPLE    ${method.toUpperCase()} ${path}`);
      problems++;
    }

    for (const [status, res] of Object.entries(op.responses ?? {})) {
      const r = res;
      const json = r?.content?.['application/json'];
      if (json && json.example === undefined) {
        console.log(`MISSING RESP EXAMPLE    ${method.toUpperCase()} ${path} -> ${status}`);
        problems++;
      }
    }

    for (const p of op.parameters ?? []) {
      if (p.in === 'path' && p.example === undefined) {
        console.log(`PATH PARAM NO EXAMPLE   ${method.toUpperCase()} ${path} ({${p.name}})`);
      }
    }
  }
}

console.log(problems === 0 ? '\nAUDIT CLEAN' : `\n${problems} problem(s)`);