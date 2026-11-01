# smartPOA

Smart Plan of Action — checkride plan-of-action builder for designated pilot examiners, flight schools and flight departments. By Flite Line Technologies.

- `docs/` — static web app served by GitHub Pages (`docs/app/` is the signed-in application).
- `supabase/` — database migrations and edge functions (separate Supabase project; all data access enforced by row-level security and MFA).
- `tools/` — scripts that parse the FAA ACS/PTS PDFs into `docs/app/data/standards.json`.

smartPOA documents the design of a plan of action against cited FAA requirements. It is evidence of plan design, not FAA approval. Summaries of FAA documents are unofficial; the current FAA document governs.
