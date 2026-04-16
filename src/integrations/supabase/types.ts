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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      airtable_sync_log: {
        Row: {
          error_details: string | null
          id: string
          records_processed: number | null
          status: string
          sync_type: string
          synced_at: string
        }
        Insert: {
          error_details?: string | null
          id?: string
          records_processed?: number | null
          status: string
          sync_type: string
          synced_at?: string
        }
        Update: {
          error_details?: string | null
          id?: string
          records_processed?: number | null
          status?: string
          sync_type?: string
          synced_at?: string
        }
        Relationships: []
      }
      artists: {
        Row: {
          bio: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          phone: string | null
          priority_score: number
          skills: string[] | null
          status: Database["public"]["Enums"]["artist_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          phone?: string | null
          priority_score?: number
          skills?: string[] | null
          status?: Database["public"]["Enums"]["artist_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          phone?: string | null
          priority_score?: number
          skills?: string[] | null
          status?: Database["public"]["Enums"]["artist_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      availability: {
        Row: {
          artist_id: string
          created_at: string
          date: string
          id: string
          recurrence_rule: string | null
          status: Database["public"]["Enums"]["availability_status"]
          updated_at: string
        }
        Insert: {
          artist_id: string
          created_at?: string
          date: string
          id?: string
          recurrence_rule?: string | null
          status?: Database["public"]["Enums"]["availability_status"]
          updated_at?: string
        }
        Update: {
          artist_id?: string
          created_at?: string
          date?: string
          id?: string
          recurrence_rule?: string | null
          status?: Database["public"]["Enums"]["availability_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
        ]
      }
      booking_audit_log: {
        Row: {
          action: string
          booking_id: string | null
          created_at: string
          details: Json | null
          id: string
          new_status: Database["public"]["Enums"]["booking_status"] | null
          old_status: Database["public"]["Enums"]["booking_status"] | null
          performed_by: string | null
        }
        Insert: {
          action: string
          booking_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          new_status?: Database["public"]["Enums"]["booking_status"] | null
          old_status?: Database["public"]["Enums"]["booking_status"] | null
          performed_by?: string | null
        }
        Update: {
          action?: string
          booking_id?: string | null
          created_at?: string
          details?: Json | null
          id?: string
          new_status?: Database["public"]["Enums"]["booking_status"] | null
          old_status?: Database["public"]["Enums"]["booking_status"] | null
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "booking_audit_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          artist_id: string
          booked_by: string | null
          cancellation_reason: string | null
          cancelled_at: string | null
          confirmed_at: string | null
          created_at: string
          id: string
          is_understudy: boolean
          notes: string | null
          show_date_id: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          artist_id: string
          booked_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          is_understudy?: boolean
          notes?: string | null
          show_date_id: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          artist_id?: string
          booked_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          id?: string
          is_understudy?: boolean
          notes?: string | null
          show_date_id?: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_show_date_id_fkey"
            columns: ["show_date_id"]
            isOneToOne: false
            referencedRelation: "show_dates"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string | null
          read: boolean
          related_entity_id: string | null
          related_entity_type: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message?: string | null
          read?: boolean
          related_entity_id?: string | null
          related_entity_type?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: string | null
          read?: boolean
          related_entity_id?: string | null
          related_entity_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      show_dates: {
        Row: {
          airtable_record_id: string | null
          created_at: string
          date: string
          end_time: string | null
          id: string
          notes: string | null
          show_id: string
          start_time: string | null
          status: Database["public"]["Enums"]["show_date_status"]
          updated_at: string
          venue_override: string | null
        }
        Insert: {
          airtable_record_id?: string | null
          created_at?: string
          date: string
          end_time?: string | null
          id?: string
          notes?: string | null
          show_id: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["show_date_status"]
          updated_at?: string
          venue_override?: string | null
        }
        Update: {
          airtable_record_id?: string | null
          created_at?: string
          date?: string
          end_time?: string | null
          id?: string
          notes?: string | null
          show_id?: string
          start_time?: string | null
          status?: Database["public"]["Enums"]["show_date_status"]
          updated_at?: string
          venue_override?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "show_dates_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "shows"
            referencedColumns: ["id"]
          },
        ]
      }
      shows: {
        Row: {
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          required_skills: string[] | null
          slots_per_date: number
          status: Database["public"]["Enums"]["show_status"]
          title: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          required_skills?: string[] | null
          slots_per_date?: number
          status?: Database["public"]["Enums"]["show_status"]
          title: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          required_skills?: string[] | null
          slots_per_date?: number
          status?: Database["public"]["Enums"]["show_status"]
          title?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: []
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
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "producer" | "artist"
      artist_status: "active" | "inactive" | "on_leave"
      availability_status: "available" | "unavailable" | "tentative"
      booking_status: "suggested" | "soft_booked" | "confirmed" | "cancelled"
      show_date_status:
        | "open"
        | "partially_filled"
        | "fully_filled"
        | "cancelled"
      show_status: "active" | "archived" | "draft"
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
      app_role: ["admin", "producer", "artist"],
      artist_status: ["active", "inactive", "on_leave"],
      availability_status: ["available", "unavailable", "tentative"],
      booking_status: ["suggested", "soft_booked", "confirmed", "cancelled"],
      show_date_status: [
        "open",
        "partially_filled",
        "fully_filled",
        "cancelled",
      ],
      show_status: ["active", "archived", "draft"],
    },
  },
} as const
