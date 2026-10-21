#!/usr/bin/env bash
# Free-tier alerts the clouds raise themselves (task 5.7). Run once, after section 7 of
# docs/DEPLOY.md, with gcloud signed in to the project:
#
#   PROJECT=my-project BILLING_ACCOUNT=0123-4567-89AB ALERT_EMAIL=you@example.com ops/alerts.sh
#
# The API alerts on what it can count (emails, FoodData Central calls, database size; see
# api/app/usage.py). This sets up the rest, each at 70% of the free tier:
#   - Cloud Run requests: 2 million a month, so 46,667 a day
#   - Cloud Run CPU: 180,000 vCPU-seconds a month, so 4,200 a day
#   - Cloud Storage (backups): 5 GB, so 3.5 GB
#   - Any spend at all: a $1 budget with a 70% threshold
set -euo pipefail

: "${PROJECT:?PROJECT is the Google Cloud project id}"
: "${BILLING_ACCOUNT:?BILLING_ACCOUNT is the billing account id}"
: "${ALERT_EMAIL:?ALERT_EMAIL gets the alerts}"

channel="$(gcloud beta monitoring channels create --project="$PROJECT" \
  --display-name="TRIM free-tier alerts" --type=email \
  --channel-labels=email_address="$ALERT_EMAIL" --format='value(name)')"

policy() { # name, metric filter, aligner, threshold
  gcloud alpha monitoring policies create --project="$PROJECT" --notification-channels="$channel" \
    --policy-from-file=<(cat <<JSON
{
  "displayName": "TRIM: $1 at 70% of the free tier",
  "combiner": "OR",
  "conditions": [{
    "displayName": "$1",
    "conditionThreshold": {
      "filter": "$2",
      "aggregations": [{"alignmentPeriod": "86400s", "perSeriesAligner": "$3",
                        "crossSeriesReducer": "REDUCE_SUM"}],
      "comparison": "COMPARISON_GT",
      "thresholdValue": $4,
      "duration": "0s"
    }
  }]
}
JSON
)
}

policy "Cloud Run requests a day" \
  'resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\"' \
  ALIGN_SUM 46667
policy "Cloud Run CPU seconds a day" \
  'resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/container/billable_instance_time\"' \
  ALIGN_SUM 4200
policy "Backup storage" \
  'resource.type = \"gcs_bucket\" AND metric.type = \"storage.googleapis.com/storage/total_bytes\"' \
  ALIGN_MAX 3758096384

gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="TRIM: any spend" --budget-amount=1USD \
  --threshold-rule=percent=0.7 --threshold-rule=percent=1.0 \
  --filter-projects="projects/$PROJECT"

echo "Alerts set up. Cloudflare and Neon need two settings in their dashboards (docs/DEPLOY.md, section 9)."
