# Verification record — 4 October 2026

## Local implementation evidence

- Python 3.10.12 and standard-library runtime; no packages installed for the project.
- 18 behavior tests passed after implementation and the review fixes. Tests cover cash evidence, currency units, unknown amounts, duplicate receipt rejection, task dependencies, simulation isolation, path containment, dry runs, external-process failures and result validation.
- Local status, daily preparation, fictional fixture preparation and two dry role invocations succeeded. Real data hashes were unchanged.
- Seven native role TOML files and project config parsed successfully. Required role fields and read-only settings were checked against the current official docs and installed CLI help.
- Five repository skills passed the skill-creator frontmatter validator. JSON files parsed and local Markdown file links resolved.
- Codex CLI help/version reported 0.160.0; Git reported 2.34.1. Installation initializes a local repository so codex exec has a Git workspace.
- Separate bounded code/config and business reviews led to fixes for billing unknowns, phase/task alignment, delivery start conditions, agency fallback, full field checks and stale finance instructions.
- A worked fictional buyer rehearsal used a customer assistant and separate QA assistant in the building session. Its revised scoping draft passed review. Actual document processing was not exercised.

## Material limits

No native live CLI model run was performed. Its subprocess-boundary tests use controlled local doubles; authentication, account usage, service availability and model results remain unverified. The agent definitions and skills are ready for use, but parsing their files does not prove a native delegation ran.

No message, application, purchase, publication, client commitment, actual delivery or payment occurred through this installation. The records retain unknowns and zero evidenced receipts. Fictional results are excluded from real state.

The installation record at `INSTALLATION.json` stores the file hashes and the destination verification results. Generated `runs/` artifacts are excluded from the installed source manifest. To repeat the behavior checks, run:

```sh
python3 -m unittest discover -s tests -v
python3 scripts/ultra.py status
```
