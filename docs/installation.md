1. Install the plugin from **Registry** in your admin and approve its two permissions, Read content and Manage content. It needs them to create and update its page.
2. Open **Resume** in the sidebar, replace the template with your resume, and click **Save**. Drag the corner of the box to make it taller.
3. Click **Open the page**, check it, and publish it. Change the slug there if you want an address like `/resume`; later saves keep it.

Your site needs a collection named `pages` with a `title` field and a Portable Text field named `content`, and a route that shows those pages. The Blog template shows them at `/pages/<slug>` and the Starter template at `/<slug>`.

Markdown it understands: `# Your Name` on the first line, the contact line after it, `## Section`, `### Company` and `#### Job Title` with the place or dates in backticks at the end, `- ` bullets, `**Label:** text` lines, italics and links.
