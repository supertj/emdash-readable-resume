import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { renderAdminPage, STARTER_RESUME, type PageStatus } from "./admin.js";
import { parseResume } from "./markdown.js";
import { toPortableText } from "./portable-text.js";

/**
 * The page goes into the Pages collection that the Blog, Starter and
 * Portfolio templates create, as a title plus a Portable Text field named
 * content. Sandboxed plugins can't add routes or styles to the public site,
 * so the page is rendered by the site's own page template, in its own type.
 */
const COLLECTION = "pages";

const KV_RESUME = "state:resume";
const KV_PAGE_ID = "state:pageId";

/**
 * A resume is a few kilobytes. Block Kit rejects a whole response if any
 * string in it is over 64 KiB, and the saved text goes back into the form,
 * so the cap leaves room under that limit. It counts bytes, not characters,
 * because that limit does.
 */
const MAX_RESUME_BYTES = 32_000;
const MAX_FORM_ECHO_BYTES = 60_000;

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function loadPageStatus(ctx: PluginContext): Promise<PageStatus | undefined> {
	const pageId = await ctx.kv.get<string>(KV_PAGE_ID);
	if (!pageId || !ctx.content) return undefined;
	let page;
	try {
		page = await ctx.content.get(COLLECTION, pageId);
	} catch (error) {
		// The collection can be renamed or removed after the page was made.
		// The form must still open so the resume text isn't stranded.
		ctx.log.warn("Could not read the resume page", { error: String(error) });
		return undefined;
	}
	if (!page) return undefined;
	const hasUnpublishedChanges =
		page.status === "published" && !!page.draftRevisionId && page.draftRevisionId !== page.liveRevisionId;
	let publicUrl: string | undefined;
	if (page.status === "published" && ctx.content.getPublicUrl) {
		const url = await ctx.content.getPublicUrl(COLLECTION, pageId);
		if (url) publicUrl = /^https?:\/\//.test(url) ? url : ctx.url(url);
	}
	return {
		id: page.id,
		published: page.status === "published",
		hasUnpublishedChanges,
		publicUrl,
	};
}

async function renderCurrent(ctx: PluginContext, resumeText?: string) {
	const saved = resumeText ?? (await ctx.kv.get<string>(KV_RESUME)) ?? STARTER_RESUME;
	return renderAdminPage({ resume: saved, page: await loadPageStatus(ctx) });
}

/**
 * Saves the text, then writes the page. The text is stored even when it
 * can't be turned into a page, so a mistake never costs the user their
 * typing; the page keeps its last good version until the text is fixed.
 */
async function save(ctx: PluginContext, resumeText: string) {
	const size = byteLength(resumeText);
	if (size > MAX_RESUME_BYTES) {
		// Show the text back so it can be shortened, unless it's too big for
		// the form itself; then the last saved version is all that fits.
		const fallback = (await ctx.kv.get<string>(KV_RESUME)) ?? STARTER_RESUME;
		return renderAdminPage({
			resume: size <= MAX_FORM_ECHO_BYTES ? resumeText : fallback,
			page: await loadPageStatus(ctx),
			error: "The resume is over the 32,000-byte limit. Shorten it and save again.",
		});
	}
	await ctx.kv.set(KV_RESUME, resumeText);

	const parsed = parseResume(resumeText);
	if (!parsed.ok) {
		return renderAdminPage({ resume: resumeText, page: await loadPageStatus(ctx), error: parsed.error });
	}

	const content = ctx.content;
	if (!content?.create || !content.update || !content.delete) {
		// Only possible if a site runs the plugin without the capability it declares.
		return renderAdminPage({
			resume: resumeText,
			page: undefined,
			error: "This site didn't give the plugin permission to manage content, so it can't write the page.",
		});
	}

	const { title, content: body } = toPortableText(parsed.resume);
	const fields = { title, content: body };
	let created = false;
	try {
		const stored = await ctx.kv.getVersioned<string>(KV_PAGE_ID);
		const existing = stored?.value ? await content.get(COLLECTION, stored.value) : null;
		if (existing) {
			await content.update(COLLECTION, existing.id, fields);
		} else {
			const page = await content.create(COLLECTION, fields);
			// The admin doesn't disable Save while a request is running, so a
			// double click can send two first saves at once. Only the save that
			// still sees the page ID it read gets to record its page; the other
			// moves its copy to the trash and writes to the recorded page.
			const claim = await ctx.kv.compareAndSet(KV_PAGE_ID, stored?.revision ?? null, page.id);
			if (claim.applied) {
				created = true;
			} else {
				await content.delete(COLLECTION, page.id);
				const winnerId = await ctx.kv.get<string>(KV_PAGE_ID);
				if (winnerId) await content.update(COLLECTION, winnerId, fields);
			}
		}
	} catch (error) {
		ctx.log.error("Could not write the resume page", { error: String(error) });
		return renderAdminPage({
			resume: resumeText,
			page: await loadPageStatus(ctx),
			error: `The site wouldn't save the page: ${error instanceof Error ? error.message : String(error)}. The plugin needs a collection named pages with a title field and a Portable Text field named content.`,
		});
	}

	// Word the message from the page's state after the write, not from what
	// the plugin expected: on a collection without revisions an update goes
	// straight to the live page.
	const page = await loadPageStatus(ctx);
	const message = created
		? "Saved. The page is a draft until you publish it."
		: page?.hasUnpublishedChanges
			? "Saved. Publish the page to put the changes live."
			: page?.published
				? "Saved. The live page is updated."
				: "Saved.";
	return { ...renderAdminPage({ resume: resumeText, page }), toast: { message, type: "success" as const } };
}

const plugin: SandboxedPlugin = {
	routes: {
		admin: {
			handler: async (routeCtx, ctx) => {
				const interaction = routeCtx.input;
				if (!isRecord(interaction)) return { blocks: [] };

				if (interaction.type === "form_submit" && interaction.action_id === "save") {
					const values = isRecord(interaction.values) ? interaction.values : {};
					const resumeText = typeof values.resume === "string" ? values.resume : "";
					return save(ctx, resumeText);
				}
				return renderCurrent(ctx);
			},
		},
	},
};

export default plugin;
