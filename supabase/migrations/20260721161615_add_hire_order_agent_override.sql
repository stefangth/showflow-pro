alter table public.hire_orders
  add column agent_name text,
  add column agent_email text;

comment on column public.hire_orders.agent_name is
  'Per-order booking-agent name override. NULL inherits the org hire_order_letterhead default; empty string prints no agent.';
comment on column public.hire_orders.agent_email is
  'Per-order booking-agent email override. NULL inherits the org hire_order_letterhead default; empty string prints no agent.';
