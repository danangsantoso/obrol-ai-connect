export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instanciate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      affiliate_commissions: {
        Row: {
          affiliate_id: string
          commission_amount: number
          commission_rate: number
          created_at: string
          id: string
          order_amount: number
          order_id: string
          paid_at: string | null
          status: string
        }
        Insert: {
          affiliate_id: string
          commission_amount: number
          commission_rate: number
          created_at?: string
          id?: string
          order_amount: number
          order_id: string
          paid_at?: string | null
          status?: string
        }
        Update: {
          affiliate_id?: string
          commission_amount?: number
          commission_rate?: number
          created_at?: string
          id?: string
          order_amount?: number
          order_id?: string
          paid_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_commissions_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_links: {
        Row: {
          affiliate_id: string
          clicks: number
          conversions: number
          created_at: string
          id: string
          link_url: string
          product_id: string
        }
        Insert: {
          affiliate_id: string
          clicks?: number
          conversions?: number
          created_at?: string
          id?: string
          link_url: string
          product_id: string
        }
        Update: {
          affiliate_id?: string
          clicks?: number
          conversions?: number
          created_at?: string
          id?: string
          link_url?: string
          product_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_links_affiliate_id_fkey"
            columns: ["affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliates: {
        Row: {
          affiliate_code: string
          bank_account: string | null
          bank_holder_name: string | null
          bank_name: string | null
          commission_rate: number
          created_at: string
          id: string
          master_affiliate_id: string | null
          status: Database["public"]["Enums"]["affiliate_status"]
          total_earnings: number
          total_referrals: number
          updated_at: string
          user_id: string
        }
        Insert: {
          affiliate_code: string
          bank_account?: string | null
          bank_holder_name?: string | null
          bank_name?: string | null
          commission_rate?: number
          created_at?: string
          id?: string
          master_affiliate_id?: string | null
          status?: Database["public"]["Enums"]["affiliate_status"]
          total_earnings?: number
          total_referrals?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          affiliate_code?: string
          bank_account?: string | null
          bank_holder_name?: string | null
          bank_name?: string | null
          commission_rate?: number
          created_at?: string
          id?: string
          master_affiliate_id?: string | null
          status?: Database["public"]["Enums"]["affiliate_status"]
          total_earnings?: number
          total_referrals?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliates_master_affiliate_id_fkey"
            columns: ["master_affiliate_id"]
            isOneToOne: false
            referencedRelation: "affiliates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_base: {
        Row: {
          answer: string
          category: string
          created_at: string
          created_by: string | null
          id: string
          is_active: boolean | null
          question: string
          updated_at: string
        }
        Insert: {
          answer: string
          category: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          question: string
          updated_at?: string
        }
        Update: {
          answer?: string
          category?: string
          created_at?: string
          created_by?: string | null
          id?: string
          is_active?: boolean | null
          question?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_base_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_training_data: {
        Row: {
          answer: string
          category: string | null
          confidence_score: number | null
          created_at: string
          created_by: string | null
          id: string
          is_verified: boolean | null
          question: string
          updated_at: string
        }
        Insert: {
          answer: string
          category?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_verified?: boolean | null
          question: string
          updated_at?: string
        }
        Update: {
          answer?: string
          category?: string | null
          confidence_score?: number | null
          created_at?: string
          created_by?: string | null
          id?: string
          is_verified?: boolean | null
          question?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_training_data_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_sessions: {
        Row: {
          assigned_agent_id: string | null
          created_at: string
          customer_name: string | null
          id: string
          is_ai_active: boolean | null
          last_message_at: string | null
          platform: string
          status: string
          updated_at: string
          user_id: string
          whatsapp_phone: string
        }
        Insert: {
          assigned_agent_id?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          is_ai_active?: boolean | null
          last_message_at?: string | null
          platform?: string
          status?: string
          updated_at?: string
          user_id: string
          whatsapp_phone: string
        }
        Update: {
          assigned_agent_id?: string | null
          created_at?: string
          customer_name?: string | null
          id?: string
          is_ai_active?: boolean | null
          last_message_at?: string | null
          platform?: string
          status?: string
          updated_at?: string
          user_id?: string
          whatsapp_phone?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          created_at: string
          id: string
          is_read: boolean | null
          message_text: string
          metadata: Json | null
          sender_type: string
          session_id: string
          whatsapp_message_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean | null
          message_text: string
          metadata?: Json | null
          sender_type: string
          session_id: string
          whatsapp_message_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean | null
          message_text?: string
          metadata?: Json | null
          sender_type?: string
          session_id?: string
          whatsapp_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["user_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_settings: {
        Row: {
          access_token: string | null
          business_account_id: string | null
          created_at: string
          id: string
          is_active: boolean | null
          phone_number_id: string | null
          updated_at: string
          user_id: string
          verify_token: string | null
          webhook_url: string | null
        }
        Insert: {
          access_token?: string | null
          business_account_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          phone_number_id?: string | null
          updated_at?: string
          user_id: string
          verify_token?: string | null
          webhook_url?: string | null
        }
        Update: {
          access_token?: string | null
          business_account_id?: string | null
          created_at?: string
          id?: string
          is_active?: boolean | null
          phone_number_id?: string | null
          updated_at?: string
          user_id?: string
          verify_token?: string | null
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      generate_affiliate_code: {
        Args: Record<PropertyKey, never>
        Returns: string
      }
    }
    Enums: {
      affiliate_status: "pending" | "active" | "suspended" | "rejected"
      user_role: "admin" | "master_affiliate" | "affiliate" | "customer"
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
      affiliate_status: ["pending", "active", "suspended", "rejected"],
      user_role: ["admin", "master_affiliate", "affiliate", "customer"],
    },
  },
} as const
