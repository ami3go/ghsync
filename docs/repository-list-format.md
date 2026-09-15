# Repository list format

GitHub Sync exposes repository list import and export under Cockpit **Settings → Repository list**. Lists are UTF-8 tab-separated text.

```text
# GitHub Sync repository list v1
# repository<TAB>clone-url
owner/repository<TAB>git@github.com:owner/repository.git
```

Blank lines and lines beginning with `#` are ignored on import. Repository names must be `owner/repository` and use only letters, numbers, `.`, `_`, or `-`. Duplicate repository names are collapsed to the last URL in the file.

Export removes credentials, query strings, and fragments from URL-style origins before writing them to disk. Import passes clone URLs directly to `git clone` without invoking a shell and constrains clone destinations to the configured repository root.
