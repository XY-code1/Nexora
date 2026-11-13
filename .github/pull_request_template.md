## Summary

<!-- What does this change, and why? -->

## Related

<!-- Link the issue, roadmap item, or behaviour contract section. -->

## Checklist

- [ ] Python tests pass (`for t in tests/test_*.py; do python "$t"; done`)
- [ ] `python scripts/check_release.py` passes
- [ ] `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` pass (if the web workspace changed)
- [ ] Behaviour contract / API docs updated (if behaviour changed)
- [ ] `docs/PROJECT_STATUS.md` updated (if a capability changed state)
- [ ] No private Vault data, credentials, or tokens in the diff
