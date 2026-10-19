/**
 * Reads a resume written in the small Markdown dialect shared by the
 * ReadableResume ports (the Typora theme uses the same one):
 *
 *   # Name
 *   City, ST | (555) 555-0100 | <you@example.com>
 *   ## Section
 *   ### Company or school `Place`
 *   #### Role or degree `Dates`
 *   - Bullet
 *   **Label:** text
 *
 * Text in backticks at the end of a ### or #### line is the part a printed
 * resume puts on the right margin.
 *
 * Every non-empty line is its own paragraph. The resume is typed into a text
 * box, not wrapped by an editor, so joining lines the way Markdown does would
 * merge a skills list into one run-on line.
 */

export type ResumeLine =
	| { kind: "section"; text: string }
	| { kind: "entry"; text: string; right: string }
	| { kind: "detail"; text: string; right: string }
	| { kind: "bullet"; text: string }
	| { kind: "paragraph"; text: string };

export interface Resume {
	/** The # line as typed, inline Markdown included. */
	name: string;
	lines: ResumeLine[];
}

export type ParseResult = { ok: true; resume: Resume } | { ok: false; error: string };

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^[-*+•]\s+(.*)$/;
// A thematic break (---, ***, ___) has no place in a one-column resume.
const RULE = /^([-*_])(\s*\1){2,}$/;
// The last backtick span on the line, if nothing but spaces follows it.
const RIGHT_TEXT = /^(.*?)\s*`([^`]*)`$/;

/** Splits off the trailing `right text`. Lines without one keep everything on the left. */
function splitRight(text: string): { text: string; right: string } {
	const match = RIGHT_TEXT.exec(text);
	if (!match) return { text, right: "" };
	return { text: match[1].trim(), right: match[2].trim() };
}

export function parseResume(source: string): ParseResult {
	const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
	let name = "";
	const lines: ResumeLine[] = [];

	for (const raw of rawLines) {
		const line = raw.trim();
		if (!line || RULE.test(line)) continue;

		const heading = HEADING.exec(line);
		if (!name) {
			// The name has to come first: it becomes the page title, and every
			// layout in ReadableResume opens with it.
			if (!heading || heading[1].length !== 1 || !heading[2].trim()) {
				return {
					ok: false,
					error: "Start with your name on the first line, after a # and a space, like: # Jane Doe",
				};
			}
			name = heading[2].trim();
			continue;
		}

		if (heading) {
			const level = heading[1].length;
			const content = heading[2].trim();
			if (!content) continue;
			if (level <= 2) {
				lines.push({ kind: "section", text: content });
			} else if (level === 3) {
				lines.push({ kind: "entry", ...splitRight(content) });
			} else {
				lines.push({ kind: "detail", ...splitRight(content) });
			}
			continue;
		}

		const bullet = BULLET.exec(line);
		if (bullet) {
			if (bullet[1].trim()) lines.push({ kind: "bullet", text: bullet[1].trim() });
			continue;
		}

		lines.push({ kind: "paragraph", text: line });
	}

	if (!name) {
		return { ok: false, error: "The resume is empty. Start with your name, like: # Jane Doe" };
	}
	return { ok: true, resume: { name, lines } };
}
