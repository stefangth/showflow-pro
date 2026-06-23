-- CLAUDE.md convention: tables with updated_at get the shared touch trigger, so a
-- direct UPDATE that omits the column still bumps the timestamp. The watcher already
-- sets updated_at explicitly on every upsert; this is the safety net for hand-edits.
CREATE TRIGGER set_cron_health_state_updated_at
  BEFORE UPDATE ON public.cron_health_state
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
