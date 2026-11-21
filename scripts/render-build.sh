#!/usr/bin/env bash
# Build command of the Render web service (render.yaml). See docs/deploy.md.
#
# One `convex deploy` builds the Next.js app against a Convex deployment and then pushes the
# backend to that same deployment, so the two cannot drift:
#   production (main)  CONVEX_DEPLOY_KEY          the production deployment
#   PR preview         CONVEX_PREVIEW_DEPLOY_KEY  a preview deployment named after the branch,
#                                                 filled by seed:ensure
# A preview instance copies every variable of the base service, the production key included. So
# the mode comes from Render's IS_PULL_REQUEST, and each mode refuses the other mode's key type.
set -euo pipefail

if [ "${IS_PULL_REQUEST:-false}" = true ]; then
  kind=preview
  key=${CONVEX_PREVIEW_DEPLOY_KEY:?is not set on the Render service}
  preview=(--preview-name "$RENDER_GIT_BRANCH" --preview-run seed:ensure)
else
  kind=prod
  key=${CONVEX_DEPLOY_KEY:?is not set on the Render service}
  preview=()
fi
if [[ $key != "$kind":* ]]; then
  echo "This is a $kind build, but its Convex deploy key is not a $kind key." >&2
  exit 1
fi

# pnpm asks before it replaces a node_modules that Render cached from another pnpm version.
export CI=true
pnpm_version=$(node -p "require('./package.json').packageManager.split('@')[1]")
if [ "$(pnpm --version 2>/dev/null)" != "$pnpm_version" ]; then
  npm install --global "pnpm@$pnpm_version"
fi
pnpm install --frozen-lockfile

CONVEX_DEPLOY_KEY=$key exec pnpm exec convex deploy \
  --cmd 'pnpm build' --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL "${preview[@]}"
