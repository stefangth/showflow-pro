-- pgTAP: skills.archived_at exists and is nullable (soft-archive column).
BEGIN;
SELECT plan(2);

SELECT has_column('public', 'skills', 'archived_at', 'skills has archived_at');
SELECT col_is_null('public', 'skills', 'archived_at', 'skills.archived_at is nullable');

SELECT * FROM finish();
ROLLBACK;
