/**
 * Caps on every free-text box in the app.
 *
 * Two numbers per field, not one. Words are what a person is actually
 * writing and so what the counter shows them, but a word count alone caps
 * nothing -- one "word" can be a megabyte of pasted base64 -- so each limit
 * carries a character ceiling as the real backstop. Whichever is hit first
 * wins.
 *
 * The composer's limit is the loose one on purpose: §4.1's whole pitch is
 * pasting a class schedule or a whole email in unedited, and a cap that
 * clipped a term's timetable would break the main path. It's here to stop a
 * runaway paste reaching the extraction model, not to make people edit.
 */
export const TEXT_LIMITS = {
  /** The composer -- a pasted syllabus or forwarded email arrives here whole. */
  capture: { words: 1200, chars: 12000 },
  /** Event title. */
  title: { words: 40, chars: 300 },
  /** Location, and the answer to a "where is this?" question. */
  location: { words: 40, chars: 300 },
  /** Event notes/description. */
  description: { words: 400, chars: 4000 },
} as const;

export type TextLimit = { words: number; chars: number };

/**
 * Whitespace-separated runs. Deliberately not locale-aware word
 * segmentation: this feeds a "you're near the limit" counter, and a count
 * that matches what the user can see themselves matters more here than one
 * that's linguistically correct for scripts that don't space their words.
 */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Truncates to the limit, preferring to cut on a word boundary.
 *
 * Returns the input unchanged when it already fits, so a controlled input
 * doesn't get a new string identity on every keystroke.
 */
export function clampText(text: string, limit: TextLimit): string {
  let result = text;

  if (countWords(result) > limit.words) {
    // Leading whitespace has to survive the split, or typing a space after
    // the last allowed word would delete it.
    const words = result.split(/(\s+)/);
    let kept = "";
    let count = 0;
    for (const part of words) {
      if (/\S/.test(part)) {
        if (count === limit.words) break;
        count += 1;
      }
      kept += part;
    }
    result = kept;
  }

  if (result.length > limit.chars) result = result.slice(0, limit.chars);
  return result;
}

/** True once the user is close enough that the counter is worth showing. */
export function isNearLimit(text: string, limit: TextLimit): boolean {
  return countWords(text) >= limit.words * 0.8 || text.length >= limit.chars * 0.8;
}
