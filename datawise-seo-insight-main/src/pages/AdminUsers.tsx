import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { DataTable } from '@/components/DataTable';
import { downloadCSV } from '@/lib/csvUtils';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Checkbox } from '@/components/ui/checkbox';
import { Trash2, Upload, UserPlus, User, FileCheck, AlertTriangle } from 'lucide-react';

interface Profile {
  id: string;
  user_id: string;
  email: string;
  is_active: boolean;
  role: 'admin' | 'user';
  credits_remaining: number;
  is_community_member: boolean;
  created_at: string;
  updated_at: string;
}

interface CrossCheckResult {
  email: string;
  role: string;
  is_active: boolean;
  is_community_member: boolean;
  user_id: string;
}

const addUserSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  role: z.enum(['admin', 'user'], { required_error: 'Please select a role' }),
  password: z.string().min(8, 'Password must be at least 8 characters long'),
});

export default function AdminUsers() {
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [communityFile, setCommunityFile] = useState<File | null>(null);
  const [crossCheckResults, setCrossCheckResults] = useState<CrossCheckResult[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [isProcessingCrossCheck, setIsProcessingCrossCheck] = useState(false);
  const [membershipFilter, setMembershipFilter] = useState<'all' | 'community' | 'non-community'>('all');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const communityFileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Form for manual user addition
  const form = useForm<z.infer<typeof addUserSchema>>({
    resolver: zodResolver(addUserSchema),
    defaultValues: {
      email: '',
      role: 'user',
      password: '',
    },
  });

  // Fetch all profiles with roles and emails
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['profiles'],
    queryFn: async () => {
      // Fetch profiles
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch roles for all users
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('user_id, role');

      const rolesMap = new Map(rolesData?.map(r => [r.user_id, r.role]) || []);

      // Fetch emails from auth.users via edge function
      const { data: emailsData, error: emailsError } = await supabase.functions.invoke('get-user-emails');
      
      if (emailsError) {
        console.error('Error fetching emails:', emailsError);
        toast({
          variant: "destructive",
          title: "Warning",
          description: "Failed to fetch user emails. Some information may be missing.",
        });
      }

      const emailsMap = new Map(
        emailsData?.users?.map((u: any) => [u.user_id, u.email]) || []
      );

      return profilesData.map(profile => ({
        ...profile,
        role: rolesMap.get(profile.user_id) || 'user',
        email: emailsMap.get(profile.user_id) || 'Unknown',
      })) as Profile[];
    },
  });

  // Toggle community member status
  const toggleCommunityMutation = useMutation({
    mutationFn: async ({ userId, isCommunityMember }: { userId: string; isCommunityMember: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_community_member: isCommunityMember })
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast({
        title: "User updated",
        description: "Community member status has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  // Toggle user active status
  const toggleUserMutation = useMutation({
    mutationFn: async ({ userId, isActive }: { userId: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: isActive })
        .eq('user_id', userId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast({
        title: "User updated",
        description: "User status has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  // Add single user
  const addUserMutation = useMutation({
    mutationFn: async (userData: z.infer<typeof addUserSchema>) => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`https://tjizedjqkcnzfnwlejwh.supabase.co/functions/v1/create-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(userData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to create user');
      }

      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      form.reset();
      toast({
        title: "User created",
        description: "User has been created successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  // Delete user
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      const session = await supabase.auth.getSession();
      if (!session.data.session) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`https://tjizedjqkcnzfnwlejwh.supabase.co/functions/v1/delete-user`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.data.session.access_token}`,
        },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete user');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      toast({
        title: "User deleted",
        description: "User has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message,
      });
    },
  });

  const handleCsvUpload = async () => {
    if (!csvFile) return;

    setUploading(true);
    try {
      const text = await csvFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      const emails = lines.map(line => {
        const email = line.split(',')[0].trim().replace(/"/g, '');
        return email;
      }).filter(email => email && email.includes('@'));

      if (emails.length === 0) {
        throw new Error('No valid emails found in CSV file');
      }

      // Create users in batches
      const results = [];
      for (const email of emails) {
        try {
          const tempPassword = Math.random().toString(36).slice(-8) + 'A1!';
          const { data, error } = await supabase.auth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
          });

          if (error) {
            results.push({ email, status: 'error', error: error.message });
          } else {
            results.push({ email, status: 'success', tempPassword });
          }
        } catch (err: any) {
          results.push({ email, status: 'error', error: err.message });
        }
      }

      const successful = results.filter(r => r.status === 'success');
      const failed = results.filter(r => r.status === 'error');

      toast({
        title: "CSV Upload Complete",
        description: `${successful.length} users created successfully, ${failed.length} failed.`,
      });

      // Download results CSV
      if (results.length > 0) {
        downloadCSV(results, 'user-upload-results');
      }

      queryClient.invalidateQueries({ queryKey: ['profiles'] });
      setCsvFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error.message,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleExportUsers = () => {
    const exportData = profiles.map(profile => ({
      email: profile.email,
      role: profile.role,
      is_active: profile.is_active,
      created_at: new Date(profile.created_at).toLocaleDateString(),
    }));
    downloadCSV(exportData, 'users-export');
  };

  const onSubmitUser = (values: z.infer<typeof addUserSchema>) => {
    addUserMutation.mutate(values);
  };

  const handleCommunityCheck = async () => {
    if (!communityFile) return;

    setIsProcessingCrossCheck(true);
    try {
      const text = await communityFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      
      // Skip header line and extract emails from 3rd column (index 2)
      const communityEmails = new Set(
        lines.slice(1).map(line => {
          const columns = line.split(',');
          const email = columns[2]?.trim().replace(/"/g, '');
          return email?.toLowerCase();
        }).filter(email => email && email.includes('@'))
      );

      if (communityEmails.size === 0) {
        throw new Error('No valid emails found in community CSV file');
      }

      // Compare with current users
      const results: CrossCheckResult[] = profiles.map(profile => ({
        email: profile.email,
        role: profile.role,
        is_active: profile.is_active,
        is_community_member: communityEmails.has(profile.email.toLowerCase()),
        user_id: profile.user_id,
      }));

      setCrossCheckResults(results);
      setSelectedUsers(new Set());
      setMembershipFilter('all');

      const nonCommunityCount = results.filter(r => !r.is_community_member).length;
      
      toast({
        title: "Cross-check completed",
        description: `Found ${nonCommunityCount} users not in community members list.`,
      });

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Cross-check failed",
        description: error.message,
      });
    } finally {
      setIsProcessingCrossCheck(false);
    }
  };

  const handleSelectNonMembers = () => {
    const nonMemberIds = crossCheckResults
      .filter(result => !result.is_community_member)
      .map(result => result.user_id);
    setSelectedUsers(new Set(nonMemberIds));
  };

  const handleBulkDelete = async () => {
    if (selectedUsers.size === 0) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete ${selectedUsers.size} selected users? This action cannot be undone.`
    );

    if (!confirmDelete) return;

    try {
      for (const userId of selectedUsers) {
        await deleteUserMutation.mutateAsync(userId);
      }
      
      toast({
        title: "Bulk deletion completed",
        description: `${selectedUsers.size} users have been deleted.`,
      });

      setSelectedUsers(new Set());
      setCrossCheckResults([]);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Bulk deletion failed",
        description: error.message,
      });
    }
  };

  const handleExportCrossCheck = () => {
    if (crossCheckResults.length === 0) return;
    
    const exportData = crossCheckResults.map(result => ({
      email: result.email,
      role: result.role,
      is_active: result.is_active,
      is_community_member: result.is_community_member ? 'Yes' : 'No',
      status: result.is_community_member ? 'Safe' : 'Remove Candidate',
    }));
    
    downloadCSV(exportData, 'community-cross-check-results');
  };

  // Prepare data for table
  const tableData = profiles.map(profile => ({
    Email: profile.email,
    Role: profile.role,
    Credits: profile.is_community_member ? '∞ Unlimited' : `${profile.credits_remaining}/5`,
    Community: profile.is_community_member ? 'Yes' : 'No',
    Status: profile.is_active ? 'Active' : 'Inactive',
    'Created At': new Date(profile.created_at).toLocaleDateString(),
    Actions: (
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-[70px]">Active</span>
            <Switch
              checked={profile.is_active}
              onCheckedChange={(checked) => 
                toggleUserMutation.mutate({ userId: profile.user_id, isActive: checked })
              }
              disabled={toggleUserMutation.isPending}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-[70px]">Community</span>
            <Switch
              checked={profile.is_community_member}
              onCheckedChange={(checked) => 
                toggleCommunityMutation.mutate({ userId: profile.user_id, isCommunityMember: checked })
              }
              disabled={toggleCommunityMutation.isPending}
            />
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => deleteUserMutation.mutate(profile.user_id)}
          disabled={deleteUserMutation.isPending}
          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    ),
  }));

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">User Management</h1>
          <p className="text-muted-foreground">Manage user access and permissions</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleExportUsers} variant="outline">
            Export Users
          </Button>
        </div>
      </div>

      {/* Manual User Addition Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Add Single User
          </CardTitle>
          <CardDescription>
            Create a new user account with specific credentials and role.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitUser)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="user@example.com" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="Enter password" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button 
                type="submit" 
                className="w-full"
                disabled={addUserMutation.isPending}
              >
                {addUserMutation.isPending ? 'Creating User...' : 'Create User'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      {/* CSV Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Bulk User Upload
          </CardTitle>
          <CardDescription>
            Upload a CSV file with email addresses to create multiple users at once.
            Each user will be created with a temporary password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="csv-file">CSV File</Label>
            <Input
              id="csv-file"
              type="file"
              accept=".csv"
              ref={fileInputRef}
              onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
            />
            <p className="text-sm text-muted-foreground mt-1">
              CSV should contain one email per line or comma-separated emails
            </p>
          </div>
          <Button 
            onClick={handleCsvUpload}
            disabled={!csvFile || uploading}
            className="w-full"
          >
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </Button>
        </CardContent>
      </Card>

      {/* Community Members Cross-Check Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileCheck className="h-5 w-5" />
            Community Members Cross-Check
          </CardTitle>
          <CardDescription>
            Upload a community members CSV to identify users who are not in your community list.
            Users not found in the community list will be highlighted for potential removal.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="community-csv-file">Community Members CSV File</Label>
            <Input
              id="community-csv-file"
              type="file"
              accept=".csv"
              ref={communityFileInputRef}
              onChange={(e) => setCommunityFile(e.target.files?.[0] || null)}
            />
            <p className="text-sm text-muted-foreground mt-1">
              CSV should have emails in the 3rd column (FirstName, LastName, Email, ...)
            </p>
          </div>
          <Button 
            onClick={handleCommunityCheck}
            disabled={!communityFile || isProcessingCrossCheck}
            className="w-full"
          >
            {isProcessingCrossCheck ? 'Processing...' : 'Run Cross-Check'}
          </Button>

          {crossCheckResults.length > 0 && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div 
                    className={`px-4 py-2 rounded-full border cursor-pointer transition-all ${
                      membershipFilter === 'all' 
                        ? 'bg-primary text-primary-foreground border-primary' 
                        : 'bg-background text-foreground border-border hover:bg-accent'
                    }`}
                    onClick={() => setMembershipFilter('all')}
                  >
                    <span className="text-sm font-medium">Total Users: {crossCheckResults.length}</span>
                  </div>
                  <div 
                    className={`px-4 py-2 rounded-full border cursor-pointer transition-all ${
                      membershipFilter === 'non-community' 
                        ? 'bg-destructive text-destructive-foreground border-destructive' 
                        : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100 dark:bg-red-950 dark:text-red-300 dark:border-red-800 dark:hover:bg-red-900'
                    }`}
                    onClick={() => setMembershipFilter('non-community')}
                  >
                    <span className="text-sm font-medium">Non-Community: {crossCheckResults.filter(r => !r.is_community_member).length}</span>
                  </div>
                  <div 
                    className={`px-4 py-2 rounded-full border cursor-pointer transition-all ${
                      membershipFilter === 'community' 
                        ? 'bg-green-600 text-white border-green-600' 
                        : 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100 dark:bg-green-950 dark:text-green-300 dark:border-green-800 dark:hover:bg-green-900'
                    }`}
                    onClick={() => setMembershipFilter('community')}
                  >
                    <span className="text-sm font-medium">Community Members: {crossCheckResults.filter(r => r.is_community_member).length}</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={handleExportCrossCheck}
                  >
                    Export Results
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={handleBulkDelete}
                    disabled={selectedUsers.size === 0 || deleteUserMutation.isPending}
                  >
                    Delete Selected ({selectedUsers.size})
                  </Button>
                </div>
              </div>

              <div className="max-h-96 overflow-y-auto border rounded-lg">
                <div className="grid gap-2 p-4">
                  {crossCheckResults
                    .filter(result => {
                      if (membershipFilter === 'community') return result.is_community_member;
                      if (membershipFilter === 'non-community') return !result.is_community_member;
                      return true;
                    })
                    .map((result) => (
                    <div 
                      key={result.user_id}
                      className={`flex items-center justify-between p-3 rounded-lg border ${
                        result.is_community_member 
                          ? 'bg-green-50 border-green-200 dark:bg-green-950 dark:border-green-800' 
                          : 'bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Checkbox
                          checked={selectedUsers.has(result.user_id)}
                          onCheckedChange={(checked) => {
                            const newSelected = new Set(selectedUsers);
                            if (checked) {
                              newSelected.add(result.user_id);
                            } else {
                              newSelected.delete(result.user_id);
                            }
                            setSelectedUsers(newSelected);
                          }}
                        />
                        <div className="flex items-center gap-2">
                          {result.is_community_member ? (
                            <FileCheck className="h-4 w-4 text-green-600" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                          )}
                          <span className="font-medium">{result.email}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={result.role === 'admin' ? 'default' : 'secondary'}>
                          {result.role}
                        </Badge>
                        <Badge variant={result.is_active ? 'default' : 'secondary'}>
                          {result.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                        <Badge variant={result.is_community_member ? 'default' : 'destructive'}>
                          {result.is_community_member ? 'Community Member' : 'Not in Community'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            All Users ({profiles.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={tableData}
            title="Users"
            loading={isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}