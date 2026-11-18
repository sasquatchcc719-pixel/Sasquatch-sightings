CREATE POLICY admin_navigation_preferences_no_direct_access
  ON public.admin_navigation_preferences
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);
