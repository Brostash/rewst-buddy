/**
 * Character budgets for the single `message` string sent to Rewst's
 * conversation API. The backend rejects a message longer than
 * {@link MAX_CONVERSATION_MESSAGE_CHARS} outright ("Message exceeds the maximum
 * length of 60000 characters."), which fails the whole turn — so every part the
 * extension assembles into a turn (tool manifest, visible transcript, tool
 * results) is budgeted here rather than sent and hoped for.
 *
 * The budgets are deliberately conservative: the target leaves headroom for the
 * pieces that cannot be trimmed (the transport directive, the user's standing
 * instructions), and the hard clamp at the wire is the last line of defense.
 */

/** Hard backend limit on one conversation message. */
export const MAX_CONVERSATION_MESSAGE_CHARS = 60_000;

/** What the assembled turn message aims for, leaving headroom under the cap. */
export const TURN_MESSAGE_TARGET_CHARS = 52_000;

/**
 * Budget for the tool manifest. Rendering every advertised tool with its full
 * description and JSON schema costs far more than this (the Buddy registry alone
 * is ~73k chars), so the manifest degrades to a catalog of summaries plus an
 * on-demand details lookup — see `ui/chat/tools/toolCatalog.ts`.
 */
export const TOOL_INSTRUCTIONS_BUDGET_CHARS = 20_000;

/** Budget for one round of tool outputs fed back into the conversation. */
export const TOOL_RESULTS_BUDGET_CHARS = 24_000;

/** Floor for the visible transcript, however large the fixed parts are. */
export const MIN_TRANSCRIPT_CHARS = 4_000;

export const TRUNCATION_MARKER = '\n…(truncated to fit the Rewst message length limit)';

/**
 * Truncates `text` to `max` characters, marking the cut so the assistant reads
 * the tail as missing rather than as the end of the content. A `max` at or below
 * the marker's own length yields a bare hard slice.
 */
export function truncateToBudget(text: string, max: number): string {
	if (max <= 0) return '';
	if (text.length <= max) return text;
	if (max <= TRUNCATION_MARKER.length) return text.slice(0, max);
	return text.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/**
 * How many characters the visible transcript may use once the parts that cannot
 * be trimmed (directive, tool manifest, reminders, standing instructions) are
 * accounted for. Never returns less than {@link MIN_TRANSCRIPT_CHARS}: a turn
 * with no transcript at all is useless, and the wire clamp still protects the
 * cap in that pathological case.
 */
export function transcriptBudget(fixedChars: number, target = TURN_MESSAGE_TARGET_CHARS): number {
	return Math.max(MIN_TRANSCRIPT_CHARS, target - fixedChars);
}

/**
 * Strictly partitions a budget across `count` sections: `count` times the
 * returned allowance never exceeds `total`, so a caller that gives every section
 * its allowance stays within budget however many sections there are.
 *
 * There is deliberately no minimum allowance. A floor large enough to be useful
 * is a floor that overspends once the sections outnumber it, and a section can
 * always be reported with a truncation marker instead of being dropped.
 */
export function perSectionBudget(total: number, count: number): number {
	if (count <= 0) return total;
	return Math.max(0, Math.floor(total / count));
}

/**
 * Last-defense clamp applied at the wire: guarantees the backend never sees a
 * message over its hard cap regardless of which path assembled it.
 */
export function clampConversationMessage(
	message: string,
	max = MAX_CONVERSATION_MESSAGE_CHARS,
): { message: string; trimmed: number } {
	if (message.length <= max) return { message, trimmed: 0 };
	return { message: truncateToBudget(message, max), trimmed: message.length - max };
}
