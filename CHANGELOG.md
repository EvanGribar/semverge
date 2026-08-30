# Changelog

## [0.15.0] - 2026-08-30

### Features

- [add configurable version file updaters](https://github.com/EvanGribar/semverge/pull/124) (#124)
- [improve migration and init guidance](https://github.com/EvanGribar/semverge/pull/126) (#126)
- [support generic version-file repositories](https://github.com/EvanGribar/semverge/pull/128) (#128)

### Bug Fixes

- [block prototype pollution in version selectors](https://github.com/EvanGribar/semverge/pull/129) (#129)
- [avoid computed prototype assignments](https://github.com/EvanGribar/semverge/pull/130) (#130)

### Internal Changes

- [expand conformance matrix and release PR guidance](https://github.com/EvanGribar/semverge/pull/127) (#127)

## [0.14.0] - 2026-08-29

### Features

- [add release verification workflow](https://github.com/EvanGribar/semverge/pull/101) (#101)
- [add optional BYOK AI provider layer](https://github.com/EvanGribar/semverge/pull/116) (#116)
- [add structured customer communication model](https://github.com/EvanGribar/semverge/pull/117) (#117)
- [redesign customer release notes](https://github.com/EvanGribar/semverge/pull/118) (#118)
- [add customer communication quality gates](https://github.com/EvanGribar/semverge/pull/119) (#119)
- [separate external announcement copy](https://github.com/EvanGribar/semverge/pull/120) (#120)
- [complete AI release communication workflows](https://github.com/EvanGribar/semverge/pull/121) (#121)

### Bug Fixes

- [do not mark plugin hooks complete before effects finish](https://github.com/EvanGribar/semverge/pull/91) (#91)
- [treat completed plugin effects as terminal across retries](https://github.com/EvanGribar/semverge/pull/100) (#100)
- [initialize release executions before plugin hooks](https://github.com/EvanGribar/semverge/pull/102) (#102)
- [fail closed on plugin effect detection errors](https://github.com/EvanGribar/semverge/pull/107) (#107)
- [validate workspace dependency range rewrites](https://github.com/EvanGribar/semverge/pull/108) (#108)
- [remove CodeQL backtracking scans](https://github.com/EvanGribar/semverge/pull/122) (#122)
- [remove remaining CodeQL regex scans](https://github.com/EvanGribar/semverge/pull/123) (#123)

### Internal Changes

- add workspace agent rules and skills for release development
- add agent quickstart prompt to README
- noop
- remove accidental noop file
- x
- remove accidental temporary file
- [focus SemVerge adoption story](https://github.com/EvanGribar/semverge/pull/87) (#87)
- [bump esbuild from 0.28.1 to 0.28.2](https://github.com/EvanGribar/semverge/pull/89) (#89)
- [bump pnpm/action-setup from 5 to 6](https://github.com/EvanGribar/semverge/pull/88) (#88)
- [bump @types/node from 26.1.2 to 26.2.0](https://github.com/EvanGribar/semverge/pull/90) (#90)
- [bump vitest from 4.1.10 to 4.1.11](https://github.com/EvanGribar/semverge/pull/97) (#97)
- [finish public consumer readiness](https://github.com/EvanGribar/semverge/pull/109) (#109)

## [0.13.0] - 2026-08-06

### Features

- complete core release engine with transaction-owned plugin execution
- complete core release engine with transaction-owned plugin execution and load support

### Bug Fixes

- update pnpm-lock.yaml for pnpm 10 compatibility and rebuild bundle
- allow failure injection to trigger in live runs

### Internal Changes

- document live provider publication and recovery proof for GHCR
- [add comprehensive conformance test suite](https://github.com/EvanGribar/semverge/pull/86) (#86)

## [0.12.0] - 2026-08-05

### Features

- [add durable OCI release targets](https://github.com/EvanGribar/semverge/pull/83) (#83)

## [0.11.0] - 2026-08-05

### Features

- [add scheduled channel release policies](https://github.com/EvanGribar/semverge/pull/79) (#79)

### Bug Fixes

- [preserve stable release publication](https://github.com/EvanGribar/semverge/pull/81) (#81)

### Internal Changes

- [v0.10.0](https://github.com/EvanGribar/semverge/pull/80) (#80)

## [0.10.0] - 2026-08-05

### Features

- [add scheduled channel release policies](https://github.com/EvanGribar/semverge/pull/79) (#79)

## [0.9.0] - 2026-08-05

### Features

- [add monitoring check-run evidence](https://github.com/EvanGribar/semverge/pull/77) (#77)

## [0.8.0] - 2026-08-05

### Features

- [add delayed release monitoring](https://github.com/EvanGribar/semverge/pull/75) (#75)

## [0.7.0] - 2026-08-05

### Features

- [add Python and Rust registry adapters](https://github.com/EvanGribar/semverge/pull/73) (#73)

## [0.6.0] - 2026-08-05

### Features

- [add configurable channel policies](https://github.com/EvanGribar/semverge/pull/71) (#71)

## [0.5.0] - 2026-08-05

### Features

- [discover Python and Rust workspaces](https://github.com/EvanGribar/semverge/pull/69) (#69)

## [0.4.0] - 2026-08-05

### Features

- [add independent dependency policies](https://github.com/EvanGribar/semverge/pull/67) (#67)

### Internal Changes

- [cover finalization and verification recovery](https://github.com/EvanGribar/semverge/pull/66) (#66)

## [0.3.0] - 2026-08-05

### Features

- [add opt-in npm provenance guard](https://github.com/EvanGribar/semverge/pull/64) (#64)

## [0.2.0] - 2026-08-05

### Features

- [explain monorepo release graph](https://github.com/EvanGribar/semverge/pull/50) (#50)
- [add explicit stable release promotion](https://github.com/EvanGribar/semverge/pull/61) (#61)
- [support named prerelease channels](https://github.com/EvanGribar/semverge/pull/63) (#63)

### Internal Changes

- [Add durable release transaction recovery](https://github.com/EvanGribar/semverge/pull/52) (#52)
- [Add versioned release plugin SDK](https://github.com/EvanGribar/semverge/pull/53) (#53)
- [Add human-readable release explanations](https://github.com/EvanGribar/semverge/pull/54) (#54)
- [Add report-first migration diagnostics](https://github.com/EvanGribar/semverge/pull/58) (#58)
- [Add read-only setup diagnostics](https://github.com/EvanGribar/semverge/pull/59) (#59)
- [Record artifact integrity and add Vercel OSS surface](https://github.com/EvanGribar/semverge/pull/60) (#60)
- [add release failure injection coverage](https://github.com/EvanGribar/semverge/pull/62) (#62)
- [bump pnpm/action-setup from 4 to 5](https://github.com/EvanGribar/semverge/pull/55) (#55)
- [bump actions/checkout from 4 to 7](https://github.com/EvanGribar/semverge/pull/56) (#56)
- [bump actions/setup-node from 4 to 7](https://github.com/EvanGribar/semverge/pull/57) (#57)

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
