# Customer communication model

SemVerge keeps release classification and customer communication as separate concerns. The release engine still decides the release kind, breaking status, version, readiness, and publication behavior deterministically. A parsed change also carries a structured `customerCommunication` value for customer-facing renderers.

## Model

```ts
type CustomerImpact = "new" | "improved" | "fixed" | "changed";

type CustomerCommunication = {
  headline?: string;
  outcome: string;
  detail?: string;
  impact: CustomerImpact;
  actionRequired?: string;
  audience?: string[];
};
```

`outcome` is the customer-readable result of the change. `detail` adds useful context without changing the release classification. `actionRequired` records a concrete customer action when one exists. `audience` is an optional list of intended audiences such as `users`, `admins`, or `developers`.

## Pull-request metadata

The low-friction `customer:` field remains supported. Richer communication can be authored in the same hidden metadata block:

```md
<!-- semverge
type: feature
headline: Bulk project exports
outcome: Teams can download multiple projects in one step.
detail: Exported data keeps the same format as individual project exports.
impact: new
action: No action is required.
audience: [teams, admins]
-->
```

For JSON metadata, use the same field names:

```json
{
  "type": "breaking",
  "outcome": "API responses use the normalized data shape.",
  "impact": "changed",
  "action": "Update clients to read data.items."
}
```

The precedence is deterministic:

1. `outcome` is used when present.
2. Legacy `customer` is used when `outcome` is absent.
3. The conventional-commit description is used as a conservative fallback.

The `impact` field follows the authored value when present. Otherwise SemVerge derives `new` for features, `fixed` for fixes, `changed` for breaking changes, and `improved` for other kinds. The inferred value describes communication tone; it never changes the authoritative release kind or bump.

Missing richer fields do not require AI and do not block a release. Renderers should read `customerCommunication` (or its compatibility alias `customerSummary`) instead of reading raw commit or pull-request descriptions for normal customer output. Internal and documentation changes remain available to technical artifacts but are not automatically customer-facing.

## Customer notes

The deterministic customer-note renderer presents outcomes in audience language: `New`, `Improved`, `Fixed`, and `Changed`. It does not lead with release counts, semver bump terminology, commit subjects, or pull-request numbers. A changed/breaking outcome includes an explicit upgrade warning and an `Action required` section sourced from authored action or migration metadata; if no action was supplied, it asks the reader to review the changed behavior. Action sections are omitted for ordinary no-action releases. The technical changelog keeps its separate category and traceability format.
