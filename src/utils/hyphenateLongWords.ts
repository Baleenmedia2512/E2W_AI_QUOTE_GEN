/** Max characters per unbroken word in SERVICE & LOCATION before hyphen wrap (PDF only). */
export const LONG_WORD_BREAK_LEN = 13;

/**
 * Break a single word into ≤maxLen chunks with hyphens at the break:
 *   periyanayakanpalayam → "periyanayakan-\n-palayam"
 */
export function hyphenateLongWord(word: string, maxLen = LONG_WORD_BREAK_LEN): string {
  if (!word || word.length <= maxLen) return word;

  const chunks: string[] = [];
  for (let i = 0; i < word.length; i += maxLen) {
    chunks.push(word.slice(i, i + maxLen));
  }

  return chunks
    .map((chunk, i) => {
      const isFirst = i === 0;
      const isLast = i === chunks.length - 1;
      if (isFirst && isLast) return chunk;
      if (isFirst) return `${chunk}-`;
      if (isLast) return `-${chunk}`;
      return `-${chunk}-`;
    })
    .join('\n');
}

/**
 * Hyphen-wrap any run of non-space / non-hyphen characters longer than maxLen.
 * Existing spaces and hyphens are preserved as word boundaries (so kebab segments
 * like "branding" stay intact).
 */
export function hyphenateLongWords(text: string, maxLen = LONG_WORD_BREAK_LEN): string {
  if (!text) return text;
  return text.replace(/[^\s-]+/g, (word) => hyphenateLongWord(word, maxLen));
}
