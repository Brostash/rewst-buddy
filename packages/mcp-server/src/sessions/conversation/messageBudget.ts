const MAX_CONVERSATION_MESSAGE_CHARS = 60_000;
const TRUNCATION_MARKER = '\n…(truncated to fit the Rewst message length limit)';

function truncateToBudget(text: string, max: number): string {
	if (max <= 0) return '';
	if (text.length <= max) return text;
	if (max <= TRUNCATION_MARKER.length) return text.slice(0, max);
	return text.slice(0, max - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

export function clampConversationMessage(
	message: string,
	max = MAX_CONVERSATION_MESSAGE_CHARS,
): { message: string; trimmed: number } {
	if (message.length <= max) return { message, trimmed: 0 };
	return { message: truncateToBudget(message, max), trimmed: message.length - max };
}
