# Copilot instructions

- This repository is a plain static site published from the repository root for GitHub Pages.
- For local preview, prefer running the site from the repo root with `dnx dotnet-serve`.
- Do not reintroduce the removed ASP.NET/.NET host project just for local serving.
- Keep asset and module paths safe for GitHub Pages project-site hosting under the repository subpath (for example `/InfiniteSoldiers/`); avoid root-relative `/...` URLs.
