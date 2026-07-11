-- handle-email-unsubscribe upserts { email, reason: 'unsubscribe' } into
-- suppressed_emails, but the reason CHECK only allowed ('bounce','complaint','manual').
-- Every one-click List-Unsubscribe was hitting the CHECK violation and returning 500
-- without ever suppressing the address. Widen the constraint to include 'unsubscribe'.
ALTER TABLE public.suppressed_emails DROP CONSTRAINT suppressed_emails_reason_check;
ALTER TABLE public.suppressed_emails ADD CONSTRAINT suppressed_emails_reason_check
  CHECK (reason IN ('bounce','complaint','manual','unsubscribe'));
