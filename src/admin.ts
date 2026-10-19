import type { Block, BlockResponse } from "@emdash-cms/blocks";

/** What the form starts with before anything is saved: the shape of a resume, not a sample person. */
export const STARTER_RESUME = `# Your Name

City, ST | (555) 555-0100 | <you@example.com> | linkedin.com/in/yourname

## Experience

### Company Name \`City, ST\`

#### Job Title \`Jun 2024 – Present\`

- What you did, with a number if you have one
- One line per bullet

## Education

### School Name \`City, ST\`

#### Degree \`Sep 2020 – May 2024\`

## Skills

**Technical:** Excel, SQL
**Languages:** Spanish (fluent)
`;

export interface PageStatus {
	id: string;
	published: boolean;
	hasUnpublishedChanges: boolean;
	publicUrl?: string;
}

const FORMAT_GUIDE = [
	{ syntax: "# Your Name", result: "The page title. It has to be the first line." },
	{ syntax: "City, ST | <you@example.com>", result: "Your contact line, right under the title." },
	{ syntax: "## Experience", result: "A section heading." },
	{ syntax: "### Company `City, ST`", result: "A subheading, then a bar and the text in backticks." },
	{ syntax: "#### Job Title `Dates`", result: "An italic line, then a bar and the dates." },
	{ syntax: "- Did something", result: "A bullet point." },
	{ syntax: "**Technical:** Excel, SQL", result: "A line that starts with a bold label." },
	{ syntax: "*italic*  [text](https://...)", result: "Italic text and a link." },
];

function pageSummary(page: PageStatus | undefined): Block[] {
	if (!page) {
		return [
			{
				type: "section",
				text: "Write your resume in the box and save it. The first save creates a draft page in Pages, titled with your name.",
			},
		];
	}

	// No page title here: after the first publish, saves are staged as draft
	// revisions, so the title on the page row can lag behind the last save.
	const text = !page.published
		? "Your resume page is saved as a draft. Open it and publish it when you're ready."
		: page.hasUnpublishedChanges
			? "Your resume page is live, and your latest save is waiting as a draft. Open the page and publish it to update the live version."
			: "Your resume page is live on your site.";

	return [
		{ type: "section", text },
		{
			type: "actions",
			elements: [
				{
					type: "link",
					label: "Open the page",
					target: { kind: "content", collection: "pages", id: page.id },
					appearance: "secondary",
				},
				...(page.publicUrl
					? [
							{
								type: "link" as const,
								label: "View it on your site",
								target: { kind: "external" as const, url: page.publicUrl },
								appearance: "inline" as const,
							},
						]
					: []),
			],
		},
	];
}

export function renderAdminPage(options: {
	resume: string;
	page: PageStatus | undefined;
	error?: string;
}): BlockResponse {
	const blocks: Block[] = [{ type: "header", text: "Resume" }];

	if (options.error) {
		blocks.push({
			type: "banner",
			variant: "error",
			title: "The page wasn't updated",
			description: options.error,
		});
	}

	blocks.push(...pageSummary(options.page));

	blocks.push({
		type: "form",
		block_id: "resume",
		fields: [
			{
				type: "text_input",
				action_id: "resume",
				label: "Your resume",
				multiline: true,
				initial_value: options.resume,
			},
		],
		submit: { label: "Save", action_id: "save" },
	});

	blocks.push({
		type: "context",
		text: "Drag the corner of the box to make it taller. Each save replaces the page's title and content, so edit your resume here, not in the page editor. The page uses your theme's fonts and styles.",
	});

	blocks.push({
		type: "accordion",
		label: "How to write it",
		blocks: [
			{
				type: "table",
				page_action_id: "format_guide",
				columns: [
					{ key: "syntax", label: "You type", format: "code" },
					{ key: "result", label: "On the page" },
				],
				rows: FORMAT_GUIDE,
			},
			{
				type: "context",
				text: "Every line becomes its own paragraph, so press Enter between skills lines.",
			},
		],
	});

	return { blocks };
}
