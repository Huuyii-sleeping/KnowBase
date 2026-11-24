import type { UpgradeItem, UpgradeSummary } from './index-upgrades-api';
export async function upgradeExportParts(
  summary: UpgradeSummary,
  loadPage: (after?: string) => Promise<UpgradeItem[]>,
): Promise<BlobPart[]> {
  const parts: BlobPart[] = [JSON.stringify({ summary }) + '\n'];
  let after: string | undefined;
  for (;;) {
    const page = await loadPage(after);
    parts.push(...page.map((item) => JSON.stringify(item) + '\n'));
    if (page.length < 50) break;
    after = page.at(-1)!.id;
  }
  return parts;
}
export async function downloadUpgradeList(
  summary: UpgradeSummary,
  loadPage: (after?: string) => Promise<UpgradeItem[]>,
) {
  const parts = await upgradeExportParts(summary, loadPage);
  const url = URL.createObjectURL(
    new Blob(parts, { type: 'application/x-ndjson' }),
  );
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `index-upgrade-${summary.plan.id}.jsonl`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
