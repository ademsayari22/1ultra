# Scoped acceptance checks

Use the actual agreed scope. These checks are evidence of a bounded delivery, not proof of
universal OCR accuracy.

- Count input documents/pages/rows and account for included, excluded and deferred entries.
- For checked PDF Offer B, compare every delivered value in every agreed field to its source across the scoped batch, including dates, names, monetary values and identifiers. Record checked cells and discrepancies; resolve or mark exceptions before release.
- For other offers, apply their stated check coverage and record it explicitly.
- Check column mapping, dates/currencies, duplicate keys and conflicting versions.
- Verify blanks/unreadable values appear as review exceptions rather than guessed numbers.
- Check totals only when the source/output semantics justify that comparison.
- Open the actual delivered file and confirm expected columns and source references.
- For a script, check a successful input, an invalid input and a conflict/unreadable case.
- Have ultra_qa inspect the evidence. Adem decides whether to release; record buyer acceptance.

Review status: draft / revise / blocked / ready for owner review.
Evidence, outstanding exceptions and owner decision: fill from the job.
