# Publishing LingxY's public site for Google OAuth

Google's OAuth consent screen requires three publicly reachable HTTPS URLs:
home page, privacy policy, terms of service. The files in this folder
(`index.html`, `privacy.html`, `terms.html`) are drop-in templates for
those pages.

## Fastest path: GitHub Pages from this repo

1. Push this repo to GitHub (or create a new public repo named e.g. `lingxy`).
2. In the repo's GitHub **Settings → Pages**, set:
   - **Source**: `Deploy from a branch`
   - **Branch**: `main`
   - **Folder**: `/docs/public`  *(or copy the three files to the branch root if
     you prefer)*
3. Wait ~1 minute, then visit
   `https://<your-gh-username>.github.io/<repo>/` — you should see the landing
   page with links to Privacy / Terms.

## Google OAuth form entries

Plug these into the App domain panel in the Google Cloud Console:

| Field | Value |
|---|---|
| Application home page | `https://<your-gh-username>.github.io/<repo>/` |
| Application privacy policy link | `https://<your-gh-username>.github.io/<repo>/privacy.html` |
| Application terms of service link | `https://<your-gh-username>.github.io/<repo>/terms.html` |
| Authorized domains | `github.io` (apex only — no scheme, no subpath) |

If you move to a custom domain later (e.g. `lingxy.app`), update those
three URLs and add `lingxy.app` to **Authorized domains**.

## Before you submit for verification

- [ ] Swap the placeholder contact emails in `privacy.html` and
      `terms.html` for a real inbox you monitor.
- [ ] Review the Google-User-Data section of `privacy.html` — the language
      there is deliberately conservative; adjust if your actual data flow
      differs from "local-only processing + on-demand forwarding to AI
      providers you configure".
- [ ] Ensure the LingxY OAuth scopes you request are the minimum needed;
      Google verification turnaround is sharply faster when the scope list
      matches what the app actually uses.
