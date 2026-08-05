# Optional Vercel-compatible surface

SemVerge is a GitHub Action and local CLI. It does not need a frontend, a Vercel runtime, or a Vercel account to build, test, release, or publish packages. The optional `website/` directory is a dependency-free static explanation of the project; it is not part of the release engine or a required product surface.

No Vercel project is linked or deployed at this time. The checked-in `website/vercel.json` preserves a clean future compatibility boundary without making hosting part of local development or CI. Do not run a deployment as part of the normal release workflow, and do not commit `.vercel/` project links or tokens.

## Open Source Program boundary

The [Vercel Open Source Program](https://vercel.com/open-source-program) is an external program with its own current requirements and application status. This repository makes no eligibility or acceptance claim. Adoption, live deployment, and registry/provider proof remain external evidence gates and are not represented by the optional static files.

## Operating boundary

- Keep the CLI, action, transaction engine, and package ecosystem useful without `website/`.
- If hosting is chosen later, `website/` is already isolated as a static project with no secrets or runtime credentials.
- Keep GitHub and registry credentials in their respective provider settings; no secrets belong in the static project.
- Keep all public claims aligned with checked-in tests, hosted CI, and documented external proof limits.
