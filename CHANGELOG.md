# Changelog

## [3.0.2](https://github.com/rumankazi/fettle/compare/v3.0.1...v3.0.2) (2026-08-16)


### Bug fixes

* **core:** escape backslashes in evidence, and clear the CodeQL highs ([#42](https://github.com/rumankazi/fettle/issues/42)) ([9cda7aa](https://github.com/rumankazi/fettle/commit/9cda7aafb72a5d2d8197a9b65ee5363eb7638a2c))
* **deps:** update dependency js-yaml to v5 ([#31](https://github.com/rumankazi/fettle/issues/31)) ([1d8f04b](https://github.com/rumankazi/fettle/commit/1d8f04b7daaccde31a8d9b529aa9117b863a155a))

## [3.0.1](https://github.com/rumankazi/fettle/compare/v3.0.0...v3.0.1) (2026-08-16)


### Bug fixes

* **core:** treat an empty config file the same on js-yaml 4 and 5 ([#39](https://github.com/rumankazi/fettle/issues/39)) ([35a2e18](https://github.com/rumankazi/fettle/commit/35a2e18ab11ef163e1aa4c6297e2d1734f5528b4))

## [3.0.0](https://github.com/rumankazi/fettle/compare/v2.0.2...v3.0.0) (2026-08-15)


### ⚠ BREAKING CHANGES

* **core:** remove both Octokit plugins, leaving two runtime dependencies ([#21](https://github.com/rumankazi/fettle/issues/21))

### Features

* **core:** remove both Octokit plugins, leaving two runtime dependencies ([#21](https://github.com/rumankazi/fettle/issues/21)) ([ba52532](https://github.com/rumankazi/fettle/commit/ba52532b65858b6808bfd5a9d5bda6b66d18390f))

## [2.0.2](https://github.com/rumankazi/fettle/compare/v2.0.1...v2.0.2) (2026-08-15)


### Bug fixes

* **cli:** give the package a resolvable entry point ([#20](https://github.com/rumankazi/fettle/issues/20)) ([274b599](https://github.com/rumankazi/fettle/commit/274b5998343bbfb796feafd805d04ff0f5a079d7))

## [2.0.1](https://github.com/rumankazi/fettle/compare/v2.0.0...v2.0.1) (2026-08-15)


### Documentation

* README told people to use a reference that does not resolve ([#18](https://github.com/rumankazi/fettle/issues/18)) ([c1136b3](https://github.com/rumankazi/fettle/commit/c1136b3a389095c3456ca4621c089469c5eb71f6))

## [2.0.0](https://github.com/rumankazi/fettle/compare/v1.0.1...v2.0.0) (2026-08-15)


### ⚠ BREAKING CHANGES

* **action:** publish the Action from the repository root ([#15](https://github.com/rumankazi/fettle/issues/15))

### Features

* **action:** publish the Action from the repository root ([#15](https://github.com/rumankazi/fettle/issues/15)) ([2544cda](https://github.com/rumankazi/fettle/commit/2544cda6cc5d0f27c6aa9a6336280e36669ca6de))

## [1.0.1](https://github.com/rumankazi/fettle/compare/v1.0.0...v1.0.1) (2026-08-15)


### Documentation

* bring the docs up to v1.0.0 and pin the schema contract ([#14](https://github.com/rumankazi/fettle/issues/14)) ([f1b8e7c](https://github.com/rumankazi/fettle/commit/f1b8e7cd251075642076d5152f655bb7e665ba40))

## [1.0.0](https://github.com/rumankazi/fettle/compare/v0.2.0...v1.0.0) (2026-08-15)


### ⚠ BREAKING CHANGES

* **action:** none for consumers of the Action or the packages; the runtime swap is internal. Marked as a feature because the shipped artefact changes substantially.

### Features

* **action:** implement the runner protocol instead of @actions/core ([9fa0929](https://github.com/rumankazi/fettle/commit/9fa0929904ad5171656cd27d8d5a2ac370062933))
* **core:** render a self-contained SVG badge ([c49a2b2](https://github.com/rumankazi/fettle/commit/c49a2b26627e54b961d95eeae2dbe6b9a0230a8e))


### Documentation

* correct the badge instructions and use our own SVG ([c9ee463](https://github.com/rumankazi/fettle/commit/c9ee463a94071b2d42b400d18de265a18b3502bf))

## [0.2.0](https://github.com/rumankazi/fettle/compare/v0.1.4...v0.2.0) (2026-08-15)


### Features

* **ci:** publish this repository's own health badge ([22211fc](https://github.com/rumankazi/fettle/commit/22211fc4c4a4ea9ffad0735836886926ee6e2bd1))


### Bug fixes

* **ci:** let the health scan run without an App token ([13a7f79](https://github.com/rumankazi/fettle/commit/13a7f792ee00ad88868cc300dab900155bc9963b))

## [0.1.4](https://github.com/rumankazi/fettle/compare/v0.1.3...v0.1.4) (2026-08-15)


### Documentation

* record that npm token publishing is closing, and how to bootstrap ([ed470d7](https://github.com/rumankazi/fettle/commit/ed470d71ee28df428d593ad365b513e35f6d45f6))

## [0.1.3](https://github.com/rumankazi/fettle/compare/v0.1.2...v0.1.3) (2026-08-15)


### Bug fixes

* **ci:** move the floating major tag before publishing to npm ([13514d6](https://github.com/rumankazi/fettle/commit/13514d60daff0b11bbae549782b5408cab7443d9))
* **ci:** push the release bundle as the App, not github-actions ([96b13e9](https://github.com/rumankazi/fettle/commit/96b13e942fedd5539528b7fd8e9345dfdabd130c))

## [0.1.2](https://github.com/rumankazi/fettle/compare/v0.1.1...v0.1.2) (2026-08-15)


### Bug fixes

* **ci:** repair the checks that were failing on every branch ([e9eed5e](https://github.com/rumankazi/fettle/commit/e9eed5e5641c1b53e04a92d0f79b9e95c6be00a7))
* **ci:** stop Prettier failing on the generated changelog ([c889a6e](https://github.com/rumankazi/fettle/commit/c889a6e4c33bc8167cc220b7af9231def632b010))
* **ci:** stop tests pinning the version they are released with ([9744285](https://github.com/rumankazi/fettle/commit/974428511d650b63f48b1b5026a1758c772180f7))
* **ci:** tag releases as vX.Y.Z, not fettle-vX.Y.Z ([29a3376](https://github.com/rumankazi/fettle/commit/29a3376de28c71cd27b8b8efb838b07a740381f2))

## [0.1.1](https://github.com/rumankazi/fettle/compare/fettle-v0.1.0...fettle-v0.1.1) (2026-08-15)


### Bug fixes

* **ci:** repair the checks that were failing on every branch ([e9eed5e](https://github.com/rumankazi/fettle/commit/e9eed5e5641c1b53e04a92d0f79b9e95c6be00a7))
* **ci:** stop Prettier failing on the generated changelog ([c889a6e](https://github.com/rumankazi/fettle/commit/c889a6e4c33bc8167cc220b7af9231def632b010))
* **ci:** stop tests pinning the version they are released with ([9744285](https://github.com/rumankazi/fettle/commit/974428511d650b63f48b1b5026a1758c772180f7))
