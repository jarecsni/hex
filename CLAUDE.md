# Hex

Scaffolding tool that assembles applications from **templated components**.

## Concept

- **Template**: a whole-project scaffolding, highly customisable via interactive prompts asked of the user (cookiecutter-style, but for a full application).
- **Components**: parts of an application stack (API layer, DB, auth, UI shell, etc.) that get assembled into the application.
- Both templates and components live in a **catalogue / marketplace**.
- When a template is updated in the catalogue, Hex can **upgrade** existing applications generated from it.
- **Customisation hooks / scripts** let a project deviate from the template without losing the upgrade path.
- **Stubbing** (API, DB, etc.) is supported by **integrating with existing stub engines** — Hex does not re-implement them.

## Status

Pre-code. The repository was initialised on 2026-04-24; stack and layout not yet chosen.

## Working notes

- `.claude/drills/` and `.claude/walkthroughs/` are ephemeral scratch areas used by the assistant — gitignored.
- Knowledge notebook for this project: `hex`.
