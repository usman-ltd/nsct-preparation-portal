# Publishing portal changes

For changes requested in this portal checkout, run `npm run check` and `npm test`.
After both pass, review the diff, stage only the files belonging to the requested change,
commit with a descriptive message, and push to the configured GitHub upstream unless the
user asks to keep the work local. Never force-push or stage local credentials or student data.
The production branch is `main`. Netlify should deploy pushed changes through its Git integration.
