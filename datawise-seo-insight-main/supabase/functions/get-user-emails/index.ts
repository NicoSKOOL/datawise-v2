import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      console.error('Missing environment variables');
      return new Response(
        JSON.stringify({ error: 'Server configuration error' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the authorization header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('No authorization header');
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create client with user's token for authentication
    const supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });

    // Verify the user's JWT and get their user ID
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      console.error('Invalid token:', userError);
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Request from user:', user.id);

    // Check if user is admin using the is_admin function
    const { data: isAdminData, error: adminCheckError } = await supabaseClient
      .rpc('is_admin', { user_uuid: user.id });

    if (adminCheckError) {
      console.error('Error checking admin status:', adminCheckError);
      return new Response(
        JSON.stringify({ error: 'Error verifying permissions' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!isAdminData) {
      console.error('User is not admin:', user.id);
      return new Response(
        JSON.stringify({ error: 'Unauthorized - Admin access required' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Admin verification passed for user:', user.id);

    // Create admin client to access auth.users
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Fetch all users from auth.users using admin API with pagination
    let allUsers: any[] = [];
    let page = 1;
    const perPage = 1000; // Maximum allowed by Supabase

    console.log('Starting to fetch all users with pagination...');

    while (true) {
      const { data: authUsers, error: usersError } = await supabaseAdmin.auth.admin.listUsers({
        page,
        perPage
      });

      if (usersError) {
        console.error('Error fetching users:', usersError);
        return new Response(
          JSON.stringify({ error: 'Error fetching user emails' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      allUsers.push(...authUsers.users);
      console.log(`Fetched page ${page}: ${authUsers.users.length} users (total so far: ${allUsers.length})`);

      // Break if we got fewer users than requested (last page)
      if (authUsers.users.length < perPage) {
        break;
      }

      page++;
    }

    // Map to simpler structure with user_id and email
    const userEmails = allUsers.map((authUser) => ({
      user_id: authUser.id,
      email: authUser.email,
      created_at: authUser.created_at,
    }));

    console.log(`Successfully fetched all ${userEmails.length} user emails across ${page} page(s)`);

    return new Response(
      JSON.stringify({ users: userEmails }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Unexpected error in get-user-emails:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
