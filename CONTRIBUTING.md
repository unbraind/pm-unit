# Contributing

Use TypeScript with no any types. Run npm run release:check and bun run release:check. Include tracker context, tests, and a behavioral revert proof.

## Acceptance prerequisites

Packed release acceptance supports POSIX hosts with bash, Bun, npm and npx on
PATH. Use Linux or macOS for these checks. Windows and missing required tools
produce an explicit prerequisite failure before packing or creating launchers;
release checks never skip missing runtime evidence. This development-tooling
constraint does not certify or restrict the package's pure TypeScript SDK.
