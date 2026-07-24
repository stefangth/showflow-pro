-- Snapshot the letterhead + terms resolved at issue time, so the countersign
-- re-render (the sign action) reproduces the exact document that was issued and
-- whose hash the signature certificate attests to. Without this, the sign action
-- re-resolves the org's CURRENT letterhead/terms, so an admin editing them between
-- issue and signing would make the signed PDF's body diverge from the issued hash.
-- Null for orders issued before this column existed (the sign action falls back to
-- live resolution for those).
alter table public.hire_orders add column issue_snapshot jsonb;
