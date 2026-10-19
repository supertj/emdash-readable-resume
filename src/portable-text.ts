import { inlineText, parseInline, type Mark } from "./inline.js";
import type { Resume, ResumeLine } from "./markdown.js";

interface Span {
	_type: "span";
	_key: string;
	text: string;
	marks: string[];
}

interface LinkDef {
	_type: "link";
	_key: string;
	href: string;
}

export interface TextBlock {
	_type: "block";
	_key: string;
	style: "normal" | "h2" | "h3";
	markDefs: LinkDef[];
	children: Span[];
	listItem?: "bullet";
	level?: number;
}

export interface ResumePage {
	title: string;
	content: TextBlock[];
}

/**
 * Builds a text block. Keys only need to be unique inside the document, so
 * they come from the line's position: the same resume always produces the
 * same JSON.
 */
function textBlock(
	key: string,
	style: TextBlock["style"],
	parts: Array<{ markdown: string; extraMarks?: Mark[] }>,
	bullet = false,
): TextBlock {
	const markDefs: LinkDef[] = [];
	const children: Span[] = [];
	for (const part of parts) {
		for (const run of parseInline(part.markdown)) {
			const marks: string[] = [...new Set([...run.marks, ...(part.extraMarks ?? [])])];
			if (run.href) {
				const linkKey = `${key}l${markDefs.length}`;
				markDefs.push({ _type: "link", _key: linkKey, href: run.href });
				marks.push(linkKey);
			}
			children.push({ _type: "span", _key: `${key}s${children.length}`, text: run.text, marks });
		}
	}
	if (children.length === 0) {
		children.push({ _type: "span", _key: `${key}s0`, text: "", marks: [] });
	}
	const block: TextBlock = { _type: "block", _key: key, style, markDefs, children };
	if (bullet) {
		block.listItem = "bullet";
		block.level = 1;
	}
	return block;
}

/**
 * A ### line becomes a subheading and a #### line an italic paragraph, with
 * the backtick text after a bar on the same line.
 *
 * The printed layout puts that text on the right margin. A sandboxed plugin
 * can't add CSS to the site, and the two layout tools Portable Text offers
 * both fall short: the core columns block splits the line into equal halves
 * without right alignment, and it shows up in the page editor as an opaque
 * box. One line with a bar keeps the reading order and copies cleanly, and
 * the bar is the separator the contact line already uses.
 */
function entryLine(key: string, line: Extract<ResumeLine, { kind: "entry" | "detail" }>): TextBlock {
	const style = line.kind === "entry" ? "h3" : "normal";
	const marks: Mark[] = line.kind === "detail" ? ["em"] : [];
	const parts = [line.text, line.right]
		.filter(Boolean)
		.flatMap((markdown, index) => [
			...(index > 0 ? [{ markdown: " | " }] : []),
			{ markdown, extraMarks: marks },
		]);
	return textBlock(key, style, parts);
}

export function toPortableText(resume: Resume): ResumePage {
	const content = resume.lines.map((line, index): TextBlock => {
		const key = `r${index}`;
		switch (line.kind) {
			case "section":
				return textBlock(key, "h2", [{ markdown: line.text }]);
			case "entry":
			case "detail":
				return entryLine(key, line);
			case "bullet":
				return textBlock(key, "normal", [{ markdown: line.text }], true);
			case "paragraph":
				return textBlock(key, "normal", [{ markdown: line.text }]);
		}
	});
	return { title: inlineText(resume.name), content };
}
