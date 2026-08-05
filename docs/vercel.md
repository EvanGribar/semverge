# Vercel project surface

SemVerge is primarily a GitHub Action and local CLI, so its release engine does not need a Vercel runtime dependency. The `website/` directory is a separate static project intended to be hosted on Vercel as the public explanation, proof boundary, and contributor entry point.

## Preview and import

From the repository root:

```bash
pnpm dlx vercel --cwd website
```

When importing the repository through Vercel, set the project Root Directory to `website`. The project uses the checked-in `website/vercel.json`, has no build step, and sends browser hardening headers. Do not commit `.vercel/` project links or tokens.

## Open Source Program evidence

The [Vercel Open Source Program](https://vercel.com/open-source-program) currently lists these considerations: active open-source maintenance, hosting or intended hosting on Vercel, measurable impact or growth potential, a Code of Conduct, and use of credits only for the open-source project. This repository provides the public site boundary, open-source license, contribution/security documentation, Code of Conduct, deterministic fixtures, and hosted CI/security checks. Adoption, live deployment, and registry/provider proof remain external evidence gates and are not claimed by this repository.

Applications are currently closed on the program page and are expected to reopen in August. Check the live page before applying; do not treat this document as an application or a guarantee of eligibility.

## Operating boundary

- Use Vercel credits only for the SemVerge public site or project-owned proof surfaces.
- Keep GitHub and registry credentials in their respective provider settings; no secrets belong in this static project.
- Keep the site claims aligned with checked-in tests, hosted CI, and documented external proof limits.
