## Summary

<!-- What changed and why? Keep it user-visible. -->

## Related issue

<!-- Fixes #123, refs #456, or "none". -->

## Verification

- [ ] `npm run format:check`
- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run check:locales`
- [ ] `npm run check:version`
- [ ] `npm run build`
- [ ] `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml`

## UI changes

<!-- Screenshots for light and dark themes, plus the minimum window size (1024x720) when layout changed. -->

## Checklist

- [ ] The change is focused and does not include unrelated formatting churn.
- [ ] Comments follow the rustdoc/JSDoc convention and describe current behavior only.
- [ ] New behavior has a regression test where practical.
- [ ] New or changed strings exist in both the Russian and the English dictionaries.
- [ ] No secrets, employee data, domain names or personal paths are committed.
- [ ] No generated files (`dist`, `node_modules`, `src-tauri/target`, `src-tauri/gen`) are committed.
