export function formatDataFileName(fileName) {
  const raw = String(fileName ?? '').trim();
  if (!raw) {
    return '';
  }

  const extensionMatch = raw.match(/(\.[a-z0-9]+)$/i);
  const extension = extensionMatch ? extensionMatch[1].toLowerCase() : '';
  const withoutExtension = extension ? raw.slice(0, -extension.length) : raw;
  const withoutTimestamp = withoutExtension.replace(/^\d{14}_/, '');

  const normalized = withoutTimestamp
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return extension ? `${normalized}${extension}` : normalized;
}
