# Release operations: deployment provenance pilot

SemVerge's next product milestone is to establish which GitHub commit Vercel built for an exact deployment and retain the observation. Keep the existing Cloud workspace as a reference and the local reliability workspace experimental. A successful HTTP request, a green CI run, and a Vercel production target are three distinct observations.

The pilot is an operator command with no dependency on the Cloud UI or MCP. From the repository root, with Node.js 24:

```sh
node cloud/scripts/observe-deployment.mjs \
  --repository OWNER/REPO --repository-id 123456 \
  --team team_EXAMPLE --project prj_EXAMPLE --deployment dpl_EXAMPLE \
  --candidate FULL_LOWERCASE_COMMIT_SHA --journal /path/to/private/journal
```

Supply an operator credential with Vercel deployment read access through `SEMVERGE_VERCEL_READ_TOKEN`. For a private GitHub repository, supply a narrowly scoped credential with Contents read access through `SEMVERGE_GITHUB_READ_TOKEN`. Keep credentials and the journal outside the repository; the journal includes repository and deployment identifiers. The script makes only GET requests to the provider API origins.

The command asks [Vercel for the exact deployment with Git source info](https://vercel.com/docs/rest-api/deployments/get-a-deployment-by-id-or-url), checks the deployment and project IDs, and requires a ready Git integration deployment with a GitHub repository ID and full SHA. It checks the repository ID and exact commit with GitHub. It ignores user-editable deployment metadata. A supplied candidate is compared by full SHA; the candidate is an input and has no approval or freshness semantics.

The journal stores one JSON record per distinct target and outcome, with the timestamp of the first recorded observation. Repeating the command rechecks both providers on the match path and reuses the record when the outcome is identical. Different deployment IDs, candidates and outcomes produce separate records. Use a local filesystem that supports hard links for atomic publication. Ignore files with the `.pending` suffix, which may remain after interruption. The journal is local operator evidence. Exit codes:

- `0`: Identified; the optional candidate matches, or no candidate was supplied.
- `2`: Evidence unavailable, or the candidate differs from the identified deployment SHA. The observation is still recorded.
- `1`: Invalid input, missing configuration, or journal write failure.

A `production-target` result means Vercel marked the deployment as targeting production. It does not prove that a production domain is serving it. Routing and health are explicitly unchecked. The command does not certify artifact contents, grant authorization, change traffic, or provide an automatic recovery target.

## Exit gates

1. **Deployment identity.** Passed on November 16, 2026 using two Git-triggered Previews from successive commits in a private GitHub fixture linked to an isolated Vercel project. The observer matched both by immutable ID and preserved the first record byte-for-byte across a restart and after the newer deployment. A different SHA returned `mismatch`. A different repository ID and a direct upload without Git source each returned `unavailable`. The record establishes provider-reported source identity. Artifact attestation, production routing, and application health require separate evidence.
2. **Enforced decision.** Use SemVerge's existing commit-bound CI evidence in a shared durable lifecycle. Bind a single-use approval to the repository, exact SHA, evidence revision, deployment, environment and operation. Recheck on consumption and deny stale, failed, or unavailable evidence from every caller. The pilot must also show that automatic production deployment and direct provider privileges cannot bypass the gate. Keep MCP read-only until that boundary exists.
3. **Verified recovery.** Reconcile provider operations after process restarts. Independently verify the deployment actually serving the target and its configured health checks. In an isolated fixture, detect a failure, propose the last verified compatible target, require a separate authorization, and verify the restored route and checks.

Validate adoption separately with solo developers and small teams already using GitHub, Vercel and coding agents. Measure whether they can safely make a decision or recover faster than with their existing workflows.
