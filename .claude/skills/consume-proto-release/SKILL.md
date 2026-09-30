---
name: consume-proto-release
description: Upgrade the BSR-generated protobuf-es schema package after a specification Release and swap placeholder types. Use when a new liverty-music/schema version has been published to BSR and frontend code must adopt the generated types.
---

## Consuming New Proto Types (after BSR gen)

The frontend is on **protobuf-es / Connect-ES v2**. The generated code comes from
the single `@buf/liverty-music_schema.bufbuild_es` package (the v2 major folds the
old `connectrpc_es` connect codegen into `protoc-gen-es` output — there is **no**
`connectrpc_es` package anymore; service descriptors are exported from the
`*_service_pb.js` files alongside the messages).

When a specification Release has published new schema to BSR (see the
specification repo's AGENTS.md for the cross-repo release flow), upgrade and
adopt the generated types here:

```bash
# Install the released schema package. @latest now resolves to the v2 build,
# matching the app's @bufbuild/protobuf@^2 — no manual v1-pin dance needed.
npm install @buf/liverty-music_schema.bufbuild_es@latest
make check
```

Then swap the placeholder types for the generated ones at each
`TODO: swap to generated type after BSR gen` marker and run `make check` again.
Open (or push) the PR only after this succeeds — do NOT open a draft PR before
BSR gen completes, as CI will fail on the missing types.
