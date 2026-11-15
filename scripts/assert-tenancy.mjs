/* global console, process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const TARGET_DIRS = [
  path.join(projectRoot, 'src', 'routes'),
  path.join(projectRoot, 'src', 'services'),
];

// Anti-patterns that break tenant isolation
const RULES = [
  {
    id: 'DIRECT_PRISMA_IMPORT',
    description: 'Direct import of Prisma or db/client is forbidden in routes and services. Use src/db/scoped.js instead.',
    regex: /(?:import\s+.*(?:prisma|PrismaClient).*from|from\s+['"][^'"]*(?:@prisma\/client|\/db\/client)['"])/i,
  },
  {
    id: 'READ_BODY_BUSINESS_ID',
    description: 'Reading body.businessId is forbidden. Handlers must get businessId from req.account.id only.',
    regex: /(?:body\.businessId|body\[['"]businessId['"]\])/,
  },
  {
    id: 'READ_PARAMS_ACCOUNT_ID',
    description: 'Reading req.params.accountId directly is forbidden. Use req.account.id after resolveAccount middleware.',
    regex: /(?:params\.accountId|params\[['"]accountId['"]\])/,
  },
];

function scanDirectory(dir, fileList = []) {
  if (!fs.existsSync(dir)) {
    return fileList;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath, fileList);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

let violationCount = 0;
const violations = [];

for (const targetDir of TARGET_DIRS) {
  const files = scanDirectory(targetDir);
  for (const file of files) {
    const relativePath = path.relative(projectRoot, file).replace(/\\/g, '/');
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split(/\r?\n/);

    lines.forEach((line, index) => {
      // Ignore comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
        return;
      }

      for (const rule of RULES) {
        if (rule.regex.test(line)) {
          violationCount++;
          violations.push({
            rule: rule.id,
            description: rule.description,
            file: relativePath,
            line: index + 1,
            content: trimmed,
          });
        }
      }
    });
  }
}

if (violationCount > 0) {
  console.error('\n🚨 TENANCY ASSERTION FAILED: Tenancy isolation boundary violations detected!');
  console.error(`Total violations: ${violationCount}\n`);
  for (const v of violations) {
    console.error(`[${v.rule}] ${v.file}:${v.line}`);
    console.error(`  Code:        ${v.content}`);
    console.error(`  Requirement: ${v.description}\n`);
  }
  process.exit(1);
} else {
  console.log('✅ [assert:tenancy] Tenancy boundary verified cleanly: 0 violations across routes and services.');
  process.exit(0);
}
