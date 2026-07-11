-- Raw aggregation over a lookback window. Service-role only (the watcher + the
-- super-admin wrapper). No auth.uid() guard here — access is gated by GRANT.
CREATE OR REPLACE FUNCTION public.email_health_snapshot(p_window_minutes int DEFAULT 1440)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT * FROM public.email_send_log
    WHERE created_at >= now() - make_interval(mins => p_window_minutes)
  ),
  agg AS (
    SELECT
      count(*)                                                              AS attempted,
      count(*) FILTER (WHERE status IN ('sent','delivered','delivery_delayed','bounced','complained')) AS sent,
      count(*) FILTER (WHERE status = 'delivered')       AS delivered,
      count(*) FILTER (WHERE status = 'delivery_delayed') AS delayed,
      count(*) FILTER (WHERE status = 'bounced')         AS bounced,
      count(*) FILTER (WHERE status = 'complained')      AS complained,
      count(*) FILTER (WHERE status = 'failed')          AS failed,
      count(*) FILTER (WHERE status IN ('suppressed','pref_disabled')) AS suppressed,
      max(greatest(delivered_at, bounced_at, complained_at, delayed_at)) AS last_event_at
    FROM w
  )
  SELECT jsonb_build_object(
    'window_minutes', p_window_minutes,
    'attempted', a.attempted, 'sent', a.sent, 'delivered', a.delivered, 'delayed', a.delayed,
    'bounced', a.bounced, 'complained', a.complained, 'failed', a.failed, 'suppressed', a.suppressed,
    'delivery_rate',  CASE WHEN a.sent > 0 THEN a.delivered::numeric  / a.sent ELSE 0 END,
    'bounce_rate',    CASE WHEN a.sent > 0 THEN a.bounced::numeric    / a.sent ELSE 0 END,
    'complaint_rate', CASE WHEN a.sent > 0 THEN a.complained::numeric / a.sent ELSE 0 END,
    'failure_count',  a.failed,
    'last_event_at',  a.last_event_at,
    'by_template', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'template_name', t.template_name,
        'sent',      t.sent, 'delivered', t.delivered, 'bounced', t.bounced, 'failed', t.failed,
        'delivery_rate', CASE WHEN t.sent > 0 THEN t.delivered::numeric / t.sent ELSE 0 END)
        ORDER BY t.sent DESC)
      FROM (
        SELECT template_name,
          count(*) FILTER (WHERE status IN ('sent','delivered','delivery_delayed','bounced','complained')) AS sent,
          count(*) FILTER (WHERE status = 'delivered') AS delivered,
          count(*) FILTER (WHERE status = 'bounced')   AS bounced,
          count(*) FILTER (WHERE status = 'failed')    AS failed
        FROM w GROUP BY template_name
      ) t), '[]'::jsonb),
    'recent_issues', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'recipient_email', i.recipient_email, 'template_name', i.template_name,
        'status', i.status, 'error_message', i.error_message, 'occurred_at', i.created_at)
        ORDER BY i.created_at DESC)
      FROM (
        SELECT recipient_email, template_name, status, error_message, created_at
        FROM w WHERE status IN ('failed','bounced','complained','suppressed')
        ORDER BY created_at DESC LIMIT 25
      ) i), '[]'::jsonb)
  )
  FROM agg a;
$$;
REVOKE ALL ON FUNCTION public.email_health_snapshot(int) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_health_snapshot(int) TO service_role;

-- Super-admin dashboard entry point: wraps the snapshot behind the god-mode gate.
CREATE OR REPLACE FUNCTION public.get_email_health(p_window_minutes int DEFAULT 1440)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN public.email_health_snapshot(p_window_minutes);
END;
$$;
REVOKE ALL ON FUNCTION public.get_email_health(int) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_email_health(int) TO authenticated;
