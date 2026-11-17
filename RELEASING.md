# Releasing smartPOA

1. Bump `version` in `docs/assets/config.js` and every `?v=` in `docs/app/index.html`.
2. Set the same `version` at the top of `docs/app/version.json` and add a release entry (newest first) with plain-language items. Use `roles` (for example `["owner"]` or `["examiner"]`) for items only some users should see.
3. Push to `main`. Open apps check `version.json` on start, when brought back to the foreground and every 5 minutes. They update automatically when nothing is being edited, otherwise they show an Update button. Users then see What's new once.
