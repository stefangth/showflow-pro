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
          org_id: string
          records_processed: number | null
          status: string
          sync_type: string
          synced_at: string
        }
        Insert: {
          error_details?: string | null
          id?: string
          org_id: string
          records_processed?: number | null
          status: string
          sync_type: string
          synced_at?: string
        }
        Update: {
          error_details?: string | null
          id?: string
          org_id?: string
          records_processed?: number | null
          status?: string
          sync_type?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "airtable_sync_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      app_settings: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
          org_id: string | null
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
          org_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
          org_id?: string | null
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: [
          {
            foreignKeyName: "app_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      artist_skills: {
        Row: {
          artist_id: string
          created_at: string
          org_id: string
          skill_id: string
        }
        Insert: {
          artist_id: string
          created_at?: string
          org_id: string
          skill_id: string
        }
        Update: {
          artist_id?: string
          created_at?: string
          org_id?: string
          skill_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "artist_skills_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artist_skills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "artist_skills_skill_id_fkey"
            columns: ["skill_id"]
            isOneToOne: false
            referencedRelation: "skills"
            referencedColumns: ["id"]
          },
        ]
      }
      artists: {
        Row: {
          bio: string | null
          cast_role: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          org_id: string
          phone: string | null
          status: Database["public"]["Enums"]["artist_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bio?: string | null
          cast_role?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          org_id: string
          phone?: string | null
          status?: Database["public"]["Enums"]["artist_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bio?: string | null
          cast_role?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          org_id?: string
          phone?: string | null
          status?: Database["public"]["Enums"]["artist_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "artists_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_dates: {
        Row: {
          artist_id: string
          created_at: string
          date: string
          id: string
          org_id: string
          reason: string | null
        }
        Insert: {
          artist_id: string
          created_at?: string
          date: string
          id?: string
          org_id: string
          reason?: string | null
        }
        Update: {
          artist_id?: string
          created_at?: string
          date?: string
          id?: string
          org_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_dates_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocked_dates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          org_id: string
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
          org_id: string
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
          org_id?: string
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
          {
            foreignKeyName: "booking_audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
          confirmation_digest_sent_at: string | null
          confirmed_at: string | null
          created_at: string
          digest_sent_at: string | null
          id: string
          is_understudy: boolean
          notes: string | null
          offer_expires_at: string | null
          offer_tier: number | null
          offered_at: string | null
          org_id: string
          show_date_id: string
          status: Database["public"]["Enums"]["booking_status"]
          updated_at: string
        }
        Insert: {
          artist_id: string
          booked_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmation_digest_sent_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          digest_sent_at?: string | null
          id?: string
          is_understudy?: boolean
          notes?: string | null
          offer_expires_at?: string | null
          offer_tier?: number | null
          offered_at?: string | null
          org_id: string
          show_date_id: string
          status?: Database["public"]["Enums"]["booking_status"]
          updated_at?: string
        }
        Update: {
          artist_id?: string
          booked_by?: string | null
          cancellation_reason?: string | null
          cancelled_at?: string | null
          confirmation_digest_sent_at?: string | null
          confirmed_at?: string | null
          created_at?: string
          digest_sent_at?: string | null
          id?: string
          is_understudy?: boolean
          notes?: string | null
          offer_expires_at?: string | null
          offer_tier?: number | null
          offered_at?: string | null
          org_id?: string
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
            foreignKeyName: "bookings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
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
      cast_city_priority: {
        Row: {
          cast_id: string
          city_id: string
          created_at: string
          id: string
          org_id: string
          priority: number
          updated_at: string
        }
        Insert: {
          cast_id: string
          city_id: string
          created_at?: string
          id?: string
          org_id: string
          priority: number
          updated_at?: string
        }
        Update: {
          cast_id?: string
          city_id?: string
          created_at?: string
          id?: string
          org_id?: string
          priority?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cast_city_priority_cast_id_fkey"
            columns: ["cast_id"]
            isOneToOne: false
            referencedRelation: "casts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_city_priority_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_city_priority_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      cast_members: {
        Row: {
          artist_id: string
          cast_id: string
          created_at: string
          id: string
          org_id: string
        }
        Insert: {
          artist_id: string
          cast_id: string
          created_at?: string
          id?: string
          org_id: string
        }
        Update: {
          artist_id?: string
          cast_id?: string
          created_at?: string
          id?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cast_members_artist_id_fkey"
            columns: ["artist_id"]
            isOneToOne: false
            referencedRelation: "artists"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_members_cast_id_fkey"
            columns: ["cast_id"]
            isOneToOne: false
            referencedRelation: "casts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cast_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      casts: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          org_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          org_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          org_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "casts_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          body: string
          chat_id: string
          created_at: string
          id: string
          org_id: string
          user_id: string
        }
        Insert: {
          body: string
          chat_id: string
          created_at?: string
          id?: string
          org_id: string
          user_id: string
        }
        Update: {
          body?: string
          chat_id?: string
          created_at?: string
          id?: string
          org_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chat_id_fkey"
            columns: ["chat_id"]
            isOneToOne: false
            referencedRelation: "chats"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      chats: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          org_id: string
          show_date_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id: string
          show_date_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          org_id?: string
          show_date_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chats_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chats_show_date_id_fkey"
            columns: ["show_date_id"]
            isOneToOne: true
            referencedRelation: "show_dates"
            referencedColumns: ["id"]
          },
        ]
      }
      cities: {
        Row: {
          airtable_city_key: string | null
          airtable_record_id: string | null
          created_at: string
          id: string
          name: string
          org_id: string
        }
        Insert: {
          airtable_city_key?: string | null
          airtable_record_id?: string | null
          created_at?: string
          id?: string
          name: string
          org_id: string
        }
        Update: {
          airtable_city_key?: string | null
          airtable_record_id?: string | null
          created_at?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cities_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          id: string
          message: string | null
          org_id: string
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
          org_id: string
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
          org_id?: string
          read?: boolean
          related_entity_id?: string | null
          related_entity_type?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          status: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invitations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_memberships: {
        Row: {
          created_at: string
          id: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          org_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          org_id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          slug: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          slug: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          slug?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      platform_admins: {
        Row: {
          created_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
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
      show_assignments: {
        Row: {
          city_id: string | null
          created_at: string
          id: string
          org_id: string
          producer_user_id: string
          program: string
          sub_program: string | null
        }
        Insert: {
          city_id?: string | null
          created_at?: string
          id?: string
          org_id: string
          producer_user_id: string
          program: string
          sub_program?: string | null
        }
        Update: {
          city_id?: string | null
          created_at?: string
          id?: string
          org_id?: string
          producer_user_id?: string
          program?: string
          sub_program?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "show_assignments_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_assignments_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      show_cast_eligibility: {
        Row: {
          cast_id: string
          city_id: string
          created_at: string
          id: string
          org_id: string
          show_id: string
        }
        Insert: {
          cast_id: string
          city_id: string
          created_at?: string
          id?: string
          org_id: string
          show_id: string
        }
        Update: {
          cast_id?: string
          city_id?: string
          created_at?: string
          id?: string
          org_id?: string
          show_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "show_cast_eligibility_cast_id_fkey"
            columns: ["cast_id"]
            isOneToOne: false
            referencedRelation: "casts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_cast_eligibility_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_cast_eligibility_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_cast_eligibility_show_id_fkey"
            columns: ["show_id"]
            isOneToOne: false
            referencedRelation: "shows"
            referencedColumns: ["id"]
          },
        ]
      }
      show_date_cast_eligibility: {
        Row: {
          cast_id: string
          created_at: string
          id: string
          org_id: string
          show_date_id: string
        }
        Insert: {
          cast_id: string
          created_at?: string
          id?: string
          org_id: string
          show_date_id: string
        }
        Update: {
          cast_id?: string
          created_at?: string
          id?: string
          org_id?: string
          show_date_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "show_date_cast_eligibility_cast_id_fkey"
            columns: ["cast_id"]
            isOneToOne: false
            referencedRelation: "casts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_date_cast_eligibility_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_date_cast_eligibility_show_date_id_fkey"
            columns: ["show_date_id"]
            isOneToOne: false
            referencedRelation: "show_dates"
            referencedColumns: ["id"]
          },
        ]
      }
      show_date_offer_tiers: {
        Row: {
          closed_at: string | null
          escalation_notified_at: string | null
          id: string
          opened_at: string
          opened_by: string | null
          org_id: string
          show_date_id: string
          tier: number
        }
        Insert: {
          closed_at?: string | null
          escalation_notified_at?: string | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          org_id: string
          show_date_id: string
          tier: number
        }
        Update: {
          closed_at?: string | null
          escalation_notified_at?: string | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          org_id?: string
          show_date_id?: string
          tier?: number
        }
        Relationships: [
          {
            foreignKeyName: "show_date_offer_tiers_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_date_offer_tiers_show_date_id_fkey"
            columns: ["show_date_id"]
            isOneToOne: false
            referencedRelation: "show_dates"
            referencedColumns: ["id"]
          },
        ]
      }
      show_dates: {
        Row: {
          airtable_record_id: string | null
          city_id: string | null
          created_at: string
          date: string
          id: string
          notes: string | null
          org_id: string
          session_1: string
          session_2: string | null
          session_3: string | null
          show_id: string
          status: Database["public"]["Enums"]["show_date_status"]
          updated_at: string
          venue: string | null
        }
        Insert: {
          airtable_record_id?: string | null
          city_id?: string | null
          created_at?: string
          date: string
          id?: string
          notes?: string | null
          org_id: string
          session_1: string
          session_2?: string | null
          session_3?: string | null
          show_id: string
          status?: Database["public"]["Enums"]["show_date_status"]
          updated_at?: string
          venue?: string | null
        }
        Update: {
          airtable_record_id?: string | null
          city_id?: string | null
          created_at?: string
          date?: string
          id?: string
          notes?: string | null
          org_id?: string
          session_1?: string
          session_2?: string | null
          session_3?: string | null
          show_id?: string
          status?: Database["public"]["Enums"]["show_date_status"]
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "show_dates_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "show_dates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
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
          airtable_program_key: string | null
          category: string | null
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          main_cast_slots: number | null
          org_id: string
          program: string | null
          required_skills: string[] | null
          status: Database["public"]["Enums"]["show_status"]
          sub_program: string | null
          understudy_slots: number | null
          updated_at: string
        }
        Insert: {
          airtable_program_key?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          main_cast_slots?: number | null
          org_id: string
          program?: string | null
          required_skills?: string[] | null
          status?: Database["public"]["Enums"]["show_status"]
          sub_program?: string | null
          understudy_slots?: number | null
          updated_at?: string
        }
        Update: {
          airtable_program_key?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          main_cast_slots?: number | null
          org_id?: string
          program?: string | null
          required_skills?: string[] | null
          status?: Database["public"]["Enums"]["show_status"]
          sub_program?: string | null
          understudy_slots?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shows_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      skills: {
        Row: {
          created_at: string
          id: string
          name: string
          org_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          org_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          org_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "skills_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_invitation: { Args: { p_token: string }; Returns: string }
      add_platform_admin: { Args: { p_email: string }; Returns: string }
      compute_show_date_status: {
        Args: { p_show_date_id: string }
        Returns: undefined
      }
      expire_soft_bookings: { Args: never; Returns: undefined }
      get_column_descriptions: { Args: never; Returns: Json }
      get_org_airtable_key: { Args: { _org: string }; Returns: string }
      get_org_setting: { Args: { _key: string; _org: string }; Returns: Json }
      has_org_role: {
        Args: {
          _org: string
          _role: Database["public"]["Enums"]["app_role"]
          _uid: string
        }
        Returns: boolean
      }
      is_chat_participant: {
        Args: { _chat_id: string; _user_id: string }
        Returns: boolean
      }
      is_org_member: { Args: { _org: string; _uid: string }; Returns: boolean }
      is_super_admin: { Args: { _uid: string }; Returns: boolean }
      list_org_members: {
        Args: { p_org: string }
        Returns: {
          display_name: string
          email: string
          roles: Database["public"]["Enums"]["app_role"][]
          user_id: string
        }[]
      }
      list_platform_admins: {
        Args: never
        Returns: {
          created_at: string
          email: string
          user_id: string
        }[]
      }
      platform_org_stats: {
        Args: never
        Returns: {
          active_artist_count: number
          bookings_30d: number
          last_activity_at: string
          member_count: number
          name: string
          org_id: string
          slug: string
          status: string
        }[]
      }
      provision_org: {
        Args: {
          p_admin_email: string
          p_name: string
          p_role?: Database["public"]["Enums"]["app_role"]
          p_slug: string
        }
        Returns: Json
      }
      remove_org_member: {
        Args: { p_org: string; p_user: string }
        Returns: undefined
      }
      remove_platform_admin: { Args: { p_user_id: string }; Returns: undefined }
      resolve_show_assignments: {
        Args: {
          p_city_id: string
          p_org: string
          p_program: string
          p_sub_program: string
        }
        Returns: {
          producer_user_id: string
          specificity: number
        }[]
      }
      seed_org_starter_catalog: { Args: { _org: string }; Returns: undefined }
      set_org_airtable_key: {
        Args: { _key: string; _org: string }
        Returns: undefined
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
