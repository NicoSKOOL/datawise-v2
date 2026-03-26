-- Step 1: Create user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
  UNIQUE(user_id, role)
);

-- Enable RLS on user_roles
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Step 2: Create security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Step 3: Update is_admin() function to use user_roles
CREATE OR REPLACE FUNCTION public.is_admin(user_uuid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 
    FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id
    WHERE ur.user_id = user_uuid 
      AND ur.role = 'admin' 
      AND p.is_active = true
  )
$$;

-- Step 4: Update has_credits() function to use user_roles
CREATE OR REPLACE FUNCTION public.has_credits(user_uuid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_credits INTEGER;
  is_member BOOLEAN;
  user_role app_role;
BEGIN
  SELECT p.credits_remaining, p.is_community_member, ur.role 
  INTO user_credits, is_member, user_role
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id
  WHERE p.user_id = user_uuid;
  
  -- Admins and community members have unlimited credits
  IF user_role = 'admin' OR is_member = true THEN
    RETURN true;
  END IF;
  
  -- Regular users need credits
  RETURN user_credits > 0;
END;
$$;

-- Step 5: Update deduct_credit() function to use user_roles
CREATE OR REPLACE FUNCTION public.deduct_credit(user_uuid uuid, tool text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  user_credits INTEGER;
  is_member BOOLEAN;
  user_role app_role;
BEGIN
  SELECT p.credits_remaining, p.is_community_member, ur.role 
  INTO user_credits, is_member, user_role
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.user_id
  WHERE p.user_id = user_uuid;
  
  -- Admins and community members don't use credits
  IF user_role = 'admin' OR is_member = true THEN
    INSERT INTO public.api_usage (user_id, tool_name, credits_used)
    VALUES (user_uuid, tool, 0);
    RETURN true;
  END IF;
  
  -- Check if user has credits
  IF user_credits <= 0 THEN
    RETURN false;
  END IF;
  
  -- Deduct credit
  UPDATE public.profiles 
  SET credits_remaining = credits_remaining - 1
  WHERE user_id = user_uuid;
  
  -- Log usage
  INSERT INTO public.api_usage (user_id, tool_name, credits_used)
  VALUES (user_uuid, tool, 1);
  
  RETURN true;
END;
$$;

-- Step 6: Migrate existing role data from profiles to user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, role
FROM public.profiles
WHERE role IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- Step 7: Remove role column from profiles
ALTER TABLE public.profiles DROP COLUMN IF EXISTS role;

-- Step 8: Update handle_new_user() trigger function
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
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

  -- Insert profile
  INSERT INTO public.profiles (user_id, email, is_active, credits_remaining, is_community_member)
  VALUES (
    NEW.id, 
    NEW.email,
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

-- Step 9: Add RLS policies for user_roles
CREATE POLICY "Users can view their own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert roles"
ON public.user_roles
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles"
ON public.user_roles
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
ON public.user_roles
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Step 10: Add explicit deny policies for api_usage
CREATE POLICY "Deny all updates on api_usage"
ON public.api_usage
FOR UPDATE
TO authenticated
USING (false);

CREATE POLICY "Deny all deletes on api_usage"
ON public.api_usage
FOR DELETE
TO authenticated
USING (false);