# Development Rules

`AGENTS.md` contains project-agnostic engineering rules. Project-specific architecture and product decisions belong in `docs/`.

## Before Coding

- Read the relevant module and its tests before changing code.
- Check `docs/` for existing decisions and constraints.
- Prefer the repository's existing patterns and dependencies.
- Keep the change focused on one business capability.

## Responsibility Check

After implementing a feature, inspect every changed module and ask:

- Does one class have more than one business responsibility?
- Does one method orchestrate persistence, parsing, validation, and presentation at the same time?
- Does a service directly depend on several unrelated infrastructure systems?
- Does a parser contain logic for multiple file formats?
- Are there enough public methods or branches that independent testing would become difficult?
- Can one part be changed without understanding the rest of the file?

When the answer is yes, split the code by responsibility before completing the task. Prefer small application services, adapters, pure utilities, and format-specific implementations over a large general-purpose service.

## Module Design

- Controllers handle transport concerns only.
- Application services coordinate use cases.
- Domain or workflow services own state transitions and business rules.
- Repositories and stores own persistence details.
- Infrastructure adapters own external systems such as databases, object storage, queues, and model providers.
- Format-specific parsers must implement a shared contract and must not access unrelated databases directly.
- Avoid introducing a microservice solely to solve a code organization problem; use modular boundaries first.

## Testing

Every new module should be independently testable with small fixtures or fakes.

At minimum, add tests for:

- the normal path;
- invalid input and failure paths;
- state transitions;
- persistence cleanup when a later operation fails;
- important formatting or serialization rules.

Run the narrowest relevant tests first, then the full project checks.

## Documentation

- Put project-specific architecture decisions in `docs/`.
- Update the relevant guide when a design decision changes.
- Keep comments focused on why a non-obvious decision exists.
- Do not duplicate the same decision across multiple files.

## Completion Checklist

Before finishing a change:

1. Review changed files for responsibility overload.
2. Split oversized or multi-purpose classes where needed.
3. Add or update focused tests.
4. Update project-specific documentation.
5. Run build, tests, formatting checks, and configuration validation.
6. Review the final diff and ensure generated files and local secrets are excluded.
