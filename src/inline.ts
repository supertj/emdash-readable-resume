/**
 * Inline Markdown for resume lines: **bold**, *italic* or _italic_,
 * [text](https://...), <https://...> and <name@example.com>. Backticks are
 * dropped, and a backslash keeps the next character literal.
 *
 * A delimiter without a partner stays as plain text, so a stray asterisk in
 * "C*-algebras" or "5 * 3" never swallows the rest of the line.
 */

export type Mark = "strong" | "em";

export interface InlineRun {
	text: string;
	marks: Mark[];
	href?: string;
}

type Token =
	| { type: "text"; text: string }
	| { type: "delim"; mark: Mark; raw: string; partner?: number }
	| { type: "link"; label: string; href: string };

const LINK_LABEL = /^\[([^\]]+)\]\(/;
const AUTOLINK = /^<([^<>\s]+)>/;
// No colon or slash, so "mailto:a@b.co" and URLs with an @ in the path go through URL parsing instead.
const EMAIL = /^[^@\s<>():/]+@[^@\s<>():/]+\.[a-z]{2,}$/i;

/** Only web and email links survive; anything else is shown as plain text. */
export function safeHref(raw: string): string | undefined {
	if (EMAIL.test(raw)) return `mailto:${raw}`;
	try {
		const url = new URL(raw);
		if (url.protocol === "https:" || url.protocol === "http:" || url.protocol === "mailto:") {
			return url.href;
		}
	} catch {
		// Not an absolute URL.
	}
	return undefined;
}

/**
 * Reads [label](destination) at the start of `source`. The destination may
 * contain balanced or backslash-escaped parentheses, as in
 * https://example.com/wiki/Mercury_(planet), and no spaces.
 */
function readLink(source: string): { label: string; destination: string; length: number } | undefined {
	const label = LINK_LABEL.exec(source);
	if (!label) return undefined;
	let depth = 0;
	let destination = "";
	for (let index = label[0].length; index < source.length; index++) {
		const char = source[index];
		if (char === "\\" && (source[index + 1] === "(" || source[index + 1] === ")")) {
			destination += source[index + 1];
			index++;
		} else if (/\s/.test(char)) {
			return undefined;
		} else if (char === "(") {
			depth++;
			destination += char;
		} else if (char === ")") {
			if (depth === 0) {
				return destination ? { label: label[1], destination, length: index + 1 } : undefined;
			}
			depth--;
			destination += char;
		} else {
			destination += char;
		}
	}
	return undefined;
}

function isWordChar(char: string | undefined): boolean {
	return char !== undefined && /[\p{L}\p{N}]/u.test(char);
}

function tokenize(source: string): Token[] {
	const tokens: Token[] = [];
	let buffer = "";
	const flush = () => {
		if (buffer) tokens.push({ type: "text", text: buffer });
		buffer = "";
	};

	for (let index = 0; index < source.length; ) {
		const char = source[index];
		const rest = source.slice(index);

		if (char === "\\" && index + 1 < source.length) {
			buffer += source[index + 1];
			index += 2;
			continue;
		}
		if (char === "`") {
			index += 1;
			continue;
		}
		if (char === "[") {
			const link = readLink(rest);
			const href = link && safeHref(link.destination);
			if (link && href) {
				flush();
				tokens.push({ type: "link", label: link.label, href });
				index += link.length;
				continue;
			}
		}
		if (char === "<") {
			const auto = AUTOLINK.exec(rest);
			const href = auto && safeHref(auto[1]);
			if (auto && href) {
				flush();
				tokens.push({ type: "link", label: auto[1], href });
				index += auto[0].length;
				continue;
			}
		}
		if (rest.startsWith("**")) {
			flush();
			tokens.push({ type: "delim", mark: "strong", raw: "**" });
			index += 2;
			continue;
		}
		if (char === "*" || (char === "_" && !(isWordChar(source[index - 1]) && isWordChar(source[index + 1])))) {
			// An underscore inside a word (snake_case, file_name) is text, as in CommonMark.
			flush();
			tokens.push({ type: "delim", mark: "em", raw: char });
			index += 1;
			continue;
		}
		buffer += char;
		index += 1;
	}
	flush();
	return tokens;
}

/** Pairs each opening delimiter with the next one of the same kind. */
function pairDelimiters(tokens: Token[]): void {
	const open = new Map<string, number>();
	tokens.forEach((token, index) => {
		if (token.type !== "delim") return;
		const opener = open.get(token.raw);
		if (opener === undefined) {
			open.set(token.raw, index);
			return;
		}
		(tokens[opener] as Extract<Token, { type: "delim" }>).partner = index;
		token.partner = opener;
		open.delete(token.raw);
	});
}

export function parseInline(source: string): InlineRun[] {
	const tokens = tokenize(source);
	pairDelimiters(tokens);

	const runs: InlineRun[] = [];
	const active: Mark[] = [];
	const push = (text: string, href?: string) => {
		if (!text) return;
		const marks = [...new Set(active)];
		const last = runs.at(-1);
		if (last && !href && !last.href && sameMarks(last.marks, marks)) {
			last.text += text;
			return;
		}
		runs.push(href ? { text, marks, href } : { text, marks });
	};

	tokens.forEach((token, index) => {
		if (token.type === "text") {
			push(token.text);
		} else if (token.type === "link") {
			// Bold or italic inside link text is rare on a resume, so the link
			// keeps only the label's text, read with the same delimiter rules.
			push(inlineText(token.label), token.href);
		} else if (token.partner === undefined) {
			push(token.raw);
		} else if (token.partner > index) {
			active.push(token.mark);
		} else {
			const position = active.lastIndexOf(token.mark);
			if (position !== -1) active.splice(position, 1);
		}
	});
	return runs;
}

function sameMarks(a: Mark[], b: Mark[]): boolean {
	return a.length === b.length && a.every((mark) => b.includes(mark));
}

/** Plain text of a line, for the page title and messages. */
export function inlineText(source: string): string {
	return parseInline(source)
		.map((run) => run.text)
		.join("");
}
