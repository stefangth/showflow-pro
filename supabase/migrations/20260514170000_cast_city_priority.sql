-- cast_city_priority: defines which cast is offered first (priority 1), second, etc.
-- for a given city. This drives the tier system in the offer engine.
CREATE TABLE public.cast_city_priority (
  id          UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  cast_id     UUID NOT NULL REFERENCES public.casts(id) ON DELETE CASCADE,
  city_id     UUID NOT NULL REFERENCES public.cities(id) ON DELETE CASCADE,
  priority    INT  NOT NULL CHECK (priority >= 1),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT cast_city_priority_cast_city_unique UNIQUE (cast_id, city_id),
  CONSTRAINT cast_city_priority_city_priority_unique UNIQUE (city_id, priority)
);

ALTER TABLE public.cast_city_priority ENABLE ROW LEVEL SECURITY;

-- Admin + producer read
CREATE POLICY "Admins and producers can view cast_city_priority"
ON public.cast_city_priority FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
);

-- Admin + producer insert
CREATE POLICY "Admins and producers can insert cast_city_priority"
ON public.cast_city_priority FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
);

-- Admin + producer update
CREATE POLICY "Admins and producers can update cast_city_priority"
ON public.cast_city_priority FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
);

-- Admin + producer delete
CREATE POLICY "Admins and producers can delete cast_city_priority"
ON public.cast_city_priority FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin') OR
  public.has_role(auth.uid(), 'producer')
);

CREATE TRIGGER update_cast_city_priority_updated_at
BEFORE UPDATE ON public.cast_city_priority
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.cast_city_priority;
