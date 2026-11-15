import fs from 'node:fs';
import path from 'node:path';
import {
  provisionAccounts,
  type CsvAccountRow,
  type ProvisionResult,
} from '../db/provision.repo.js';

export {
  provisionAccounts,
  type CsvAccountRow,
  type ProvisionResult,
};

/**
 * Parses CSV content handling quoted fields, commas inside quotes, and CRLF/LF line endings.
 */
export function parseCsv(content: string): CsvAccountRow[] {
  const lines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentLine += char;
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && content[i + 1] === '\n') {
        i++;
      }
      if (currentLine.trim().length > 0) {
        lines.push(currentLine);
      }
      currentLine = '';
    } else {
      currentLine += char;
    }
  }
  if (currentLine.trim().length > 0) {
    lines.push(currentLine);
  }

  const headerLine = lines[0];
  if (!headerLine || lines.length < 2) {
    return [];
  }

  const parseRow = (line: string): string[] => {
    const fields: string[] = [];
    let field = '';
    let inside = false;

    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inside && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inside = !inside;
        }
      } else if (c === ',' && !inside) {
        fields.push(field.trim());
        field = '';
      } else {
        field += c;
      }
    }
    fields.push(field.trim());
    return fields;
  };

  const headers = parseRow(headerLine).map((h) => h.trim().toLowerCase());
  const rows: CsvAccountRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = parseRow(line);
    const rowMap: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rowMap[h] = values[idx] ?? '';
    });

    const externalCustomerId =
      rowMap['externalcustomerid'] || rowMap['external_customer_id'] || '';
    const businessName = rowMap['businessname'] || rowMap['business_name'] || '';
    const ownerName = rowMap['ownername'] || rowMap['owner_name'] || '';

    if (!externalCustomerId || !businessName || !ownerName) {
      continue;
    }

    rows.push({
      externalCustomerId,
      businessName,
      ownerName,
      phone: rowMap['phone'] || undefined,
      email: rowMap['email'] || undefined,
      address: rowMap['address'] || undefined,
      city: rowMap['city'] || undefined,
      state: rowMap['state'] || undefined,
    });
  }

  return rows;
}

// CLI entrypoint
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const fileIndex = args.indexOf('--file');
  const platformIndex = args.indexOf('--platform');

  if (fileIndex === -1 || platformIndex === -1) {
    console.error(
      'Usage: tsx src/cli/provision.ts --file <path/to/accounts.csv> --platform <platform-id>'
    );
    process.exit(1);
  }

  const filePath = args[fileIndex + 1];
  const platformId = args[platformIndex + 1];

  if (!filePath || !platformId) {
    console.error('Error: both --file and --platform arguments require a value');
    process.exit(1);
  }

  const resolvedPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: file not found: ${resolvedPath}`);
    process.exit(1);
  }

  const csvContent = fs.readFileSync(resolvedPath, 'utf8');
  const rows = parseCsv(csvContent);

  if (rows.length === 0) {
    console.error('Error: CSV file contains 0 valid account rows');
    process.exit(1);
  }

  console.log(`Parsed ${rows.length} valid accounts from CSV. Provisioning...`);
  const result = await provisionAccounts(rows, platformId);

  console.log('--- Provisioning Summary ---');
  console.log(`Total:   ${result.total}`);
  console.log(`Created: ${result.created}`);
  console.log(`Skipped: ${result.skipped}`);
  if (result.errors.length > 0) {
    console.error(`Errors:  ${result.errors.length}`);
    result.errors.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }

  console.log('Provisioning completed successfully.');
}

// Run CLI if invoked directly
if (process.argv[1]?.endsWith('provision.ts') || process.argv[1]?.endsWith('provision.js')) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
