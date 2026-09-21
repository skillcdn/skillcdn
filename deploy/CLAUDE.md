# deploy/ and .github/: rules

Read the root [`CLAUDE.md`](../CLAUDE.md) first. These rules also cover `.github/workflows/`.

- **This repository ends at an image that builds.** Publishing images, registries, deployment pipelines, infrastructure definitions, DNS, CDN, TLS, environment-specific values and rollout automation do not belong here (ADR-0008). Do not add Terraform, CDK, CloudFormation, Kubernetes manifests, registry logins or real hostnames.
- **No identifiers and no cloud credentials.** No workflow here logs in to a cloud account or a registry, and none needs a secret. Account ids, role ARNs, registry hosts, bucket names and domains have no place in this repository, not even as GitHub variables.
- **One image.** Do not add a second Dockerfile or per-role images without an ADR. Roles are container commands.
- **Image hygiene:** non-root user, production dependencies only, no secrets in `ARG` or `ENV` (use BuildKit secret mounts if a build ever needs one), nothing copied that `.dockerignore` should exclude. When you add a file type that must ship (for example migrations), check the package's `files` field.
- **Workflows:** pin every action to a full commit hash with the version in a comment, declare minimal `permissions`, never use `pull_request_target`, never echo secrets, and pass untrusted values (branch names, PR titles) through `env`, not inline in `run`.
- **CI needs no secrets**, so it is safe on pull requests from forks. Keep it that way.
- **Compose files are for development and self-hosting.** Bind ports to `127.0.0.1`; label throwaway credentials as such.
- **Verify what you change.** Build the image and run the smoke test locally (`docker build -f deploy/Dockerfile .`), and bring compose changes up and down once. A workflow edit you could not run must say so in the commit message.
- Keep `deploy/README.md` in step: the environment table, how to build a release and the rollout contract are read by whoever operates the service.
