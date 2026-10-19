import { describe, expect, it } from "vitest";

import { inlineText, parseInline, safeHref } from "../src/inline.js";
import { parseResume } from "../src/markdown.js";
import { toPortableText, type TextBlock } from "../src/portable-text.js";

const SAMPLE = `# Olivia Bennett

Providence, RI | (401) 555-0132 | <olivia.bennett@example.com> | linkedin.com/in/oliviabennett

## Education

### Halden College \`Providence, RI\`

#### Bachelor of Arts in Economics, Minor in Statistics \`Sep 2022 – May 2026\`

- GPA: 3.8/4.0, Economics Department Honors Program

## Projects & Activities

### Halden Investment Club | *Vice President* \`Sep 2023 – Present\`

- Run weekly stock pitch meetings for 45 members

## Skills

**Technical:** Excel, PowerPoint, Python (pandas)
**Languages:** French (fluent), Spanish (basic)
`;

/** The page text in reading order, one entry per block. */
function blockTexts(blocks: TextBlock[]): string[] {
	return blocks.map((block) => block.children.map((span) => span.text).join(""));
}

describe("parseResume", () => {
	it("reads the shared ReadableResume Markdown line by line", () => {
		const result = parseResume(SAMPLE);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.resume.name).toBe("Olivia Bennett");
		expect(result.resume.lines).toEqual([
			{
				kind: "paragraph",
				text: "Providence, RI | (401) 555-0132 | <olivia.bennett@example.com> | linkedin.com/in/oliviabennett",
			},
			{ kind: "section", text: "Education" },
			{ kind: "entry", text: "Halden College", right: "Providence, RI" },
			{
				kind: "detail",
				text: "Bachelor of Arts in Economics, Minor in Statistics",
				right: "Sep 2022 – May 2026",
			},
			{ kind: "bullet", text: "GPA: 3.8/4.0, Economics Department Honors Program" },
			{ kind: "section", text: "Projects & Activities" },
			{ kind: "entry", text: "Halden Investment Club | *Vice President*", right: "Sep 2023 – Present" },
			{ kind: "bullet", text: "Run weekly stock pitch meetings for 45 members" },
			{ kind: "section", text: "Skills" },
			{ kind: "paragraph", text: "**Technical:** Excel, PowerPoint, Python (pandas)" },
			{ kind: "paragraph", text: "**Languages:** French (fluent), Spanish (basic)" },
		]);
	});

	it("requires the name first", () => {
		expect(parseResume("")).toMatchObject({ ok: false });
		expect(parseResume("   \n\n")).toMatchObject({ ok: false });
		expect(parseResume("Jane Doe\n## Experience")).toMatchObject({ ok: false });
		expect(parseResume("## Jane Doe")).toMatchObject({ ok: false });
		expect(parseResume("#Jane Doe")).toMatchObject({ ok: false });
		// Markdown with no text in it would leave the page without a title.
		expect(parseResume("# ****")).toMatchObject({ ok: false });
		expect(parseResume("# ``\n## Experience")).toMatchObject({ ok: false });
	});

	it("handles Windows line endings, rules, other bullet markers and stray right text", () => {
		const result = parseResume(
			"# Jane\r\n---\r\n* one\r\n+ two\r\n• three\r\n### `Remote`\r\n### Uses `code` here `2024`\r\n#####   Deep `x`\r\n-\r\n",
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.resume.lines).toEqual([
			{ kind: "bullet", text: "one" },
			{ kind: "bullet", text: "two" },
			{ kind: "bullet", text: "three" },
			{ kind: "entry", text: "", right: "Remote" },
			{ kind: "entry", text: "Uses `code` here", right: "2024" },
			{ kind: "detail", text: "Deep", right: "x" },
			{ kind: "paragraph", text: "-" },
		]);
	});

	it("keeps a line that only starts with bold text as a paragraph, not a bullet", () => {
		const result = parseResume("# Jane\n**Skills:** a\n*Italic line*");
		expect(result.ok && result.resume.lines.map((line) => line.kind)).toEqual(["paragraph", "paragraph"]);
	});
});

describe("parseInline", () => {
	it("applies bold, italic and links", () => {
		expect(parseInline("**Technical:** Excel, *SQL* and [site](https://example.com)")).toEqual([
			{ text: "Technical:", marks: ["strong"] },
			{ text: " Excel, ", marks: [] },
			{ text: "SQL", marks: ["em"] },
			{ text: " and ", marks: [] },
			{ text: "site", marks: [], href: "https://example.com/" },
		]);
	});

	it("nests italic inside bold", () => {
		expect(parseInline("**Club | *Lead***")).toEqual([
			{ text: "Club | ", marks: ["strong"] },
			{ text: "Lead", marks: ["strong", "em"] },
		]);
	});

	it("turns email and URL autolinks into links", () => {
		expect(parseInline("<jane@example.com> | <https://jane.dev>")).toEqual([
			{ text: "jane@example.com", marks: [], href: "mailto:jane@example.com" },
			{ text: " | ", marks: [] },
			{ text: "https://jane.dev", marks: [], href: "https://jane.dev/" },
		]);
	});

	it("leaves unpaired markers, inner underscores and unsafe links as text", () => {
		expect(inlineText("5 * 3 = 15")).toBe("5 * 3 = 15");
		expect(inlineText("C*-algebras")).toBe("C*-algebras");
		expect(parseInline("file_name_here")).toEqual([{ text: "file_name_here", marks: [] }]);
		expect(parseInline("[x](javascript:alert(1))")).toEqual([{ text: "[x](javascript:alert(1))", marks: [] }]);
		expect(parseInline("<not a link>")).toEqual([{ text: "<not a link>", marks: [] }]);
		expect(inlineText("2 \\* 3 and `code`")).toBe("2 * 3 and code");
	});

	it("follows the flanking rules, so a literal asterisk doesn't pair with a later one", () => {
		expect(parseInline("C*-algebras and *SQL*")).toEqual([
			{ text: "C*-algebras and ", marks: [] },
			{ text: "SQL", marks: ["em"] },
		]);
		expect(parseInline("a * b and *c*")).toEqual([
			{ text: "a * b and ", marks: [] },
			{ text: "c", marks: ["em"] },
		]);
		expect(parseInline("_lead_ and snake_case_name")).toEqual([
			{ text: "lead", marks: ["em"] },
			{ text: " and snake_case_name", marks: [] },
		]);
		// As in CommonMark (and Typora), a closing ** after punctuation needs a
		// space after it; the format guide shows "**Technical:** Excel".
		expect(inlineText("**Skills:**Excel")).toBe("**Skills:**Excel");
		expect(parseInline("**Skills:** Excel")).toEqual([
			{ text: "Skills:", marks: ["strong"] },
			{ text: " Excel", marks: [] },
		]);
	});

	it("reads link destinations with parentheses and keeps literal asterisks in labels", () => {
		expect(parseInline("[Paper](https://example.com/a_(b)) and more")).toEqual([
			{ text: "Paper", marks: [], href: "https://example.com/a_(b)" },
			{ text: " and more", marks: [] },
		]);
		expect(parseInline("[x](https://example.com/\\(y)")).toEqual([
			{ text: "x", marks: [], href: "https://example.com/(y" },
		]);
		expect(parseInline("[C*-algebras](https://example.com)")).toEqual([
			{ text: "C*-algebras", marks: [], href: "https://example.com/" },
		]);
		expect(parseInline("[a](https://example.com/b c)")).toEqual([
			{ text: "[a](https://example.com/b c)", marks: [] },
		]);
		expect(parseInline("[a]()")).toEqual([{ text: "[a]()", marks: [] }]);
	});

	it("only allows web and email links", () => {
		expect(safeHref("https://a.example")).toBe("https://a.example/");
		expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
		expect(safeHref("a@b.co")).toBe("mailto:a@b.co");
		expect(safeHref("javascript:alert(1)")).toBeUndefined();
		expect(safeHref("data:text/html,x")).toBeUndefined();
		expect(safeHref("/relative")).toBeUndefined();
	});
});

describe("toPortableText", () => {
	it("keeps the reading order and puts the right text after a bar", () => {
		const result = parseResume(SAMPLE);
		if (!result.ok) throw new Error(result.error);
		const page = toPortableText(result.resume);
		expect(page.title).toBe("Olivia Bennett");
		expect(blockTexts(page.content)).toEqual([
			"Providence, RI | (401) 555-0132 | olivia.bennett@example.com | linkedin.com/in/oliviabennett",
			"Education",
			"Halden College | Providence, RI",
			"Bachelor of Arts in Economics, Minor in Statistics | Sep 2022 – May 2026",
			"GPA: 3.8/4.0, Economics Department Honors Program",
			"Projects & Activities",
			"Halden Investment Club | Vice President | Sep 2023 – Present",
			"Run weekly stock pitch meetings for 45 members",
			"Skills",
			"Technical: Excel, PowerPoint, Python (pandas)",
			"Languages: French (fluent), Spanish (basic)",
		]);
		expect(page.content.map((block) => [block.style, block.listItem ?? null])).toEqual([
			["normal", null],
			["h2", null],
			["h3", null],
			["normal", null],
			["normal", "bullet"],
			["h2", null],
			["h3", null],
			["normal", "bullet"],
			["h2", null],
			["normal", null],
			["normal", null],
		]);
	});

	it("italicizes the whole #### line but not the bar", () => {
		const result = parseResume("# J\n#### Analyst `2024`");
		if (!result.ok) throw new Error(result.error);
		const [block] = toPortableText(result.resume).content;
		expect(block.children.map((span) => [span.text, span.marks])).toEqual([
			["Analyst", ["em"]],
			[" | ", []],
			["2024", ["em"]],
		]);
	});

	it("writes links as mark definitions with unique keys", () => {
		const result = parseResume("# J\n<a@b.co> | [Site](https://j.dev)");
		if (!result.ok) throw new Error(result.error);
		const [block] = toPortableText(result.resume).content;
		expect(block.markDefs).toEqual([
			{ _type: "link", _key: "r0l0", href: "mailto:a@b.co" },
			{ _type: "link", _key: "r0l1", href: "https://j.dev/" },
		]);
		expect(block.children.map((span) => span.marks)).toEqual([["r0l0"], [], ["r0l1"]]);
		const keys = block.children.map((span) => span._key);
		expect(new Set(keys).size).toBe(keys.length);
	});

	it("drops Markdown from the title", () => {
		const result = parseResume("# **Jane** `Doe`");
		if (!result.ok) throw new Error(result.error);
		expect(toPortableText(result.resume).title).toBe("Jane Doe");
	});

	it("gives the same JSON for the same text", () => {
		const result = parseResume(SAMPLE);
		if (!result.ok) throw new Error(result.error);
		expect(JSON.stringify(toPortableText(result.resume))).toBe(JSON.stringify(toPortableText(result.resume)));
	});
});
