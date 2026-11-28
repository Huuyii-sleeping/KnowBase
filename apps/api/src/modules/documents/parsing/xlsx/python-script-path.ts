import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
/** Resolve packaged resources for compiled and source layouts without depending on shell cwd. */
export function xlsScript(name: string): string {
  const paths = [
    resolve(__dirname, '../../../../../../scripts/xls', name),
    resolve(__dirname, '../../../../../scripts/xls', name),
  ];
  const found = paths.find(existsSync);
  if (!found)
    throw new Error(
      'XLS extraction scripts are missing from the application package',
    );
  return found;
}
