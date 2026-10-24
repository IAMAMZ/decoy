#!/usr/bin/env bash
# Deploy Decoy to Cloud Run: ./deploy.sh <gcp-project-id> [region]
# Builds in Cloud Build (no local Docker), reads BOSON_API_KEY (or VITE_BOSON_API_KEY) from .env.local (or .env).
set -euo pipefail
PROJECT=${1:?usage: ./deploy.sh <gcp-project-id> [region]}
REGION=${2:-us-central1}

KEY=$(cat .env.local .env 2>/dev/null | grep -E '^(VITE_)?BOSON_API_KEY=.' | head -1 | cut -d= -f2-)
[ -n "$KEY" ] || { echo "No BOSON_API_KEY in .env.local or .env"; exit 1; }

# Page settings are baked in at build time; Cloud Build sees only this file (see .gcloudignore).
TOPIC=$(cat .env.local .env 2>/dev/null | grep -E '^VITE_NTFY_TOPIC=.' | head -1 | cut -d= -f2-)
echo "VITE_NTFY_TOPIC=$TOPIC" > .env.production

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"
# One instance: there is one Chrome, and every viewer must see the same screen.
# shortcut: the key is a plain env var (visible to project viewers), move it to Secret Manager if the project is shared.
gcloud run deploy decoy --source . --project "$PROJECT" --region "$REGION" \
  --allow-unauthenticated --min-instances 1 --max-instances 1 --session-affinity \
  --cpu 2 --memory 2Gi --timeout 3600 --no-cpu-throttling --execution-environment gen2 \
  --set-env-vars "BOSON_API_KEY=$KEY"
