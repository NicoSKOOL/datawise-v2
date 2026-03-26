import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    // Check if the requesting user is an admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('No authorization header')
    }

    // Verify the JWT and get the user
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': authHeader,
        'apikey': serviceRoleKey
      }
    })

    if (!userResponse.ok) {
      throw new Error('Authentication failed')
    }

    const userData = await userResponse.json()

    // Verify admin status using REST API - check user_roles table
    const roleResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles?user_id=eq.${userData.id}&select=role`, {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Accept': 'application/vnd.pgrst.object+json'
      }
    })

    if (!roleResponse.ok) {
      throw new Error('Role check failed')
    }

    const roleData = await roleResponse.json()
    
    // Check if user is active admin
    const profileResponse = await fetch(`${supabaseUrl}/rest/v1/profiles?user_id=eq.${userData.id}&select=is_active`, {
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Accept': 'application/vnd.pgrst.object+json'
      }
    })

    if (!profileResponse.ok) {
      throw new Error('Profile check failed')
    }

    const profile = await profileResponse.json()
    if (!roleData || roleData.role !== 'admin' || !profile.is_active) {
      throw new Error('Access denied: Admin privileges required')
    }

    const { email, password, role } = await req.json()

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase configuration missing')
    }

    // Create the user with service role privileges
    const createUserResponse = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true
      })
    })

    if (!createUserResponse.ok) {
      const errorData = await createUserResponse.json()
      throw new Error(`User creation failed: ${JSON.stringify(errorData)}`)
    }

    const newUserData = await createUserResponse.json()

    // Insert role into user_roles table
    const roleInsertResponse = await fetch(`${supabaseUrl}/rest/v1/user_roles`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceRoleKey}`,
        'apikey': serviceRoleKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ 
        user_id: newUserData.id,
        role 
      })
    })

    if (!roleInsertResponse.ok) {
      const errorData = await roleInsertResponse.json()
      throw new Error(`Role insertion failed: ${JSON.stringify(errorData)}`)
    }

    return new Response(
      JSON.stringify({ success: true, user: newUserData }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred'
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})