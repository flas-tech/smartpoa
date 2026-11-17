-- Flight Instructor Instrument PTS (FAA-S-8081-9E), airplane and helicopter instrument instructor ratings.
insert into public.standards_docs(id, doc_number, title, kind, certificate, category, edition_date, effective_date, source_url, sha256, retrieved_at, status)
values ('pts9', 'FAA-S-8081-9E', 'Flight Instructor Instrument PTS – Airplane and Helicopter', 'PTS', 'cfii', 'airplane-helicopter', 'November 2023', '2024-05-31',
  'https://www.faa.gov/training_testing/testing/acs/cfi_instrument_pts_9.pdf', '914e574bd152d69d0deeb8c8f5991f8536ffc7ddc2af50721e39e546ba123d80', now(), 'current')
on conflict (id) do update set doc_number = excluded.doc_number, title = excluded.title, sha256 = excluded.sha256, retrieved_at = now(), status = 'current';
