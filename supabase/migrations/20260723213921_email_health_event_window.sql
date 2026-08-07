-- The health window measures the most recent lifecycle observation, not when the
-- email was originally queued. Resend can report delivery after a send has left
-- the selected window; filtering on created_at then falsely reports that event
-- as missing.
CREATE OR REPLACE FUNCTION public.email_health_snapshot(p_window_minutes int DEFAULT 1440)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH w AS (
    SELECT *
    FROM (
      SELECT *, COALESCE(
        delivered_at,
        bounced_at,
        complained_at,
        delayed_at,
        sent_at,
        created_at
      ) AS observed_at
      FROM public.email_send_log
    ) AS lifecycle
    WHERE observed_at >= now() - make_interval(mins => p_window_minutes)
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
        'status', i.status, 'error_message', i.error_message, 'occurred_at', i.observed_at)
        ORDER BY i.observed_at DESC)
      FROM (
        SELECT recipient_email, template_name, status, error_message, observed_at
        FROM w WHERE status IN ('failed','bounced','complained','suppressed')
        ORDER BY observed_at DESC LIMIT 25
      ) i), '[]'::jsonb)
  )
  FROM agg a;
$$;
