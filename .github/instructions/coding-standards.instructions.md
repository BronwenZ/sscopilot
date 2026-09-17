---
description: 'Repository-wide documentation and TypeScript coding standards'
applyTo: '**/*.{ts,astro,js,mjs}'
---

# Coding Standards

## Comments and documentation

- Comment **why** code exists: document intent, constraints, trade-offs, and non-obvious decisions.
- Do not restate what the code already says. Prefer clear names and types for mechanics.
- Keep comments close to the code they explain, and update or remove them whenever the related code changes. An outdated comment is a bug.
- Use TSDoc/JSDoc for exported APIs, not comments that merely narrate implementation steps.
- Keep comments concise and factual. Do not add comments to explain routine syntax or obvious control flow.

## TypeScript formatting

- Use single quotes, semicolons, trailing commas in multiline structures, and four-space indentation.
- Use explicit parameter and return types for exported functions and data-layer helpers.
- Prefer `const`, strict equality, and braces around control-flow bodies where they improve readability.
- Let ESLint enforce the repository's baseline style; do not introduce formatter-only exceptions in individual files.

## Exported functions

Every exported function in `db/` and `src/lib/` must have a TSDoc comment that:

- Explains the function's purpose and any important behavior or constraints.
- Documents every parameter with `@param`, including the injectable `db` argument.
- Documents the return value with `@returns`, including nullable or asynchronous results.

Document types and exported constants when their meaning is not obvious from their name and type.

## Astro component contracts

Every reusable `.astro` component must define a `Props` interface in frontmatter. Add a TSDoc comment immediately above the interface describing the component's contract, and document non-obvious properties with inline TSDoc comments. Keep the interface aligned with the props the component actually reads.
