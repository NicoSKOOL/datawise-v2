-- Remove email column from profiles table
-- This improves security by storing emails only in Supabase's auth.users table
ALTER TABLE public.profiles DROP COLUMN IF EXISTS email;

-- Update handle_new_user trigger function to not insert email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_role app_role;
BEGIN
  -- Determine role based on email
  IF NEW.email IN ('admin@example.com', 'nico@airankingskool.com') THEN
    new_role := 'admin'::app_role;
  ELSE
    new_role := 'user'::app_role;
  END IF;

  -- Insert profile WITHOUT email (email stays in auth.users)
  INSERT INTO public.profiles (user_id, is_active, credits_remaining, is_community_member)
  VALUES (
    NEW.id, 
    true,
    5,
    false
  );

  -- Insert role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, new_role);

  RETURN NEW;
END;
$$;