// Extension: issue-triage-board
//
// Shared project canvas — open it by asking Copilot to triage the repo's open
// issues. The agent does the ranking (it has the repo context); this extension
// only renders the result and wires the "add to context" round trip.
//
// A Kanban-style triage board for open GitHub issues. The agent supplies the
// issue list (already ranked) via the canvas `open` input. The top 3 issues
// are highlighted with a justification for why they need attention now; the
// rest sit in a "Backlog" section below. Each card has an "Add to context"
// button that POSTs to this loopback server, which calls `session.send()` so
// the issue is injected straight into the current conversation as a new
// turn — ready for the agent to start working on immediately.

import { createServer } from "node:http";
import { joinSession, createCanvas, CanvasError } from "@github/copilot-sdk/extension";

// instanceId -> { server, url, state }
// `state` holds the last-rendered board data so re-opens / iframe reloads
// (which re-fetch `GET /`) show the same board without re-invoking `open`.
const servers = new Map();

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    }[ch]));
}

function renderCard(issue, { highlighted }) {
    const justification = highlighted && issue.justification
        ? `<p class="justification"><strong>Why now:</strong> ${escapeHtml(issue.justification)}</p>`
        : "";
    const description = issue.description ? `<p class="description">${escapeHtml(issue.description)}</p>` : "";
    return `
    <article class="card${highlighted ? " card--top" : ""}" data-issue="${issue.number}">
      <header>
        <span class="issue-number">#${issue.number}</span>
        <h3>${escapeHtml(issue.title)}</h3>
      </header>
      ${description}
      ${justification}
      <footer>
        ${issue.url ? `<a class="link" href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">View on GitHub</a>` : ""}
        <button class="add-btn" data-number="${issue.number}" data-title="${escapeHtml(issue.title)}">
          Add to context
        </button>
      </footer>
    </article>`;
}

function renderHtml(state) {
    const { repo, topIssues, otherIssues } = state;
    const topCards = topIssues.map((issue) => renderCard(issue, { highlighted: true })).join("\n");
    const otherCards = otherIssues.map((issue) => renderCard(issue, { highlighted: false })).join("\n");

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Issue Triage Board</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 1.25rem;
        background: var(--background-color-default, #0d1117);
        color: var(--text-color-default, #e6edf3);
        font-family: var(--font-sans, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
        font-size: var(--text-body-medium, 14px);
        line-height: var(--leading-body-medium, 20px);
      }
      h1 {
        font-family: var(--font-sans-display, var(--font-sans, sans-serif));
        font-size: var(--text-title-medium, 20px);
        font-weight: var(--font-weight-semibold, 600);
        margin: 0 0 0.25rem;
      }
      .subtitle {
        color: var(--text-color-muted, #8b949e);
        margin: 0 0 1.5rem;
      }
      section.column { margin-bottom: 2rem; }
      section.column h2 {
        font-size: var(--text-title-small, 15px);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-color-muted, #8b949e);
        margin: 0 0 0.75rem;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 1rem;
      }
      .card {
        border: 1px solid var(--border-color-default, #30363d);
        border-radius: 8px;
        padding: 0.9rem 1rem;
        background: var(--background-color-default, #161b22);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .card--top {
        border-color: var(--true-color-red, #f85149);
        box-shadow: 0 0 0 1px var(--true-color-red-muted, rgba(248, 81, 73, 0.4));
      }
      .card header { display: flex; align-items: baseline; gap: 0.5rem; }
      .card h3 { margin: 0; font-size: var(--text-body-large, 15px); font-weight: var(--font-weight-semibold, 600); }
      .issue-number { color: var(--text-color-muted, #8b949e); font-family: var(--font-mono, monospace); font-size: 12px; }
      .description { margin: 0; color: var(--text-color-default, #e6edf3); }
      .justification {
        margin: 0;
        padding: 0.5rem 0.65rem;
        border-radius: 6px;
        background: var(--true-color-red-muted, rgba(248, 81, 73, 0.12));
        color: var(--text-color-default, #e6edf3);
        font-size: var(--text-body-small, 12.5px);
      }
      .card footer { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
      .link { color: var(--true-color-blue, #58a6ff); text-decoration: none; font-size: 12.5px; }
      .link:hover { text-decoration: underline; }
      .add-btn {
        appearance: none;
        border: 1px solid var(--border-color-default, #30363d);
        border-radius: 6px;
        background: var(--true-color-blue, #1f6feb);
        color: var(--color-white, #ffffff);
        padding: 0.35rem 0.7rem;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
      }
      .add-btn:hover { filter: brightness(1.08); }
      .add-btn:focus-visible { outline: 2px solid var(--color-focus-outline, #1f6feb); outline-offset: 2px; }
      .add-btn[disabled] { cursor: default; opacity: 0.7; }
    </style>
  </head>
  <body>
    <h1>Issue Triage Board</h1>
    <p class="subtitle">${escapeHtml(repo)} — ranked by likely need for attention right now</p>

    <section class="column">
      <h2>🔥 Needs attention now (top 3)</h2>
      <div class="grid">${topCards}</div>
    </section>

    <section class="column">
      <h2>Backlog</h2>
      <div class="grid">${otherCards}</div>
    </section>

    <script>
      document.querySelectorAll('.add-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const number = btn.dataset.number;
          const title = btn.dataset.title;
          btn.disabled = true;
          btn.textContent = 'Adding…';
          try {
            const res = await fetch('/work-on', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ number, title }),
            });
            if (!res.ok) throw new Error('request failed');
            btn.textContent = 'Added ✓';
          } catch (err) {
            btn.textContent = 'Failed — retry';
            btn.disabled = false;
          }
        });
      });
    </script>
  </body>
</html>`;
}

function findIssue(state, number) {
    return [...state.topIssues, ...state.otherIssues].find((issue) => String(issue.number) === String(number));
}

async function readJsonBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    if (chunks.length === 0) return {};
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startServer(instanceId, initialState, session) {
    const server = createServer(async (req, res) => {
        try {
            const entry = servers.get(instanceId);
            const state = entry?.state ?? initialState;

            if (req.method === "GET" && req.url === "/") {
                res.setHeader("Content-Type", "text/html; charset=utf-8");
                res.end(renderHtml(state));
                return;
            }

            if (req.method === "POST" && req.url === "/work-on") {
                const body = await readJsonBody(req);
                const issue = findIssue(state, body.number);
                const title = issue?.title ?? body.title ?? `issue #${body.number}`;
                const description = issue?.description ? `\n\n${issue.description}` : "";
                const url = issue?.url ? `\n\nLink: ${issue.url}` : "";
                await session.send({
                    prompt: `Let's start working on ${state.repo} issue #${body.number}: "${title}".${description}${url}`,
                });
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ ok: true }));
                return;
            }

            res.statusCode = 404;
            res.end("Not found");
        } catch (err) {
            res.statusCode = 500;
            res.end(String(err?.message ?? err));
        }
    });
    // Port 0 = let the OS pick a free ephemeral port. Bind to loopback only.
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/`, state: initialState };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue Triage Board",
            description:
                "A Kanban board of open GitHub issues with the top 3 needing attention highlighted and justified, plus a backlog section. Each card can be added to the current session's context with one click.",
            inputSchema: {
                type: "object",
                properties: {
                    repo: { type: "string", description: "owner/repo the issues belong to" },
                    topIssues: {
                        type: "array",
                        description: "The 3 issues most likely to need attention right now, each with a justification.",
                        items: {
                            type: "object",
                            properties: {
                                number: { type: "number" },
                                title: { type: "string" },
                                description: { type: "string" },
                                justification: { type: "string", description: "Why this issue is top priority right now" },
                                url: { type: "string" },
                            },
                            required: ["number", "title"],
                        },
                    },
                    otherIssues: {
                        type: "array",
                        description: "The remaining open issues, shown in a backlog section below.",
                        items: {
                            type: "object",
                            properties: {
                                number: { type: "number" },
                                title: { type: "string" },
                                description: { type: "string" },
                                url: { type: "string" },
                            },
                            required: ["number", "title"],
                        },
                    },
                },
                required: ["repo", "topIssues"],
            },
            actions: [
                {
                    name: "update_board",
                    description: "Replace the board's issue data (e.g. after re-triaging or issues being closed).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            repo: { type: "string" },
                            topIssues: { type: "array" },
                            otherIssues: { type: "array" },
                        },
                    },
                    handler: async (ctx) => {
                        const entry = servers.get(ctx.instanceId);
                        if (!entry) {
                            throw new CanvasError("not_found", "Canvas instance is not open");
                        }
                        entry.state = {
                            repo: ctx.input.repo ?? entry.state.repo,
                            topIssues: ctx.input.topIssues ?? entry.state.topIssues,
                            otherIssues: ctx.input.otherIssues ?? entry.state.otherIssues,
                        };
                        return { ok: true };
                    },
                },
            ],
            // Boots (or reuses, on rehydrate/reopen) a loopback HTTP server
            // serving the board and handling "add to context" clicks.
            open: async (ctx) => {
                const initialState = {
                    repo: ctx.input?.repo ?? "unknown/repo",
                    topIssues: ctx.input?.topIssues ?? [],
                    otherIssues: ctx.input?.otherIssues ?? [],
                };
                let entry = servers.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId, initialState, session);
                    servers.set(ctx.instanceId, entry);
                } else {
                    // Re-open (e.g. after reload): refresh with the latest input.
                    entry.state = initialState;
                }
                return {
                    title: "Issue Triage Board",
                    url: entry.url,
                };
            },
            onClose: async (ctx) => {
                const entry = servers.get(ctx.instanceId);
                if (entry) {
                    servers.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
