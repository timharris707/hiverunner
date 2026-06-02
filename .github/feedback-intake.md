# Feedback Intake

## Suggested Labels

These labels are referenced by the issue forms. They are suggestions only; create
or tune them in GitHub when repository maintainers are ready.

| Label | Purpose |
|---|---|
| `bug` | Reproducible broken behavior or regression. |
| `enhancement` | Feature requests and product improvements. |
| `first-run` | Fresh-clone setup and onboarding feedback. |
| `feedback` | General user feedback that is not yet a scoped bug or feature. |
| `needs-triage` | New intake that needs owner review and routing. |
| `diagnostics-needed` | Reporter needs to add logs, lane status, or environment details. |
| `local-runtime` | Issues involving lanes, ports, optional CLIs, or local runtime readiness. |
| `docs` | README, setup docs, or troubleshooting guidance. |

## Prefilled Issue Links

Use these URLs for future in-app feedback links:

- Bug report: https://github.com/harris-autonomous/mission-control/issues/new?template=bug_report.yml&title=%5BBug%5D%3A%20&labels=bug%2Cneeds-triage
- Feature request: https://github.com/harris-autonomous/mission-control/issues/new?template=feature_request.yml&title=%5BFeature%5D%3A%20&labels=enhancement%2Cneeds-triage
- First-run feedback: https://github.com/harris-autonomous/mission-control/issues/new?template=first_run_feedback.yml&title=%5BFirst-run%5D%3A%20&labels=first-run%2Cfeedback%2Cneeds-triage

## In-App Link Integration Note

Worker C did not add an in-app feedback link because the obvious global chrome
and footer areas are active shareability work surfaces. A future UI integration
can use the links above from a non-footer support/help surface, preserving the
current route, lane, and version/build as reporter context when available.
