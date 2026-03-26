-- Step 1: Mark all current active users as community members with unlimited access
UPDATE profiles 
SET is_community_member = true 
WHERE is_active = true;

-- Step 2: Update the handle_new_user trigger to auto-activate trial users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, role, is_active, credits_remaining, is_community_member)
  VALUES (
    NEW.id, 
    NEW.email,
    CASE WHEN NEW.email IN ('admin@example.com', 'nico@airankingskool.com') THEN 'admin'::app_role ELSE 'user'::app_role END,
    true,  -- Auto-activate all new users
    5,     -- 5 free credits for trial users
    false  -- New users start as trial, not community members
  );
  RETURN NEW;
END;
$function$;