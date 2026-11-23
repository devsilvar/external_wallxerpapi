import fs from 'node:fs';

const path = new URL('../prisma/schema.prisma', import.meta.url);
const schema = fs.readFileSync(path, 'utf8');

const anchor = 'model PlatformApiKey {';
const start = schema.indexOf(anchor);
if (start === -1) throw new Error('PlatformApiKey model not found');

const prefixLine = '  prefix String @db.VarChar(16)\n';
const at = schema.indexOf(prefixLine, start);
if (at === -1) throw new Error('prefix field not found inside PlatformApiKey');

const endOfModel = schema.indexOf('\n}', at);
if (endOfModel === -1) throw new Error('end of PlatformApiKey not found');

if (schema.slice(start, endOfModel).includes('environment ')) {
  console.log('already present');
  process.exit(0);
}

const insertAt = at + prefixLine.length;
const next = schema.slice(0, insertAt) + '  environment String @default("test") @db.VarChar(8)\n' + schema.slice(insertAt);
fs.writeFileSync(path, next);
console.log('inserted');