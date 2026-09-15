# Explicit resource catalog — first vertical slice

`buddy resources` registers resources explicitly, probes one known health endpoint and selects a compatible fresh resource. No network scan, task dispatch, service restart or effect replay occurs.

## Registration

Write a JSON declaration, then run `buddy resources add resource.json`:

```json
{
  "id": "local-inference",
  "kind": "inference",
  "hostId": "worker-linux",
  "declaredCapabilities": ["text-generation"],
  "endpointRef": "QA_INFERENCE_ORIGIN",
  "healthPath": "/health",
  "permissions": { "probe": true, "use": true },
  "ttlMs": 60000,
  "timeoutMs": 1000
}
```

The endpoint is an environment reference, resolved in the invoking process. For example `QA_INFERENCE_ORIGIN=http://127.0.0.1:11434` (use `/api/tags` for Ollama). Only HTTP(S) origins are accepted, without embedded credentials, path, query or fragment. No endpoint URL is written to the catalog or printed in results. Authentication headers are not supported in this tranche; do not disable a service's authentication to make its probe pass.

Kinds: inference, comfyui, storage, rag, database, docker, code-explorer, camera, microphone. Camera, microphone, storage and database can be inventoried but have no active probe in this tranche. Supported health paths are restricted per service kind. There is no frame/audio acquisition or database-content introspection. Code Explorer declarations require an actual known HTTP health service; an MCP stdio binary alone does not provide one.

## Commands

- `buddy resources schema`: registration fields and kinds.
- `buddy resources list` / `status <id>`: declarations and current freshness, no network call.
- `buddy resources probe <id>`: exactly one explicitly allowed health GET, timeout 50–5000 ms, no redirects, response body discarded.
- `buddy resources select <capability> [--kind <kind>]`: selected resource plus reasons for exclusions. Exit 2 if none eligible.
- `buddy resources remove <id>`: remove declaration and observation. To change configuration/permissions, remove and re-register; old health is not reused.

Outputs are JSON. Catalog: `~/.codebuddy/resources/catalog.json`, owner-only directory/file modes on POSIX, existing atomic-write helper. A cross-process exclusive directory lock rejects simultaneous writers rather than losing changes; it is held across a bounded probe. A crash can leave `catalog.json.lock`: confirm no resources writer is running before removing that lock directory. Existing corrupt data is rejected and never silently replaced. Windows still requires suitable user-profile ACLs; POSIX mode bits are not an ACL guarantee.

## Observation semantics

Capabilities and host identity are declared, not discovered or attested. HTTP success means only that this health path answered successfully. `usageConfirmed: false` does not become true because a model name appears in a catalog. No inference/request is sent to verify a model.

`checkedAt` is written only on a probe; reading does not extend TTL. `lastSeen` is the last successful health response for this endpoint fingerprint. Expired or future observations become stale. Missing/changed environment endpoints invalidate selection. Unknown/offline/stale states and denied use permissions are excluded with an explanation.

Load is `null`: no inferred remote RAM, no fabricated free-capacity value. Selection uses fresh health, declared capability/kind, use permission and measured latency with stable ID tie-breaking. This is endpoint failover selection, not load balancing from actual host utilisation. No scheduler reservation, coordinator high availability or exactly-once effect guarantee is implemented.

## Validation

Focused tests cover real local endpoints, shutdown/failover, TTL, endpoint changes, permissions, redirects, timeout, concurrent writers, corruption and private storage. `scripts/qa/resource-catalog-live.py` runs the compiled CLI in a disposable HOME against two real loopback HTTP servers, stops the selected endpoint, probes it again and proves selection of the other. It sends health GETs only and performs zero business operations.

Next integration: expose inventory/status/selection to Buddy tools while retaining declaration/probe/use distinctions and approval policy; add actual opt-in load collectors with independent freshness before promising load-aware balancing. Network discovery and automatic retries remain separate work.
