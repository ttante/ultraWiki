#!/usr/bin/env bash
set -euo pipefail

alert_file="infra/monitoring/prometheus/alerts/outcomes-slo-alerts.yml"

if [[ ! -f "$alert_file" ]]; then
  echo "missing alert rules file: $alert_file"
  exit 1
fi

awk '
function trim(s) {
  sub(/^[[:space:]]+/, "", s);
  sub(/[[:space:]]+$/, "", s);
  return s;
}
function report(msg) {
  printf "policy violation: alert %s %s\n", alert_name, msg;
  failed = 1;
}
function validate_current() {
  if (!in_alert) return;

  if (!has_owner) report("missing owner label");
  if (!has_runbook) report("missing runbook annotation");

  if (severity == "") {
    report("missing severity label");
    return;
  }

  if (severity == "page") {
    if (!has_page_service) report("severity=page requires page_service label");
    if (!has_escalation_target) report("severity=page requires escalation_target annotation");
  } else if (severity == "ticket") {
    if (!has_ticket_queue) report("severity=ticket requires ticket_queue label");
    if (!has_escalation_target) report("severity=ticket requires escalation_target annotation");
  } else if (severity == "info") {
    if (!has_notify_channel) report("severity=info requires notify_channel label");
  } else {
    report("has unsupported severity label");
  }
}
/^[[:space:]]*-[[:space:]]*alert:[[:space:]]*/ {
  validate_current();
  split($0, parts, "alert:");
  alert_name = trim(parts[2]);
  in_alert = 1;

  severity = "";
  has_owner = 0;
  has_runbook = 0;
  has_page_service = 0;
  has_ticket_queue = 0;
  has_notify_channel = 0;
  has_escalation_target = 0;
  next;
}
in_alert && /^[[:space:]]*severity:[[:space:]]*/ {
  split($0, parts, "severity:");
  severity = trim(parts[2]);
  gsub(/"/, "", severity);
  next;
}
in_alert && /^[[:space:]]*owner:[[:space:]]*/ { has_owner = 1; next; }
in_alert && /^[[:space:]]*runbook:[[:space:]]*/ { has_runbook = 1; next; }
in_alert && /^[[:space:]]*page_service:[[:space:]]*/ { has_page_service = 1; next; }
in_alert && /^[[:space:]]*ticket_queue:[[:space:]]*/ { has_ticket_queue = 1; next; }
in_alert && /^[[:space:]]*notify_channel:[[:space:]]*/ { has_notify_channel = 1; next; }
in_alert && /^[[:space:]]*escalation_target:[[:space:]]*/ { has_escalation_target = 1; next; }
END {
  validate_current();
  if (failed) exit 1;
}
' "$alert_file"

echo "alert policy checks passed"
