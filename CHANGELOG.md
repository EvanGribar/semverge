# Changelog

## [0.1.12] - 2026-08-04

### Bug Fixes

- [quote release action metadata](https://github.com/EvanGribar/semverge/pull/48) (#48)

### Internal Changes

- [align release communication and v0 usage](https://github.com/EvanGribar/semverge/pull/47) (#47)

## [0.1.11] - 2026-08-04

### Bug Fixes

- [make npm publication retries idempotent](https://github.com/EvanGribar/semverge/pull/45) (#45)

## [0.1.10] - 2026-08-04

### Bug Fixes

- [require the release workspace commit](https://github.com/EvanGribar/semverge/pull/43) (#43)

## [0.1.9] - 2026-08-04

### Bug Fixes

- [verify releases after transactional publication](https://github.com/EvanGribar/semverge/pull/41) (#41)

## [0.1.8] - 2026-08-04

### Bug Fixes

- [apply unscoped changes to independent packages](https://github.com/EvanGribar/semverge/pull/39) (#39)

## [0.1.7] - 2026-08-04

### Bug Fixes

- [release explicitly included private roots in single mode](https://github.com/EvanGribar/semverge/pull/37) (#37)

## [0.1.6] - 2026-08-04

### Bug Fixes

- [preserve release tags during finalization](https://github.com/EvanGribar/semverge/pull/35) (#35)

## [0.1.5] - 2026-08-04

### Bug Fixes

- [make the action bundle executable as CommonJS](https://github.com/EvanGribar/semverge/pull/24) (#24)
- [pass the workflow token to SemVerge](https://github.com/EvanGribar/semverge/pull/27) (#27)
- [reuse checked-out history for release planning](https://github.com/EvanGribar/semverge/pull/28) (#28)
- [read release inputs from the checkout](https://github.com/EvanGribar/semverge/pull/29) (#29)
- [pass the workflow token to self dogfood](https://github.com/EvanGribar/semverge/pull/31) (#31)
- [read hyphenated action inputs](https://github.com/EvanGribar/semverge/pull/33) (#33)

### Internal Changes

- [Make release publication transactional and retry-safe](https://github.com/EvanGribar/semverge/pull/7) (#7)
- [Paginate GitHub release-decision API reads](https://github.com/EvanGribar/semverge/pull/8) (#8)
- [Use standards-compliant semantic versioning](https://github.com/EvanGribar/semverge/pull/9) (#9)
- [Fix workspace package ownership and dependency propagation](https://github.com/EvanGribar/semverge/pull/10) (#10)
- [Make release checks honest post-release verification](https://github.com/EvanGribar/semverge/pull/11) (#11)
- [Add CLI setup, release plans, and config doctor](https://github.com/EvanGribar/semverge/pull/12) (#12)
- [Add fixture repository end-to-end proof](https://github.com/EvanGribar/semverge/pull/13) (#13)
- [Add repository trust and security gates](https://github.com/EvanGribar/semverge/pull/14) (#14)
- [Bump actions/checkout from 4 to 7](https://github.com/EvanGribar/semverge/pull/15) (#15)
- [Bump pnpm/action-setup from 4 to 5](https://github.com/EvanGribar/semverge/pull/16) (#16)
- [Bump actions/dependency-review-action from 4 to 5](https://github.com/EvanGribar/semverge/pull/17) (#17)
- [Bump @types/node from 22.20.1 to 26.1.2](https://github.com/EvanGribar/semverge/pull/18) (#18)
- [Bump actions/setup-node from 4 to 7](https://github.com/EvanGribar/semverge/pull/22) (#22)
- [Bump esbuild from 0.25.12 to 0.28.1](https://github.com/EvanGribar/semverge/pull/20) (#20)
- [Bump vitest from 3.2.7 to 4.1.10](https://github.com/EvanGribar/semverge/pull/21) (#21)
- [Bump typescript from 5.9.3 to 7.0.2](https://github.com/EvanGribar/semverge/pull/19) (#19)
- [Complete fixture repository proof](https://github.com/EvanGribar/semverge/pull/23) (#23)
- [dogfood SemVerge releases](https://github.com/EvanGribar/semverge/pull/25) (#25)
