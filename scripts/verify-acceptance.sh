#!/bin/sh
set -eu
paperwork_verify_root=$(mktemp -d "${TMPDIR:-/tmp}/paperwork-verifier.XXXXXX")
trap 'rm -rf "$paperwork_verify_root"' EXIT HUP INT TERM
paperwork_python=${PAPERWORK_PYTHON:-python3}
"$paperwork_python" -m pip install --disable-pip-version-check --quiet --target "$paperwork_verify_root" PyMuPDF==1.28.2
export PYTHONPATH="$paperwork_verify_root${PYTHONPATH:+:$PYTHONPATH}"
fixture=tests/fixtures/paperwork-fixtures
completed=${1:-output/acceptance/paperwork-lab-interactive-mixed-completed.pdf}
"$paperwork_python" "$fixture/verify_output.py" --fixture-only > output/fixture-preflight.json
if "$paperwork_python" "$fixture/verify_output.py" --completed "$fixture/paperwork-lab-interactive-mixed.pdf" --expected-values "$fixture/expected-fields-example.json" > output/unchanged-source-negative.json; then
  echo 'ERROR: unchanged source passed completed-document acceptance'; exit 1
fi
"$paperwork_python" "$fixture/verify_output.py" --completed "$completed" --expected-values "$fixture/expected-fields-example.json" --report "$(dirname "$completed")/verification.json" > /dev/null
"$paperwork_python" scripts/inspect-output.py "$completed"
