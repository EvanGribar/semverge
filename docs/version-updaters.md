# Version file updaters

SemVerge updates built-in package manifests and lockfiles automatically. Use `versionFiles` when a release also owns a version in a Dockerfile, deployment descriptor, generated metadata file, or another repository-controlled file.

```yaml
versionFiles:
  - path: Dockerfile
    format: text
    pattern: "ARG APP_VERSION={{version}}"
  - path: deploy/metadata.yaml
    format: yaml
    property: image.version
  - path: pyproject.toml
    format: toml
    property: project.version
  - path: pom.xml
    format: xml
    xpath: /project/version
```

Paths are repository-relative and cannot be absolute or contain `..` path segments. The file must exist at the release commit. A missing file, selector, or version value fails the plan before SemVerge creates a release PR.

Structured formats use a small property-selector syntax: `version`, `project.version`, `$.release.version`, `items[0].version`, and `metadata["version"]` are supported. JSON and YAML are parsed and serialized deterministically. TOML updates a quoted value in the selected table while preserving surrounding comments and formatting.

Text patterns are literal. The pattern must contain exactly one `{{version}}` placeholder, for example `VERSION={{version}}` or `__version__ = "{{version}}"`. SemVerge does not evaluate user-provided regular expressions, and it refuses a pattern that matches more than one location.

XML selectors are intentionally limited to absolute element paths such as `/project/version`, `/project/properties/version`, or descendant paths such as `//version`. The selected element must be a leaf containing text; attributes, predicates, and mixed markup are rejected so an update cannot silently modify the wrong node.

For a single or fixed workspace release, an unbound file receives the release version. Independent workspaces can bind a file to a package using its id, name, directory, or manifest path:

```yaml
versionFiles:
  - path: packages/web/pom.xml
    format: xml
    xpath: /project/version
    package: packages/web
```

An independent release with more than one resulting version must bind each custom file. This makes the release graph explicit and prevents one package's version from being written into another package's metadata.
