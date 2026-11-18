CREATE TABLE IF NOT EXISTS public.admin_navigation_preferences (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_navigation_preferences_object
    CHECK (jsonb_typeof(preferences) = 'object')
);

ALTER TABLE public.admin_navigation_preferences ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.admin_navigation_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.admin_navigation_preferences TO service_role;

COMMENT ON TABLE public.admin_navigation_preferences IS
  'Per-account desktop and mobile admin navigation layout. Accessed only by authenticated server routes.';
