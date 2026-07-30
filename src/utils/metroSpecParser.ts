/**
 * Metro train inside branding — multi-table spec parser.
 * Shared by ReferenceImages (screen preview) and PDF export.
 */

export interface PdfSpecGroup {
  heading: string | null;
  fields: Array<{ label: string; value: string }>;
  /** Multi-column table headers — metro-style specs */
  tableHeaders?: string[];
  /** Multi-column table rows — metro-style specs */
  tableRows?: string[][];
}

function mergePipeParts(parts: string[]): string[] {
  const merged: string[] = [];
  for (const p of parts) {
    const isContinuation =
      merged.length > 0 &&
      (/^\(/.test(p) || /^(wxh|w\s*x\s*h|wdh|inches|cms?|mm)\b/i.test(p) || /^\)/.test(p));
    if (isContinuation) {
      merged[merged.length - 1] = merged[merged.length - 1] + ' ' + p;
    } else {
      merged.push(p);
    }
  }
  return merged;
}

/**
 * Parses metro coach-by-coach spec text (from buildMetroSpecText or PDF extraction).
 * Returns null when the section has no coach headings.
 */
export function extractMetroMultiTableSpec(specSection: string): PdfSpecGroup[] | null {
  const lines = specSection.split('\n').map((l) => l.trim()).filter(Boolean);
  const COACH_RE = /^coach[-\s]*\d/i;
  if (!lines.some((l) => COACH_RE.test(l))) return null;

  const groups: PdfSpecGroup[] = [];
  let currentHeading: string | null = null;
  let currentHeaders: string[] = [];
  let currentRows: string[][] = [];
  let pendingLabel: string | null = null;
  let lastWasDataRow = false;
  let skipNextDataRow = false;

  const flushGroup = () => {
    if (currentRows.length > 0) {
      const maxCols = Math.max(...currentRows.map((r) => r.length));
      const headers = [...currentHeaders];
      if (headers.length > 0 && headers.length < maxCols) {
        const lastHeader = headers.pop()!;
        while (headers.length < maxCols - 1) {
          headers.push('Size (Inches)');
        }
        headers.push(lastHeader);
      }
      groups.push({
        heading: currentHeading,
        fields: [],
        tableHeaders: headers.length > 0 ? headers : undefined,
        tableRows: [...currentRows],
      });
    }
    currentHeading = null;
    currentHeaders = [];
    currentRows = [];
    pendingLabel = null;
    lastWasDataRow = false;
    skipNextDataRow = false;
  };

  for (const line of lines) {
    const parts = line.split(/\t\|\t|\s\|\s|\|/).map((p) => p.trim()).filter((p) => p.length > 0);

    if (COACH_RE.test(line)) {
      pendingLabel = null;
      lastWasDataRow = false;
      skipNextDataRow = false;
      flushGroup();
      currentHeading = line;
      continue;
    }

    if (/interior\s+train\s+dim/i.test(line) && parts.length === 1) {
      pendingLabel = null;
      lastWasDataRow = false;
      skipNextDataRow = false;
      flushGroup();
      currentHeading = line;
      continue;
    }

    if (/card\s+material\s+area/i.test(line)) {
      pendingLabel = null;
      lastWasDataRow = false;
      flushGroup();
      currentHeaders = parts.length >= 2 ? [...parts] : [line];
      currentHeading = null;
      skipNextDataRow = false;
      continue;
    }

    if (/^\s*card\s+display\s+area\s*$/i.test(line)) {
      pendingLabel = null;
      lastWasDataRow = false;
      continue;
    }

    if (skipNextDataRow && parts.length >= 2) {
      skipNextDataRow = false;
      lastWasDataRow = false;
      continue;
    }
    skipNextDataRow = false;

    const isCoachGroup = currentHeading ? COACH_RE.test(currentHeading) : false;
    if (isCoachGroup && parts.length > 0 && /^total\s+media/i.test(parts[0])) {
      pendingLabel = null;
      lastWasDataRow = false;
      continue;
    }

    if (line.length < 2) continue;

    if (
      parts.length >= 2 &&
      /^(type\s*of\s*media|material|description|item)/i.test(parts[0])
    ) {
      currentHeaders = mergePipeParts(parts);
      pendingLabel = null;
      lastWasDataRow = false;
      continue;
    }

    if (
      parts.length === 1 &&
      currentHeaders.length > 0 &&
      currentRows.length === 0 &&
      /size.+inch/i.test(line)
    ) {
      const lastHeader = currentHeaders.pop()!;
      currentHeaders.push(line, lastHeader);
      lastWasDataRow = false;
      continue;
    }

    if (parts.length >= 2) {
      let row = mergePipeParts(parts);
      if (pendingLabel !== null && row.length < 3) {
        row = [pendingLabel, ...row];
      }
      pendingLabel = null;
      if (/^total\s+media/i.test(row[0])) {
        while (row.length < 3) row = ['', ...row];
      }
      currentRows.push(row);
      lastWasDataRow = true;
      continue;
    }

    if (parts.length === 1) {
      if (lastWasDataRow && currentRows.length > 0 && !/^\d/.test(line) && !line.endsWith('-')) {
        currentRows[currentRows.length - 1][0] += ' ' + line;
        continue;
      }
      lastWasDataRow = false;
      pendingLabel = pendingLabel ? pendingLabel + ' ' + line : line;
    }
  }

  flushGroup();
  return groups.length > 0 ? groups : null;
}
