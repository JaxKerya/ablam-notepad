-- Ads that disappeared from their source.
--
-- Careerjet tracking links (jobviewtrack.com) return 404 as soon as the ad
-- leaves Careerjet's index. Measured 10.11.2026: of 39 stored Careerjet ads,
-- 13 were still in the API results and all 13 links worked; the other 26 were
-- missing from the API and all 26 links returned 404 (no mismatch). The worker
-- now compares each complete Careerjet scan with the stored ads and stamps the
-- missing ones here; the page hides them from the list like an expired deadline.
-- The row is kept (feedback and applications stay intact). If the ad shows up
-- again, the worker clears the stamp.

alter table kariyer_ilanlar add column if not exists kaldirildi timestamptz;
