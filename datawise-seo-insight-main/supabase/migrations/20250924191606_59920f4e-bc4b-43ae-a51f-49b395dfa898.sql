-- Update the handle_new_user function to include the specific admin email
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (user_id, email, role, is_active)
  VALUES (
    NEW.id, 
    NEW.email,
    CASE WHEN NEW.email IN ('admin@example.com', 'nico@airankingskool.com') THEN 'admin'::app_role ELSE 'user'::app_role END,
    CASE WHEN NEW.email IN ('admin@example.com', 'nico@airankingskool.com') THEN true ELSE false END
  );
  RETURN NEW;
END;
$function$;