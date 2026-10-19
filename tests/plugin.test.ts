import { afterEach, describe, expect, it } from "vitest";

import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";

let host: PluginRuntimeTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

const RESUME = `# Olivia Bennett

Providence, RI | <olivia.bennett@example.com>

## Experience

### Harlan Quay Capital Partners \`New York, NY\`

#### Investment Banking Analyst Intern \`Jun 2025 – Aug 2025\`

- Built three-statement models for two consumer retail clients
`;


/** Same collection shape as the Blog, Starter and Portfolio templates. */
async function createHost(withPages = true, revisions = true) {
	const runtime = await createPluginRuntimeTestHost();
	if (withPages) {
		await runtime.fixtures.collection({
			slug: "pages",
			label: "Pages",
			supports: revisions ? ["drafts", "revisions"] : ["drafts"],
			urlPattern: "/{slug}",
			fields: [
				{ slug: "title", label: "Title", type: "string", required: true },
				{ slug: "content", label: "Content", type: "portableText" },
			],
		});
	}
	const admin = await runtime.fixtures.user({ email: "owner@example.com", role: "admin" });
	return { runtime, admin };
}

function find<T = Record<string, unknown>>(blocks: unknown, type: string): T[] {
	return (blocks as Array<{ type: string }>).filter((block) => block.type === type) as unknown as T[];
}

function formValue(blocks: unknown): string {
	const [form] = find<{ fields: Array<{ initial_value?: string }> }>(blocks, "form");
	return form.fields[0].initial_value ?? "";
}

function texts(content: unknown): string[] {
	return (content as Array<{ children: Array<{ text: string }> }>).map((block) =>
		block.children.map((span) => span.text).join(""),
	);
}

describe("resume admin page", () => {
	it("starts with a template and no page", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;
		const response = await runtime.admin.loadPage("/resume", { user: admin });
		expect(formValue(response.blocks)).toContain("# Your Name");
		expect(find(response.blocks, "actions")).toHaveLength(0);
		await expect(runtime.inspect.content.list("pages")).resolves.toHaveLength(0);
	});

	it("creates one draft page on the first save and updates it after that", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;

		const first = await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		expect(first.toast).toMatchObject({ type: "success" });
		const pages = await runtime.inspect.content.list("pages");
		expect(pages).toHaveLength(1);
		const [page] = pages;
		expect(page.status).toBe("draft");
		expect(page.slug).toBe("olivia-bennett");
		expect(page.data.title).toBe("Olivia Bennett");
		expect(texts(page.data.content)).toEqual([
			"Providence, RI | olivia.bennett@example.com",
			"Experience",
			"Harlan Quay Capital Partners | New York, NY",
			"Investment Banking Analyst Intern | Jun 2025 – Aug 2025",
			"Built three-statement models for two consumer retail clients",
		]);
		await expect(runtime.inspect.kv.get("state:pageId")).resolves.toBe(page.id);

		const [actions] = find<{ elements: Array<{ target: unknown }> }>(first.blocks, "actions");
		expect(actions.elements[0].target).toEqual({ kind: "content", collection: "pages", id: page.id });

		// Pages keep revisions, so a later save is staged as a draft revision
		// and reaches the page row when the owner publishes it.
		const edited = RESUME.replace("# Olivia Bennett", "# Olivia R. Bennett");
		await runtime.admin.submit("/resume", "save", { resume: edited }, { user: admin });
		const staged = await runtime.inspect.content.list("pages");
		expect(staged).toHaveLength(1);
		expect(staged[0].id).toBe(page.id);
		expect(staged[0].draftRevisionId).toBeTruthy();
		await expect(runtime.actions.content.publish("pages", page.id, {})).resolves.toMatchObject({
			success: true,
		});
		const after = await runtime.inspect.content.get("pages", page.id);
		expect(after?.data.title).toBe("Olivia R. Bennett");
		// The URL stays where it was; only the editor changes the slug.
		expect(after?.slug).toBe("olivia-bennett");

		const reloaded = await runtime.admin.loadPage("/resume", { user: admin });
		expect(formValue(reloaded.blocks)).toBe(edited);
	});

	it("leaves the live page alone until the owner publishes the new draft", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;
		await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		const [page] = await runtime.inspect.content.list("pages");
		const published = await runtime.actions.content.publish("pages", page.id, {});
		expect(published).toMatchObject({ success: true });

		const response = await runtime.admin.submit(
			"/resume",
			"save",
			{ resume: RESUME.replace("New York, NY", "Boston, MA") },
			{ user: admin },
		);
		expect(response.toast?.message).toContain("Publish the page");
		const [summary] = find<{ text: string }>(response.blocks, "section");
		expect(summary.text).toContain("waiting as a draft");

		const live = await runtime.inspect.content.get("pages", page.id);
		expect(live?.status).toBe("published");
		expect(texts(live?.data.content)).toContain("Harlan Quay Capital Partners | New York, NY");
	});

	it("says the live page changed when Pages keep no revisions", async () => {
		const { runtime, admin } = await createHost(true, false);
		host = runtime;
		await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		const [page] = await runtime.inspect.content.list("pages");
		await runtime.actions.content.publish("pages", page.id, {});

		const response = await runtime.admin.submit(
			"/resume",
			"save",
			{ resume: RESUME.replace("New York, NY", "Boston, MA") },
			{ user: admin },
		);
		expect(response.toast?.message).toBe("Saved. The live page is updated.");
		const [summary] = find<{ text: string }>(response.blocks, "section");
		expect(summary.text).toBe("Your resume page is live on your site.");
		const live = await runtime.inspect.content.get("pages", page.id);
		expect(texts(live?.data.content)).toContain("Harlan Quay Capital Partners | Boston, MA");
	});

	it("ends up with one page when two first saves arrive together", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;
		await Promise.all([
			runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin }),
			runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin }),
		]);
		const pageId = await runtime.inspect.kv.get<string>("state:pageId");
		const pages = await runtime.inspect.content.list("pages");
		const kept = [];
		for (const page of pages) {
			if (await runtime.inspect.content.get("pages", page.id)) kept.push(page.id);
		}
		expect(kept).toEqual([pageId]);
	});

	it("keeps a slug the owner changed in the page editor", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;
		await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		const [page] = await runtime.inspect.content.list("pages");
		await expect(
			runtime.actions.content.update("pages", page.id, { data: {}, slug: "resume" }),
		).resolves.toMatchObject({ success: true });
		await runtime.actions.content.publish("pages", page.id, {});

		await runtime.admin.submit("/resume", "save", { resume: RESUME.replace("Providence", "Boston") }, { user: admin });
		await runtime.actions.content.publish("pages", page.id, {});
		const after = await runtime.inspect.content.get("pages", page.id);
		expect(after?.slug).toBe("resume");
		expect(texts(after?.data.content)[0]).toContain("Boston");
	});

	it("keeps the text but not the page when the name line is missing", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;
		const broken = "Olivia Bennett\n\n## Experience";
		const response = await runtime.admin.submit("/resume", "save", { resume: broken }, { user: admin });
		expect(response.toast).toBeUndefined();
		const [banner] = find<{ description: string }>(response.blocks, "banner");
		expect(banner.description).toContain("# Jane Doe");
		expect(formValue(response.blocks)).toBe(broken);
		await expect(runtime.inspect.kv.get("state:resume")).resolves.toBe(broken);
		await expect(runtime.inspect.content.list("pages")).resolves.toHaveLength(0);
	});

	it("refuses text longer than the limit without storing it", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;
		const long = `# A\n${"x".repeat(40_000)}`;
		const response = await runtime.admin.submit("/resume", "save", { resume: long }, { user: admin });
		expect(find(response.blocks, "banner")).toHaveLength(1);
		await expect(runtime.inspect.kv.get("state:resume")).resolves.toBeNull();
		await expect(runtime.inspect.content.list("pages")).resolves.toHaveLength(0);
	});

	it("creates a new page if the old one was deleted", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;
		await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		const [first] = await runtime.inspect.content.list("pages");
		await runtime.actions.content.trash("pages", first.id);

		const response = await runtime.admin.loadPage("/resume", { user: admin });
		expect(find(response.blocks, "actions")).toHaveLength(0);

		await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		const pages = await runtime.inspect.content.list("pages");
		const live = pages.filter((page) => page.id !== first.id);
		expect(live).toHaveLength(1);
		await expect(runtime.inspect.kv.get("state:pageId")).resolves.toBe(live[0].id);
	});

	it("does not touch other pages", async () => {
		const { runtime, admin } = await createHost();
		host = runtime;
		const about = await runtime.fixtures.content("pages", {
			slug: "about",
			data: { title: "About", content: [] },
		});
		await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		const unchanged = await runtime.inspect.content.get("pages", about.id);
		expect(unchanged?.data.title).toBe("About");
		await expect(runtime.inspect.content.list("pages")).resolves.toHaveLength(2);
	});

	it("explains what it needs when the site has no Pages collection", async () => {
		const { runtime, admin } = await createHost(false);
		host = runtime;
		const response = await runtime.admin.submit("/resume", "save", { resume: RESUME }, { user: admin });
		const [banner] = find<{ description: string }>(response.blocks, "banner");
		expect(banner.description).toContain("collection named pages");
		await expect(runtime.inspect.kv.get("state:pageId")).resolves.toBeNull();
	});
});
