# External consumer fixture

This directory is shaped like a separate repository consuming SemVerge. Copy
it into a public repository and the checked-in workflow will run a read-only
plan using the stable `EvanGribar/semverge@v0` ref.

The workflow uses only the built-in `github.token` with `contents: read` and
`pull-requests: read`; it has no secrets, publication commands, or owner-local
assumptions. The repository's tests validate this contract statically. A live
copy is still required to prove GitHub event delivery and hosted permissions.
