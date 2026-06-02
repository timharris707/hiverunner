# Runtime Isolation

HiveRunner is local-first, so the default operator path runs directly on the
user machine. For stronger isolation, use either the Docker entry point or the
experimental Node permission wrapper.

Use Node.js 22 for local installs and builds. The Docker image is pinned to
Node 22, and the package engine intentionally rejects newer unvalidated majors.

## Docker

Build the image:

```bash
docker build -t hiverunner:local .
```

Run it with named volumes and bind the dashboard to local loopback:

```bash
docker run --rm \
  -p 127.0.0.1:3010:3010 \
  -v hiverunner-data:/var/lib/hiverunner/data \
  -v hiverunner-workspaces:/var/lib/hiverunner/workspaces \
  -e MC_API_KEY="$(openssl rand -hex 32)" \
  hiverunner:local
```

Open `http://127.0.0.1:3010`.

The container runs as the unprivileged `node` user and stores mutable runtime
state under `/var/lib/hiverunner`. Keep the host bind on `127.0.0.1` unless you
intend to expose the dashboard beyond the local machine.

## Node Permission Wrapper

For a lighter-weight local guard, build once and start with Node's permission
model:

```bash
npm run build
scripts/run_permissioned_service.sh
```

The wrapper allows reads from the app directory and configured runtime roots,
and writes only to data, workspace, OpenClaw, `.next`, `output`, and temp
directories. Override the same environment variables used by normal startup:

```bash
PORT=3011 \
MC_DATA_DIR=/tmp/hiverunner-data \
MC_WORKSPACE_ROOT=/tmp/hiverunner-workspaces \
scripts/run_permissioned_service.sh
```

Node permissions are useful defense in depth, but they are not a full sandbox.
HiveRunner still needs network, worker, and child-process permissions for the
Next.js server and optional runtime adapters. For shared or untrusted
environments, prefer Docker or a dedicated OS user with restricted filesystem
access.
