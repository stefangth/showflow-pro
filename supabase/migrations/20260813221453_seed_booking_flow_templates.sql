-- Platform-owned booking-flow template definitions. Organizations receive a snapshot
-- when a template is selected; this row remains the comparison reference only.
insert into public.app_settings (org_id, key, value)
values (null, 'booking_flow_templates', $$
{
  "classic":{"flow":{"auto_open_tier1":true,"auto_escalate":false,"at_risk_alerts":true,"offer_delivery":"digest","expiry_reminder":false,"artist_acceptance":true,"producer_confirmation":true,"confirmation_digest":true,"understudy_promotion":true,"active":true,"reference_field":{"source":"show"}},"times":{"windowHours":48,"offerDigestHour":19,"confirmationDigestHour":20}},
  "fasttrack":{"flow":{"auto_open_tier1":true,"auto_escalate":true,"at_risk_alerts":true,"offer_delivery":"immediate","expiry_reminder":true,"artist_acceptance":true,"producer_confirmation":false,"confirmation_digest":true,"understudy_promotion":true,"active":true,"reference_field":{"source":"show"}},"times":{"windowHours":48,"offerDigestHour":19,"confirmationDigestHour":20}},
  "direct":{"flow":{"auto_open_tier1":false,"auto_escalate":false,"at_risk_alerts":false,"offer_delivery":"digest","expiry_reminder":false,"artist_acceptance":false,"producer_confirmation":true,"confirmation_digest":true,"understudy_promotion":true,"active":true,"reference_field":{"source":"show"}},"times":{"windowHours":48,"offerDigestHour":19,"confirmationDigestHour":20}},
  "off":{"flow":{"auto_open_tier1":true,"auto_escalate":false,"at_risk_alerts":true,"offer_delivery":"digest","expiry_reminder":false,"artist_acceptance":true,"producer_confirmation":true,"confirmation_digest":true,"understudy_promotion":true,"active":false,"reference_field":{"source":"show"}},"times":{"windowHours":48,"offerDigestHour":19,"confirmationDigestHour":20}}
}
$$::jsonb)
on conflict (org_id, key) do nothing;
