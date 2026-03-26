-- Update the existing profile for nico@airankingskool.com to be active and admin
UPDATE public.profiles 
SET is_active = true, role = 'admin'::app_role 
WHERE email = 'nico@airankingskool.com';