export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      api_usage: {
        Row: {
          created_at: string
          credits_used: number
          id: string
          tool_name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_used?: number
          id?: string
          tool_name: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_used?: number
          id?: string
          tool_name?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          credits_remaining: number
          id: string
          is_active: boolean
          is_community_member: boolean
          last_credit_reset: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          credits_remaining?: number
          id?: string
          is_active?: boolean
          is_community_member?: boolean
          last_credit_reset?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          credits_remaining?: number
          id?: string
          is_active?: boolean
          is_community_member?: boolean
          last_credit_reset?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      rank_tracking_history: {
        Row: {
          check_date: string
          competition: number | null
          cpc: number | null
          created_at: string
          estimated_traffic: number | null
          id: string
          previous_rank_absolute: number | null
          rank_absolute: number | null
          rank_group: string | null
          search_volume: number | null
          serp_item_type: string | null
          tracked_keyword_id: string
          url: string | null
        }
        Insert: {
          check_date?: string
          competition?: number | null
          cpc?: number | null
          created_at?: string
          estimated_traffic?: number | null
          id?: string
          previous_rank_absolute?: number | null
          rank_absolute?: number | null
          rank_group?: string | null
          search_volume?: number | null
          serp_item_type?: string | null
          tracked_keyword_id: string
          url?: string | null
        }
        Update: {
          check_date?: string
          competition?: number | null
          cpc?: number | null
          created_at?: string
          estimated_traffic?: number | null
          id?: string
          previous_rank_absolute?: number | null
          rank_absolute?: number | null
          rank_group?: string | null
          search_volume?: number | null
          serp_item_type?: string | null
          tracked_keyword_id?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rank_tracking_history_tracked_keyword_id_fkey"
            columns: ["tracked_keyword_id"]
            isOneToOne: false
            referencedRelation: "tracked_keywords"
            referencedColumns: ["id"]
          },
        ]
      }
      rank_tracking_schedules: {
        Row: {
          created_at: string
          custom_cron: string | null
          frequency: string
          id: string
          is_active: boolean
          last_run_at: string | null
          next_run_at: string
          project_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          custom_cron?: string | null
          frequency: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at: string
          project_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          custom_cron?: string | null
          frequency?: string
          id?: string
          is_active?: boolean
          last_run_at?: string | null
          next_run_at?: string
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rank_tracking_schedules_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "seo_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      rank_tracking_snapshots: {
        Row: {
          avg_position: number | null
          created_at: string
          estimated_traffic: number | null
          gainers_count: number | null
          id: string
          keywords_in_top_10: number | null
          keywords_in_top_20: number | null
          keywords_in_top_3: number | null
          keywords_in_top_50: number | null
          losers_count: number | null
          project_id: string
          snapshot_date: string
          total_keywords: number | null
          visibility_score: number | null
        }
        Insert: {
          avg_position?: number | null
          created_at?: string
          estimated_traffic?: number | null
          gainers_count?: number | null
          id?: string
          keywords_in_top_10?: number | null
          keywords_in_top_20?: number | null
          keywords_in_top_3?: number | null
          keywords_in_top_50?: number | null
          losers_count?: number | null
          project_id: string
          snapshot_date?: string
          total_keywords?: number | null
          visibility_score?: number | null
        }
        Update: {
          avg_position?: number | null
          created_at?: string
          estimated_traffic?: number | null
          gainers_count?: number | null
          id?: string
          keywords_in_top_10?: number | null
          keywords_in_top_20?: number | null
          keywords_in_top_3?: number | null
          keywords_in_top_50?: number | null
          losers_count?: number | null
          project_id?: string
          snapshot_date?: string
          total_keywords?: number | null
          visibility_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "rank_tracking_snapshots_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "seo_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      seo_projects: {
        Row: {
          created_at: string
          id: string
          language_code: string | null
          location_code: number | null
          location_name: string | null
          project_name: string
          updated_at: string
          user_id: string
          website_url: string
        }
        Insert: {
          created_at?: string
          id?: string
          language_code?: string | null
          location_code?: number | null
          location_name?: string | null
          project_name: string
          updated_at?: string
          user_id: string
          website_url: string
        }
        Update: {
          created_at?: string
          id?: string
          language_code?: string | null
          location_code?: number | null
          location_name?: string | null
          project_name?: string
          updated_at?: string
          user_id?: string
          website_url?: string
        }
        Relationships: []
      }
      seo_tasks: {
        Row: {
          category: string
          completed_at: string | null
          created_at: string
          id: string
          is_completed: boolean
          location: string | null
          notes: string | null
          priority: string
          project_id: string
          task_description: string | null
          task_title: string
        }
        Insert: {
          category?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          location?: string | null
          notes?: string | null
          priority?: string
          project_id: string
          task_description?: string | null
          task_title: string
        }
        Update: {
          category?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          is_completed?: boolean
          location?: string | null
          notes?: string | null
          priority?: string
          project_id?: string
          task_description?: string | null
          task_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "seo_tasks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "seo_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      tracked_keywords: {
        Row: {
          created_at: string
          device: string
          id: string
          is_active: boolean
          keyword: string
          language_code: string
          location_code: number
          project_id: string
          search_engine: string
          target_url: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          device?: string
          id?: string
          is_active?: boolean
          keyword: string
          language_code?: string
          location_code?: number
          project_id: string
          search_engine?: string
          target_url?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          device?: string
          id?: string
          is_active?: boolean
          keyword?: string
          language_code?: string
          location_code?: number
          project_id?: string
          search_engine?: string
          target_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tracked_keywords_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "seo_projects"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      deduct_credit: {
        Args: { tool: string; user_uuid: string }
        Returns: boolean
      }
      has_credits: { Args: { user_uuid?: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { user_uuid?: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
    },
  },
} as const
