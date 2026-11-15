import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiSpec } from '../src/openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const spec = buildOpenApiSpec();
const jsonContent = JSON.stringify(spec, null, 2);

const targetDirs = [
  path.resolve(__dirname, '../docs'),
  path.resolve(__dirname, '../../docs'),
];

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const openapiPath = path.join(dir, 'openapi.json');
  const swaggerPath = path.join(dir, 'swagger.json');
  fs.writeFileSync(openapiPath, jsonContent, 'utf-8');
  fs.writeFileSync(swaggerPath, jsonContent, 'utf-8');
  console.log(`Wrote: ${openapiPath}`);
  console.log(`Wrote: ${swaggerPath}`);
}

console.log('Swagger and OpenAPI export completed successfully.');
