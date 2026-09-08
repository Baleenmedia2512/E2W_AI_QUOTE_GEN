/**
 * Split resolveNextStep.ts into finalize.ts + actions.ts; delete body.ts.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const funnelDir = path.join(__dirname, '../src/chat/funnel');
const resolvePath = path.join(funnelDir, 'resolveNextStep.ts');
const bodyPath = path.join(funnelDir, 'body.ts');

const src = fs.readFileSync(resolvePath, 'utf8');
const lines = src.split('\n');

// Find line indices (0-based) for extraction boundaries
const findLine = (pattern) => lines.findIndex((l) => pattern.test(l));

const buildRowsIdx = findLine(/^export function buildRowsForServices/);
const continueActionIdx = findLine(/^export function continueProgressiveAction\(/);
const continueLegacyIdx = findLine(/^export function continueProgressiveActionLegacy/);
const resolveNextIdx = findLine(/^export function resolveNextStep\(/);

if ([buildRowsIdx, continueActionIdx, continueLegacyIdx, resolveNextIdx].some((i) => i < 0)) {
  console.error('Could not find split boundaries', { buildRowsIdx, continueActionIdx, continueLegacyIdx, resolveNextIdx });
  process.exit(1);
}

const headerEnd = findLine(/^export function advanceFunnel/);
const header = lines.slice(0, headerEnd).join('\n');

const finalizeHeader = `/**
 * Funnel finalize — quote rows, min-qty, selection finalization.
 */
${header.replace(/Funnel resolveNextStep/g, 'Funnel finalize')}
`;

const actionsHeader = `/**
 * Funnel actions — chip / Confirm continue handlers.
 */
${header.replace(/Funnel resolveNextStep/g, 'Funnel actions')}

import { advanceFunnel } from './resolveNextStep';
import {
  buildRowsForServices,
  finalizeSelection,
  softPickTypes,
} from './finalize';
`;

// finalize: buildRows through end of finalizeSelection (before continueProgressiveAction comment)
const finalizeBody = lines.slice(buildRowsIdx, continueActionIdx - 1).join('\n');

// actions: continueProgressiveAction through continueProgressiveActionLegacy block
const actionsBody = lines.slice(continueActionIdx, resolveNextIdx).join('\n');

// resolveNextStep: keep advanceFunnel + helpers before buildRows, then resolveNextStep at end
const advanceBlock = lines.slice(headerEnd, buildRowsIdx).join('\n');
const resolveTail = lines.slice(resolveNextIdx).join('\n');

const finalizeContent = `${finalizeHeader}
${finalizeBody}
`;

const actionsContent = `${actionsHeader}
${actionsBody}
`;

const newResolveContent = `${header}
import { finalizeSelection } from './finalize';

${advanceBlock}

// Re-export helpers used by textTurn / batchResolve / index
export {
  buildRowsForServices,
  finalizeSelection,
  resolveMinQtyEdits,
  stripQtyCityDuration,
  softPickTypes,
  pickExampleServiceLabels,
  priorHasFunnelLocks,
  sameBatchServiceToken,
  priorBatchServiceTokens,
  isSameBatchEcho,
  isNewServiceSwitch,
  matchFreeTextToProgressiveOption,
} from './finalize';

${resolveTail}
`;

fs.writeFileSync(path.join(funnelDir, 'finalize.ts'), finalizeContent);
fs.writeFileSync(path.join(funnelDir, 'actions.ts'), actionsContent);
fs.writeFileSync(resolvePath, newResolveContent);

if (fs.existsSync(bodyPath)) {
  fs.unlinkSync(bodyPath);
  console.log('Deleted body.ts');
}

console.log('Split complete');
for (const f of fs.readdirSync(funnelDir).filter((x) => x.endsWith('.ts'))) {
  const n = fs.readFileSync(path.join(funnelDir, f), 'utf8').split('\n').length;
  console.log(`${n}\t${f}`);
}
