export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      ai_runs: {
        Row: {
          conversation_id: string | null;
          created_at: string;
          error: string | null;
          id: string;
          input_tokens: number | null;
          kind: string;
          latency_ms: number | null;
          missing_info: string | null;
          model: string | null;
          organization_id: string;
          output_tokens: number | null;
          provider: Database["public"]["Enums"]["ai_provider"] | null;
          question: string | null;
          reason: string | null;
          reply: string | null;
          sources: NonNullable<Json>;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          input_tokens?: number | null;
          kind: string;
          latency_ms?: number | null;
          missing_info?: string | null;
          model?: string | null;
          organization_id: string;
          output_tokens?: number | null;
          provider?: Database["public"]["Enums"]["ai_provider"] | null;
          question?: string | null;
          reason?: string | null;
          reply?: string | null;
          sources?: NonNullable<Json>;
          status: string;
        };
        Update: {
          conversation_id?: string | null;
          created_at?: string;
          error?: string | null;
          id?: string;
          input_tokens?: number | null;
          kind?: string;
          latency_ms?: number | null;
          missing_info?: string | null;
          model?: string | null;
          organization_id?: string;
          output_tokens?: number | null;
          provider?: Database["public"]["Enums"]["ai_provider"] | null;
          question?: string | null;
          reason?: string | null;
          reply?: string | null;
          sources?: NonNullable<Json>;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_runs_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ai_runs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_secrets: {
        Row: {
          api_key_encrypted: string | null;
          organization_id: string;
          stt_api_key_encrypted: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          api_key_encrypted?: string | null;
          organization_id: string;
          stt_api_key_encrypted?: string | null;
          updated_at?: string;
        };
        Update: {
          api_key_encrypted?: string | null;
          organization_id?: string;
          stt_api_key_encrypted?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_secrets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_settings: {
        Row: {
          agent_wait_minutes: number;
          api_key_hint: string | null;
          base_url: string | null;
          bot_name: string;
          enabled: boolean;
          handoff_keywords: string[];
          handoff_message: string;
          handoff_rules: string;
          instructions: string;
          max_auto_replies: number;
          model: string;
          organization_id: string;
          persona: string;
          provider: Database["public"]["Enums"]["ai_provider"];
          reclaim_on_resolve: boolean;
          reply_delay_seconds: number;
          salutation: string;
          simulate_typing: boolean;
          stt_base_url: string | null;
          stt_key_hint: string | null;
          stt_model: string;
          stt_provider: string | null;
          updated_at: string;
          use_emoji: boolean;
          vision_enabled: boolean;
        };
        ComputedFields: never;
        Insert: {
          agent_wait_minutes?: number;
          api_key_hint?: string | null;
          base_url?: string | null;
          bot_name?: string;
          enabled?: boolean;
          handoff_keywords?: string[];
          handoff_message?: string;
          handoff_rules?: string;
          instructions?: string;
          max_auto_replies?: number;
          model?: string;
          organization_id: string;
          persona?: string;
          provider?: Database["public"]["Enums"]["ai_provider"];
          reclaim_on_resolve?: boolean;
          reply_delay_seconds?: number;
          salutation?: string;
          simulate_typing?: boolean;
          stt_base_url?: string | null;
          stt_key_hint?: string | null;
          stt_model?: string;
          stt_provider?: string | null;
          updated_at?: string;
          use_emoji?: boolean;
          vision_enabled?: boolean;
        };
        Update: {
          agent_wait_minutes?: number;
          api_key_hint?: string | null;
          base_url?: string | null;
          bot_name?: string;
          enabled?: boolean;
          handoff_keywords?: string[];
          handoff_message?: string;
          handoff_rules?: string;
          instructions?: string;
          max_auto_replies?: number;
          model?: string;
          organization_id?: string;
          persona?: string;
          provider?: Database["public"]["Enums"]["ai_provider"];
          reclaim_on_resolve?: boolean;
          reply_delay_seconds?: number;
          salutation?: string;
          simulate_typing?: boolean;
          stt_base_url?: string | null;
          stt_key_hint?: string | null;
          stt_model?: string;
          stt_provider?: string | null;
          updated_at?: string;
          use_emoji?: boolean;
          vision_enabled?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "ai_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      api_keys: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          key_hash: string;
          key_prefix: string;
          last_used_at: string | null;
          name: string;
          organization_id: string;
          revoked_at: string | null;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          key_hash: string;
          key_prefix: string;
          last_used_at?: string | null;
          name: string;
          organization_id: string;
          revoked_at?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          key_hash?: string;
          key_prefix?: string;
          last_used_at?: string | null;
          name?: string;
          organization_id?: string;
          revoked_at?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "api_keys_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "api_keys_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      app_config: {
        Row: {
          key: string;
          value: string;
        };
        ComputedFields: never;
        Insert: {
          key: string;
          value: string;
        };
        Update: {
          key?: string;
          value?: string;
        };
        Relationships: [];
      };
      assignment_logs: {
        Row: {
          actor_id: string | null;
          conversation_id: string;
          created_at: string;
          from_assignee_id: string | null;
          from_team_id: string | null;
          id: string;
          note: string | null;
          organization_id: string;
          to_assignee_id: string | null;
          to_team_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          conversation_id: string;
          created_at?: string;
          from_assignee_id?: string | null;
          from_team_id?: string | null;
          id?: string;
          note?: string | null;
          organization_id: string;
          to_assignee_id?: string | null;
          to_team_id?: string | null;
        };
        Update: {
          actor_id?: string | null;
          conversation_id?: string;
          created_at?: string;
          from_assignee_id?: string | null;
          from_team_id?: string | null;
          id?: string;
          note?: string | null;
          organization_id?: string;
          to_assignee_id?: string | null;
          to_team_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "assignment_logs_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_logs_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_logs_from_assignee_id_fkey";
            columns: ["from_assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_logs_from_team_id_fkey";
            columns: ["from_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_logs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_logs_to_assignee_id_fkey";
            columns: ["to_assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "assignment_logs_to_team_id_fkey";
            columns: ["to_team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcast_recipients: {
        Row: {
          broadcast_id: string;
          claimed_at: string | null;
          contact_id: string;
          conversation_id: string | null;
          error: string | null;
          id: string;
          message_id: string | null;
          organization_id: string;
          replied_at: string | null;
          sent_at: string | null;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          broadcast_id: string;
          claimed_at?: string | null;
          contact_id: string;
          conversation_id?: string | null;
          error?: string | null;
          id?: string;
          message_id?: string | null;
          organization_id: string;
          replied_at?: string | null;
          sent_at?: string | null;
          status?: string;
        };
        Update: {
          broadcast_id?: string;
          claimed_at?: string | null;
          contact_id?: string;
          conversation_id?: string | null;
          error?: string | null;
          id?: string;
          message_id?: string | null;
          organization_id?: string;
          replied_at?: string | null;
          sent_at?: string | null;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey";
            columns: ["broadcast_id"];
            isOneToOne: false;
            referencedRelation: "broadcasts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcast_recipients_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      broadcasts: {
        Row: {
          active_within_days: number | null;
          add_opt_out: boolean;
          body: string;
          channel_id: string;
          created_at: string;
          created_by: string | null;
          finished_at: string | null;
          id: string;
          kind: string;
          label_ids: string[];
          name: string;
          only_opt_in: boolean;
          organization_id: string;
          per_minute: number;
          scheduled_at: string | null;
          started_at: string | null;
          status: string;
          template_language: string | null;
          template_name: string | null;
          template_params: string[];
          total: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          active_within_days?: number | null;
          add_opt_out?: boolean;
          body?: string;
          channel_id: string;
          created_at?: string;
          created_by?: string | null;
          finished_at?: string | null;
          id?: string;
          kind?: string;
          label_ids?: string[];
          name: string;
          only_opt_in?: boolean;
          organization_id: string;
          per_minute?: number;
          scheduled_at?: string | null;
          started_at?: string | null;
          status?: string;
          template_language?: string | null;
          template_name?: string | null;
          template_params?: string[];
          total?: number;
          updated_at?: string;
        };
        Update: {
          active_within_days?: number | null;
          add_opt_out?: boolean;
          body?: string;
          channel_id?: string;
          created_at?: string;
          created_by?: string | null;
          finished_at?: string | null;
          id?: string;
          kind?: string;
          label_ids?: string[];
          name?: string;
          only_opt_in?: boolean;
          organization_id?: string;
          per_minute?: number;
          scheduled_at?: string | null;
          started_at?: string | null;
          status?: string;
          template_language?: string | null;
          template_name?: string | null;
          template_params?: string[];
          total?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "broadcasts_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcasts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "broadcasts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      channel_secrets: {
        Row: {
          access_token_encrypted: string | null;
          channel_id: string;
          updated_at: string;
          webhook_secret: string | null;
        };
        ComputedFields: never;
        Insert: {
          access_token_encrypted?: string | null;
          channel_id: string;
          updated_at?: string;
          webhook_secret?: string | null;
        };
        Update: {
          access_token_encrypted?: string | null;
          channel_id?: string;
          updated_at?: string;
          webhook_secret?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "channel_secrets_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: true;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
        ];
      };
      channels: {
        Row: {
          ai_enabled: boolean;
          config: NonNullable<Json>;
          connection_status: string;
          connection_updated_at: string | null;
          created_at: string;
          display_phone: string | null;
          external_id: string | null;
          external_username: string | null;
          id: string;
          instance_name: string | null;
          is_active: boolean;
          name: string;
          organization_id: string;
          page_id: string | null;
          phone_number_id: string | null;
          provider: Database["public"]["Enums"]["channel_provider"];
          updated_at: string;
          waba_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          ai_enabled?: boolean;
          config?: NonNullable<Json>;
          connection_status?: string;
          connection_updated_at?: string | null;
          created_at?: string;
          display_phone?: string | null;
          external_id?: string | null;
          external_username?: string | null;
          id?: string;
          instance_name?: string | null;
          is_active?: boolean;
          name: string;
          organization_id: string;
          page_id?: string | null;
          phone_number_id?: string | null;
          provider?: Database["public"]["Enums"]["channel_provider"];
          updated_at?: string;
          waba_id?: string | null;
        };
        Update: {
          ai_enabled?: boolean;
          config?: NonNullable<Json>;
          connection_status?: string;
          connection_updated_at?: string | null;
          created_at?: string;
          display_phone?: string | null;
          external_id?: string | null;
          external_username?: string | null;
          id?: string;
          instance_name?: string | null;
          is_active?: boolean;
          name?: string;
          organization_id?: string;
          page_id?: string | null;
          phone_number_id?: string | null;
          provider?: Database["public"]["Enums"]["channel_provider"];
          updated_at?: string;
          waba_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "channels_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      contact_labels: {
        Row: {
          contact_id: string;
          label_id: string;
        };
        ComputedFields: never;
        Insert: {
          contact_id: string;
          label_id: string;
        };
        Update: {
          contact_id?: string;
          label_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contact_labels_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contact_labels_label_id_fkey";
            columns: ["label_id"];
            isOneToOne: false;
            referencedRelation: "labels";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          avatar_url: string | null;
          broadcast_opt_out: boolean;
          company: string | null;
          created_at: string;
          custom_fields: NonNullable<Json>;
          email: string | null;
          id: string;
          name: string | null;
          notes: string | null;
          opt_in: boolean;
          organization_id: string;
          profile_name: string | null;
          updated_at: string;
          username: string | null;
          wa_id: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          broadcast_opt_out?: boolean;
          company?: string | null;
          created_at?: string;
          custom_fields?: NonNullable<Json>;
          email?: string | null;
          id?: string;
          name?: string | null;
          notes?: string | null;
          opt_in?: boolean;
          organization_id: string;
          profile_name?: string | null;
          updated_at?: string;
          username?: string | null;
          wa_id: string;
        };
        Update: {
          avatar_url?: string | null;
          broadcast_opt_out?: boolean;
          company?: string | null;
          created_at?: string;
          custom_fields?: NonNullable<Json>;
          email?: string | null;
          id?: string;
          name?: string | null;
          notes?: string | null;
          opt_in?: boolean;
          organization_id?: string;
          profile_name?: string | null;
          updated_at?: string;
          username?: string | null;
          wa_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contacts_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_labels: {
        Row: {
          conversation_id: string;
          label_id: string;
        };
        ComputedFields: never;
        Insert: {
          conversation_id: string;
          label_id: string;
        };
        Update: {
          conversation_id?: string;
          label_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_labels_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_labels_label_id_fkey";
            columns: ["label_id"];
            isOneToOne: false;
            referencedRelation: "labels";
            referencedColumns: ["id"];
          },
        ];
      };
      conversation_resolutions: {
        Row: {
          agent_id: string | null;
          by_ai: boolean;
          conversation_id: string;
          id: string;
          opened_at: string;
          organization_id: string;
          resolved_at: string;
        };
        ComputedFields: never;
        Insert: {
          agent_id?: string | null;
          by_ai?: boolean;
          conversation_id: string;
          id?: string;
          opened_at: string;
          organization_id: string;
          resolved_at?: string;
        };
        Update: {
          agent_id?: string | null;
          by_ai?: boolean;
          conversation_id?: string;
          id?: string;
          opened_at?: string;
          organization_id?: string;
          resolved_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversation_resolutions_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_resolutions_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversation_resolutions_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      conversations: {
        Row: {
          ai_active: boolean;
          ai_busy_until: string | null;
          ai_due_at: string | null;
          ai_engaged: boolean;
          ai_handoff_at: string | null;
          ai_handoff_reason: string | null;
          ai_last_reply_at: string | null;
          ai_pending_at: string | null;
          ai_pending_message_id: string | null;
          ai_reply_count: number;
          assignee_id: string | null;
          channel_id: string;
          contact_id: string;
          created_at: string;
          first_response_at: string | null;
          id: string;
          last_customer_message_at: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          opened_at: string;
          organization_id: string;
          resolved_at: string | null;
          rotated_at: string | null;
          rotation_deadline: string | null;
          status: Database["public"]["Enums"]["conversation_status"];
          team_id: string | null;
          typing_until: string | null;
          unread_count: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          ai_active?: boolean;
          ai_busy_until?: string | null;
          ai_due_at?: string | null;
          ai_engaged?: boolean;
          ai_handoff_at?: string | null;
          ai_handoff_reason?: string | null;
          ai_last_reply_at?: string | null;
          ai_pending_at?: string | null;
          ai_pending_message_id?: string | null;
          ai_reply_count?: number;
          assignee_id?: string | null;
          channel_id: string;
          contact_id: string;
          created_at?: string;
          first_response_at?: string | null;
          id?: string;
          last_customer_message_at?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          opened_at?: string;
          organization_id: string;
          resolved_at?: string | null;
          rotated_at?: string | null;
          rotation_deadline?: string | null;
          status?: Database["public"]["Enums"]["conversation_status"];
          team_id?: string | null;
          typing_until?: string | null;
          unread_count?: number;
          updated_at?: string;
        };
        Update: {
          ai_active?: boolean;
          ai_busy_until?: string | null;
          ai_due_at?: string | null;
          ai_engaged?: boolean;
          ai_handoff_at?: string | null;
          ai_handoff_reason?: string | null;
          ai_last_reply_at?: string | null;
          ai_pending_at?: string | null;
          ai_pending_message_id?: string | null;
          ai_reply_count?: number;
          assignee_id?: string | null;
          channel_id?: string;
          contact_id?: string;
          created_at?: string;
          first_response_at?: string | null;
          id?: string;
          last_customer_message_at?: string | null;
          last_message_at?: string | null;
          last_message_preview?: string | null;
          opened_at?: string;
          organization_id?: string;
          resolved_at?: string | null;
          rotated_at?: string | null;
          rotation_deadline?: string | null;
          status?: Database["public"]["Enums"]["conversation_status"];
          team_id?: string | null;
          typing_until?: string | null;
          unread_count?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "conversations_assignee_id_fkey";
            columns: ["assignee_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "conversations_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      csat_requests: {
        Row: {
          agent_id: string | null;
          answered_at: string | null;
          conversation_id: string;
          created_at: string;
          episode_opened_at: string;
          handled_by_ai: boolean;
          id: string;
          message_id: string | null;
          organization_id: string;
          rating: number | null;
          send_after: string;
          sent_at: string | null;
          status: string;
          thanked: boolean;
        };
        ComputedFields: never;
        Insert: {
          agent_id?: string | null;
          answered_at?: string | null;
          conversation_id: string;
          created_at?: string;
          episode_opened_at: string;
          handled_by_ai?: boolean;
          id?: string;
          message_id?: string | null;
          organization_id: string;
          rating?: number | null;
          send_after?: string;
          sent_at?: string | null;
          status?: string;
          thanked?: boolean;
        };
        Update: {
          agent_id?: string | null;
          answered_at?: string | null;
          conversation_id?: string;
          created_at?: string;
          episode_opened_at?: string;
          handled_by_ai?: boolean;
          id?: string;
          message_id?: string | null;
          organization_id?: string;
          rating?: number | null;
          send_after?: string;
          sent_at?: string | null;
          status?: string;
          thanked?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "csat_requests_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "csat_requests_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "csat_requests_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "csat_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      followup_enrollments: {
        Row: {
          agent_id: string | null;
          attempts: number;
          conversation_id: string;
          current_step: number;
          ended_at: string | null;
          enrolled_by: string | null;
          id: string;
          last_error: string | null;
          next_send_at: string | null;
          organization_id: string;
          replied_after_step: number | null;
          replied_at: string | null;
          sequence_id: string;
          started_at: string;
          status: string;
          steps_total: number;
          stop_reason: string | null;
        };
        ComputedFields: never;
        Insert: {
          agent_id?: string | null;
          attempts?: number;
          conversation_id: string;
          current_step?: number;
          ended_at?: string | null;
          enrolled_by?: string | null;
          id?: string;
          last_error?: string | null;
          next_send_at?: string | null;
          organization_id: string;
          replied_after_step?: number | null;
          replied_at?: string | null;
          sequence_id: string;
          started_at?: string;
          status?: string;
          steps_total: number;
          stop_reason?: string | null;
        };
        Update: {
          agent_id?: string | null;
          attempts?: number;
          conversation_id?: string;
          current_step?: number;
          ended_at?: string | null;
          enrolled_by?: string | null;
          id?: string;
          last_error?: string | null;
          next_send_at?: string | null;
          organization_id?: string;
          replied_after_step?: number | null;
          replied_at?: string | null;
          sequence_id?: string;
          started_at?: string;
          status?: string;
          steps_total?: number;
          stop_reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "followup_enrollments_agent_id_fkey";
            columns: ["agent_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_enrollments_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_enrollments_enrolled_by_fkey";
            columns: ["enrolled_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_enrollments_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_enrollments_sequence_id_fkey";
            columns: ["sequence_id"];
            isOneToOne: false;
            referencedRelation: "followup_sequences";
            referencedColumns: ["id"];
          },
        ];
      };
      followup_sends: {
        Row: {
          created_at: string;
          enrollment_id: string;
          error: string | null;
          id: string;
          message_id: string | null;
          organization_id: string;
          position: number;
          status: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          enrollment_id: string;
          error?: string | null;
          id?: string;
          message_id?: string | null;
          organization_id: string;
          position: number;
          status: string;
        };
        Update: {
          created_at?: string;
          enrollment_id?: string;
          error?: string | null;
          id?: string;
          message_id?: string | null;
          organization_id?: string;
          position?: number;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "followup_sends_enrollment_id_fkey";
            columns: ["enrollment_id"];
            isOneToOne: false;
            referencedRelation: "followup_enrollments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_sends_message_id_fkey";
            columns: ["message_id"];
            isOneToOne: false;
            referencedRelation: "messages";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_sends_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      followup_sequences: {
        Row: {
          ai_personalize: boolean;
          created_at: string;
          created_by: string | null;
          description: string;
          id: string;
          is_active: boolean;
          label_id: string | null;
          name: string;
          organization_id: string;
          send_hour: number | null;
          trigger: string;
          trigger_after_hours: number;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          ai_personalize?: boolean;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          is_active?: boolean;
          label_id?: string | null;
          name: string;
          organization_id: string;
          send_hour?: number | null;
          trigger?: string;
          trigger_after_hours?: number;
          updated_at?: string;
        };
        Update: {
          ai_personalize?: boolean;
          created_at?: string;
          created_by?: string | null;
          description?: string;
          id?: string;
          is_active?: boolean;
          label_id?: string | null;
          name?: string;
          organization_id?: string;
          send_hour?: number | null;
          trigger?: string;
          trigger_after_hours?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "followup_sequences_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_sequences_label_id_fkey";
            columns: ["label_id"];
            isOneToOne: false;
            referencedRelation: "labels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_sequences_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      followup_steps: {
        Row: {
          delay_days: number;
          delay_hours: number;
          id: string;
          message: string;
          organization_id: string;
          position: number;
          sequence_id: string;
          template_language: string | null;
          template_name: string | null;
        };
        ComputedFields: never;
        Insert: {
          delay_days?: number;
          delay_hours?: number;
          id?: string;
          message: string;
          organization_id: string;
          position: number;
          sequence_id: string;
          template_language?: string | null;
          template_name?: string | null;
        };
        Update: {
          delay_days?: number;
          delay_hours?: number;
          id?: string;
          message?: string;
          organization_id?: string;
          position?: number;
          sequence_id?: string;
          template_language?: string | null;
          template_name?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "followup_steps_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "followup_steps_sequence_id_fkey";
            columns: ["sequence_id"];
            isOneToOne: false;
            referencedRelation: "followup_sequences";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_chunks: {
        Row: {
          content: string;
          doc_id: string;
          fts: unknown;
          id: string;
          organization_id: string;
          position: number;
          product_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          content: string;
          doc_id: string;
          fts?: never;
          id?: string;
          organization_id: string;
          position: number;
          product_id?: string | null;
        };
        Update: {
          content?: string;
          doc_id?: string;
          fts?: never;
          id?: string;
          organization_id?: string;
          position?: number;
          product_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_chunks_doc_id_fkey";
            columns: ["doc_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_docs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_chunks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_chunks_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_docs: {
        Row: {
          char_count: number | null;
          content: string;
          created_at: string;
          created_by: string | null;
          file_name: string | null;
          id: string;
          organization_id: string;
          product_id: string | null;
          source: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          char_count?: never;
          content: string;
          created_at?: string;
          created_by?: string | null;
          file_name?: string | null;
          id?: string;
          organization_id: string;
          product_id?: string | null;
          source?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          char_count?: never;
          content?: string;
          created_at?: string;
          created_by?: string | null;
          file_name?: string | null;
          id?: string;
          organization_id?: string;
          product_id?: string | null;
          source?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_docs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_docs_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_docs_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      knowledge_gaps: {
        Row: {
          answer_doc_id: string | null;
          conversation_id: string | null;
          created_at: string;
          id: string;
          last_asked_at: string;
          organization_id: string;
          question: string;
          question_key: string;
          status: string;
          times_asked: number;
        };
        ComputedFields: never;
        Insert: {
          answer_doc_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          id?: string;
          last_asked_at?: string;
          organization_id: string;
          question: string;
          question_key: string;
          status?: string;
          times_asked?: number;
        };
        Update: {
          answer_doc_id?: string | null;
          conversation_id?: string | null;
          created_at?: string;
          id?: string;
          last_asked_at?: string;
          organization_id?: string;
          question?: string;
          question_key?: string;
          status?: string;
          times_asked?: number;
        };
        Relationships: [
          {
            foreignKeyName: "knowledge_gaps_answer_doc_id_fkey";
            columns: ["answer_doc_id"];
            isOneToOne: false;
            referencedRelation: "knowledge_docs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_gaps_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "knowledge_gaps_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      labels: {
        Row: {
          color: string;
          created_at: string;
          id: string;
          in_pipeline: boolean;
          name: string;
          organization_id: string;
          position: number;
        };
        ComputedFields: never;
        Insert: {
          color?: string;
          created_at?: string;
          id?: string;
          in_pipeline?: boolean;
          name: string;
          organization_id: string;
          position?: number;
        };
        Update: {
          color?: string;
          created_at?: string;
          id?: string;
          in_pipeline?: boolean;
          name?: string;
          organization_id?: string;
          position?: number;
        };
        Relationships: [
          {
            foreignKeyName: "labels_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      messages: {
        Row: {
          body: string | null;
          conversation_id: string;
          created_at: string;
          direction: Database["public"]["Enums"]["message_direction"];
          error: Json | null;
          id: string;
          media_filename: string | null;
          media_mime: string | null;
          media_path: string | null;
          metadata: NonNullable<Json>;
          organization_id: string;
          reply_to_wa_id: string | null;
          sender_id: string | null;
          status: Database["public"]["Enums"]["message_status"];
          type: string;
          wa_message_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          body?: string | null;
          conversation_id: string;
          created_at?: string;
          direction: Database["public"]["Enums"]["message_direction"];
          error?: Json | null;
          id?: string;
          media_filename?: string | null;
          media_mime?: string | null;
          media_path?: string | null;
          metadata?: NonNullable<Json>;
          organization_id: string;
          reply_to_wa_id?: string | null;
          sender_id?: string | null;
          status: Database["public"]["Enums"]["message_status"];
          type?: string;
          wa_message_id?: string | null;
        };
        Update: {
          body?: string | null;
          conversation_id?: string;
          created_at?: string;
          direction?: Database["public"]["Enums"]["message_direction"];
          error?: Json | null;
          id?: string;
          media_filename?: string | null;
          media_mime?: string | null;
          media_path?: string | null;
          metadata?: NonNullable<Json>;
          organization_id?: string;
          reply_to_wa_id?: string | null;
          sender_id?: string | null;
          status?: Database["public"]["Enums"]["message_status"];
          type?: string;
          wa_message_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "messages_sender_id_fkey";
            columns: ["sender_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      notes: {
        Row: {
          author_id: string | null;
          body: string;
          conversation_id: string;
          created_at: string;
          id: string;
          mentions: string[];
          organization_id: string;
        };
        ComputedFields: never;
        Insert: {
          author_id?: string | null;
          body: string;
          conversation_id: string;
          created_at?: string;
          id?: string;
          mentions?: string[];
          organization_id: string;
        };
        Update: {
          author_id?: string | null;
          body?: string;
          conversation_id?: string;
          created_at?: string;
          id?: string;
          mentions?: string[];
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notes_author_id_fkey";
            columns: ["author_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notes_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notes_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      oauth_states: {
        Row: {
          created_at: string;
          error: string | null;
          organization_id: string;
          result: Json | null;
          state: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          error?: string | null;
          organization_id: string;
          result?: Json | null;
          state: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          error?: string | null;
          organization_id?: string;
          result?: Json | null;
          state?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "oauth_states_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "oauth_states_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      order_counters: {
        Row: {
          day: string;
          last_number: number;
          organization_id: string;
        };
        ComputedFields: never;
        Insert: {
          day: string;
          last_number?: number;
          organization_id: string;
        };
        Update: {
          day?: string;
          last_number?: number;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_counters_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      order_events: {
        Row: {
          actor_id: string | null;
          created_at: string;
          event: string;
          id: string;
          note: string | null;
          order_id: string;
          organization_id: string;
        };
        ComputedFields: never;
        Insert: {
          actor_id?: string | null;
          created_at?: string;
          event: string;
          id?: string;
          note?: string | null;
          order_id: string;
          organization_id: string;
        };
        Update: {
          actor_id?: string | null;
          created_at?: string;
          event?: string;
          id?: string;
          note?: string | null;
          order_id?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_events_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_events_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_events_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          address: string | null;
          cancel_reason: string | null;
          city: string | null;
          contact_id: string | null;
          conversation_id: string | null;
          courier: string | null;
          courier_service: string | null;
          created_at: string;
          created_by: string | null;
          created_by_ai: boolean;
          currency: string;
          customer_name: string | null;
          discount: number;
          expires_at: string | null;
          id: string;
          items: NonNullable<Json>;
          notes: string | null;
          number: string;
          organization_id: string;
          paid_at: string | null;
          payment_provider: string;
          payment_ref: string | null;
          payment_url: string | null;
          phone: string | null;
          postal_code: string | null;
          shipped_at: string | null;
          shipping_cost: number;
          status: string;
          subtotal: number;
          total: number;
          tracking_number: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          address?: string | null;
          cancel_reason?: string | null;
          city?: string | null;
          contact_id?: string | null;
          conversation_id?: string | null;
          courier?: string | null;
          courier_service?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_ai?: boolean;
          currency?: string;
          customer_name?: string | null;
          discount?: number;
          expires_at?: string | null;
          id?: string;
          items?: NonNullable<Json>;
          notes?: string | null;
          number: string;
          organization_id: string;
          paid_at?: string | null;
          payment_provider?: string;
          payment_ref?: string | null;
          payment_url?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          shipped_at?: string | null;
          shipping_cost?: number;
          status?: string;
          subtotal?: number;
          total?: number;
          tracking_number?: string | null;
          updated_at?: string;
        };
        Update: {
          address?: string | null;
          cancel_reason?: string | null;
          city?: string | null;
          contact_id?: string | null;
          conversation_id?: string | null;
          courier?: string | null;
          courier_service?: string | null;
          created_at?: string;
          created_by?: string | null;
          created_by_ai?: boolean;
          currency?: string;
          customer_name?: string | null;
          discount?: number;
          expires_at?: string | null;
          id?: string;
          items?: NonNullable<Json>;
          notes?: string | null;
          number?: string;
          organization_id?: string;
          paid_at?: string | null;
          payment_provider?: string;
          payment_ref?: string | null;
          payment_url?: string | null;
          phone?: string | null;
          postal_code?: string | null;
          shipped_at?: string | null;
          shipping_cost?: number;
          status?: string;
          subtotal?: number;
          total?: number;
          tracking_number?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      organizations: {
        Row: {
          auto_rotate: boolean;
          business_hours: NonNullable<Json>;
          created_at: string;
          csat_enabled: boolean;
          csat_message: string;
          csat_thanks: string;
          followup_alert_days: number;
          id: string;
          is_active: boolean;
          name: string;
          outside_hours_message: string;
          plan_expires_at: string | null;
          plan_id: string | null;
          retention_days: number;
          rotate_timeout_minutes: number;
          suspended_at: string | null;
          timezone: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          auto_rotate?: boolean;
          business_hours?: NonNullable<Json>;
          created_at?: string;
          csat_enabled?: boolean;
          csat_message?: string;
          csat_thanks?: string;
          followup_alert_days?: number;
          id?: string;
          is_active?: boolean;
          name: string;
          outside_hours_message?: string;
          plan_expires_at?: string | null;
          plan_id?: string | null;
          retention_days?: number;
          rotate_timeout_minutes?: number;
          suspended_at?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Update: {
          auto_rotate?: boolean;
          business_hours?: NonNullable<Json>;
          created_at?: string;
          csat_enabled?: boolean;
          csat_message?: string;
          csat_thanks?: string;
          followup_alert_days?: number;
          id?: string;
          is_active?: boolean;
          name?: string;
          outside_hours_message?: string;
          plan_expires_at?: string | null;
          plan_id?: string | null;
          retention_days?: number;
          rotate_timeout_minutes?: number;
          suspended_at?: string | null;
          timezone?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "organizations_plan_id_fkey";
            columns: ["plan_id"];
            isOneToOne: false;
            referencedRelation: "plans";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_secrets: {
        Row: {
          biteship_api_key: string | null;
          midtrans_server_key: string | null;
          organization_id: string;
          updated_at: string;
          xendit_callback_token: string | null;
          xendit_secret_key: string | null;
        };
        ComputedFields: never;
        Insert: {
          biteship_api_key?: string | null;
          midtrans_server_key?: string | null;
          organization_id: string;
          updated_at?: string;
          xendit_callback_token?: string | null;
          xendit_secret_key?: string | null;
        };
        Update: {
          biteship_api_key?: string | null;
          midtrans_server_key?: string | null;
          organization_id?: string;
          updated_at?: string;
          xendit_callback_token?: string | null;
          xendit_secret_key?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_secrets_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      payment_settings: {
        Row: {
          ai_create_orders: boolean;
          bank_accounts: NonNullable<Json>;
          biteship_key_hint: string | null;
          couriers: string;
          flat_shipping_cost: number;
          invoice_hours: number;
          midtrans_key_hint: string | null;
          midtrans_production: boolean;
          organization_id: string;
          origin_postal_code: string | null;
          payment_note: string;
          provider: string;
          shipping_mode: string;
          updated_at: string;
          xendit_key_hint: string | null;
        };
        ComputedFields: never;
        Insert: {
          ai_create_orders?: boolean;
          bank_accounts?: NonNullable<Json>;
          biteship_key_hint?: string | null;
          couriers?: string;
          flat_shipping_cost?: number;
          invoice_hours?: number;
          midtrans_key_hint?: string | null;
          midtrans_production?: boolean;
          organization_id: string;
          origin_postal_code?: string | null;
          payment_note?: string;
          provider?: string;
          shipping_mode?: string;
          updated_at?: string;
          xendit_key_hint?: string | null;
        };
        Update: {
          ai_create_orders?: boolean;
          bank_accounts?: NonNullable<Json>;
          biteship_key_hint?: string | null;
          couriers?: string;
          flat_shipping_cost?: number;
          invoice_hours?: number;
          midtrans_key_hint?: string | null;
          midtrans_production?: boolean;
          organization_id?: string;
          origin_postal_code?: string | null;
          payment_note?: string;
          provider?: string;
          shipping_mode?: string;
          updated_at?: string;
          xendit_key_hint?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "payment_settings_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      plans: {
        Row: {
          ai_replies_per_month: number | null;
          broadcast_per_month: number | null;
          created_at: string;
          description: string;
          id: string;
          is_default: boolean;
          max_channels: number | null;
          max_users: number | null;
          name: string;
          price_monthly: number;
          trial_days: number;
        };
        ComputedFields: never;
        Insert: {
          ai_replies_per_month?: number | null;
          broadcast_per_month?: number | null;
          created_at?: string;
          description?: string;
          id?: string;
          is_default?: boolean;
          max_channels?: number | null;
          max_users?: number | null;
          name: string;
          price_monthly?: number;
          trial_days?: number;
        };
        Update: {
          ai_replies_per_month?: number | null;
          broadcast_per_month?: number | null;
          created_at?: string;
          description?: string;
          id?: string;
          is_default?: boolean;
          max_channels?: number | null;
          max_users?: number | null;
          name?: string;
          price_monthly?: number;
          trial_days?: number;
        };
        Relationships: [];
      };
      platform_admins: {
        Row: {
          created_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          is_active: boolean;
          keywords: string;
          name: string;
          organization_id: string;
          price: number | null;
          sku: string | null;
          summary: string;
          updated_at: string;
          weight_grams: number;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          currency?: string;
          id?: string;
          is_active?: boolean;
          keywords?: string;
          name: string;
          organization_id: string;
          price?: number | null;
          sku?: string | null;
          summary?: string;
          updated_at?: string;
          weight_grams?: number;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          is_active?: boolean;
          keywords?: string;
          name?: string;
          organization_id?: string;
          price?: number | null;
          sku?: string | null;
          summary?: string;
          updated_at?: string;
          weight_grams?: number;
        };
        Relationships: [
          {
            foreignKeyName: "products_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          avatar_url: string | null;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          is_active: boolean;
          last_rotated_at: string | null;
          max_open_chats: number;
          must_change_password: boolean;
          organization_id: string | null;
          role: Database["public"]["Enums"]["app_role"];
          status: Database["public"]["Enums"]["agent_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          avatar_url?: string | null;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          is_active?: boolean;
          last_rotated_at?: string | null;
          max_open_chats?: number;
          must_change_password?: boolean;
          organization_id?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          status?: Database["public"]["Enums"]["agent_status"];
          updated_at?: string;
        };
        Update: {
          avatar_url?: string | null;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          is_active?: boolean;
          last_rotated_at?: string | null;
          max_open_chats?: number;
          must_change_password?: boolean;
          organization_id?: string | null;
          role?: Database["public"]["Enums"]["app_role"];
          status?: Database["public"]["Enums"]["agent_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      push_config: {
        Row: {
          created_at: string;
          id: number;
          private_jwk: NonNullable<Json>;
          public_key: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: number;
          private_jwk: NonNullable<Json>;
          public_key: string;
        };
        Update: {
          created_at?: string;
          id?: number;
          private_jwk?: NonNullable<Json>;
          public_key?: string;
        };
        Relationships: [];
      };
      push_queue: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          sent_at: string | null;
          tag: string | null;
          title: string;
          url: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          sent_at?: string | null;
          tag?: string | null;
          title: string;
          url?: string;
          user_id: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          sent_at?: string | null;
          tag?: string | null;
          title?: string;
          url?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_queue_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      push_subscriptions: {
        Row: {
          auth: string;
          created_at: string;
          endpoint: string;
          id: string;
          last_used_at: string | null;
          p256dh: string;
          user_agent: string | null;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          auth: string;
          created_at?: string;
          endpoint: string;
          id?: string;
          last_used_at?: string | null;
          p256dh: string;
          user_agent?: string | null;
          user_id: string;
        };
        Update: {
          auth?: string;
          created_at?: string;
          endpoint?: string;
          id?: string;
          last_used_at?: string | null;
          p256dh?: string;
          user_agent?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      quick_replies: {
        Row: {
          body: string;
          created_at: string;
          id: string;
          organization_id: string;
          owner_id: string | null;
          shortcut: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          body: string;
          created_at?: string;
          id?: string;
          organization_id: string;
          owner_id?: string | null;
          shortcut: string;
          updated_at?: string;
        };
        Update: {
          body?: string;
          created_at?: string;
          id?: string;
          organization_id?: string;
          owner_id?: string | null;
          shortcut?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quick_replies_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "quick_replies_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      team_members: {
        Row: {
          created_at: string;
          profile_id: string;
          team_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          profile_id: string;
          team_id: string;
        };
        Update: {
          created_at?: string;
          profile_id?: string;
          team_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "team_members_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "team_members_team_id_fkey";
            columns: ["team_id"];
            isOneToOne: false;
            referencedRelation: "teams";
            referencedColumns: ["id"];
          },
        ];
      };
      teams: {
        Row: {
          created_at: string;
          description: string | null;
          id: string;
          name: string;
          organization_id: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name: string;
          organization_id: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          id?: string;
          name?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "teams_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      templates: {
        Row: {
          category: string | null;
          channel_id: string;
          components: NonNullable<Json>;
          id: string;
          language: string;
          name: string;
          organization_id: string;
          status: string | null;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          category?: string | null;
          channel_id: string;
          components?: NonNullable<Json>;
          id?: string;
          language: string;
          name: string;
          organization_id: string;
          status?: string | null;
          updated_at?: string;
        };
        Update: {
          category?: string | null;
          channel_id?: string;
          components?: NonNullable<Json>;
          id?: string;
          language?: string;
          name?: string;
          organization_id?: string;
          status?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "templates_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "templates_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      tenant_requests: {
        Row: {
          company_name: string;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          note: string | null;
          organization_id: string | null;
          phone: string | null;
          reject_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          company_name: string;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id?: string;
          note?: string | null;
          organization_id?: string | null;
          phone?: string | null;
          reject_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          company_name?: string;
          created_at?: string;
          email?: string;
          full_name?: string | null;
          id?: string;
          note?: string | null;
          organization_id?: string | null;
          phone?: string | null;
          reject_reason?: string | null;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tenant_requests_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      usage_monthly: {
        Row: {
          ai_replies: number;
          broadcast_messages: number;
          month: string;
          organization_id: string;
        };
        ComputedFields: never;
        Insert: {
          ai_replies?: number;
          broadcast_messages?: number;
          month: string;
          organization_id: string;
        };
        Update: {
          ai_replies?: number;
          broadcast_messages?: number;
          month?: string;
          organization_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "usage_monthly_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      webchat_visitors: {
        Row: {
          channel_id: string;
          contact_id: string;
          created_at: string;
          id: string;
          last_seen_at: string;
          page_url: string | null;
          secret_hash: string;
          user_agent: string | null;
        };
        ComputedFields: never;
        Insert: {
          channel_id: string;
          contact_id: string;
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          page_url?: string | null;
          secret_hash: string;
          user_agent?: string | null;
        };
        Update: {
          channel_id?: string;
          contact_id?: string;
          created_at?: string;
          id?: string;
          last_seen_at?: string;
          page_url?: string | null;
          secret_hash?: string;
          user_agent?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "webchat_visitors_channel_id_fkey";
            columns: ["channel_id"];
            isOneToOne: false;
            referencedRelation: "channels";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webchat_visitors_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_deliveries: {
        Row: {
          attempts: number;
          created_at: string;
          delivered_at: string | null;
          error: string | null;
          event: string;
          id: string;
          next_attempt_at: string;
          organization_id: string;
          payload: NonNullable<Json>;
          response_status: number | null;
          status: string;
          webhook_id: string;
        };
        ComputedFields: never;
        Insert: {
          attempts?: number;
          created_at?: string;
          delivered_at?: string | null;
          error?: string | null;
          event: string;
          id?: string;
          next_attempt_at?: string;
          organization_id: string;
          payload: NonNullable<Json>;
          response_status?: number | null;
          status?: string;
          webhook_id: string;
        };
        Update: {
          attempts?: number;
          created_at?: string;
          delivered_at?: string | null;
          error?: string | null;
          event?: string;
          id?: string;
          next_attempt_at?: string;
          organization_id?: string;
          payload?: NonNullable<Json>;
          response_status?: number | null;
          status?: string;
          webhook_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_deliveries_webhook_id_fkey";
            columns: ["webhook_id"];
            isOneToOne: false;
            referencedRelation: "webhooks";
            referencedColumns: ["id"];
          },
        ];
      };
      webhooks: {
        Row: {
          created_at: string;
          description: string | null;
          events: string[];
          id: string;
          is_active: boolean;
          last_delivery_at: string | null;
          last_error: string | null;
          last_status: number | null;
          organization_id: string;
          secret: string;
          url: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          description?: string | null;
          events?: string[];
          id?: string;
          is_active?: boolean;
          last_delivery_at?: string | null;
          last_error?: string | null;
          last_status?: number | null;
          organization_id: string;
          secret?: string;
          url: string;
        };
        Update: {
          created_at?: string;
          description?: string | null;
          events?: string[];
          id?: string;
          is_active?: boolean;
          last_delivery_at?: string | null;
          last_error?: string | null;
          last_status?: number | null;
          organization_id?: string;
          secret?: string;
          url?: string;
        };
        Relationships: [
          {
            foreignKeyName: "webhooks_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: false;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_message_status: {
        Args: {
          p_error: Json;
          p_status: Database["public"]["Enums"]["message_status"];
          p_wa_message_id: string;
        };
        Returns: undefined;
      };
      approve_tenant_request: {
        Args: { request_id: string; tenant_name?: string };
        Returns: string;
      };
      assign_conversation: {
        Args: {
          conv_id: string;
          note?: string;
          to_assignee: string;
          to_team?: string;
        };
        Returns: {
          ai_active: boolean;
          ai_busy_until: string | null;
          ai_due_at: string | null;
          ai_engaged: boolean;
          ai_handoff_at: string | null;
          ai_handoff_reason: string | null;
          ai_last_reply_at: string | null;
          ai_pending_at: string | null;
          ai_pending_message_id: string | null;
          ai_reply_count: number;
          assignee_id: string | null;
          channel_id: string;
          contact_id: string;
          created_at: string;
          first_response_at: string | null;
          id: string;
          last_customer_message_at: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          opened_at: string;
          organization_id: string;
          resolved_at: string | null;
          rotated_at: string | null;
          rotation_deadline: string | null;
          status: Database["public"]["Enums"]["conversation_status"];
          team_id: string | null;
          typing_until: string | null;
          unread_count: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "conversations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      broadcast_audience: {
        Args: {
          p_active_days: number;
          p_channel: string;
          p_label_ids: string[];
          p_only_opt_in: boolean;
          p_org: string;
        };
        Returns: {
          contact_id: string;
        }[];
      };
      broadcast_audience_count: {
        Args: {
          p_active_days: number;
          p_channel: string;
          p_label_ids: string[];
          p_only_opt_in: boolean;
        };
        Returns: number;
      };
      broadcast_claim: {
        Args: { p_id: string; p_limit: number };
        Returns: {
          broadcast_id: string;
          claimed_at: string | null;
          contact_id: string;
          conversation_id: string | null;
          error: string | null;
          id: string;
          message_id: string | null;
          organization_id: string;
          replied_at: string | null;
          sent_at: string | null;
          status: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "broadcast_recipients";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      broadcast_conversation: {
        Args: { p_channel: string; p_contact: string };
        Returns: string;
      };
      broadcast_prepare: { Args: { p_id: string }; Returns: number };
      broadcast_stats: {
        Args: { p_ids: string[] };
        Returns: {
          broadcast_id: string;
          delivered: number;
          failed: number;
          pending: number;
          read: number;
          replied: number;
          sent: number;
        }[];
      };
      can_access_conversation: { Args: { conv_id: string }; Returns: boolean };
      chunk_text: {
        Args: { p_max?: number; p_text: string };
        Returns: string[];
      };
      claim_ai_turn: {
        Args: { p_conversation_id: string };
        Returns: {
          message_id: string;
          outcome: string;
          wait_ms: number;
        }[];
      };
      claim_conversation: {
        Args: { conv_id: string };
        Returns: {
          ai_active: boolean;
          ai_busy_until: string | null;
          ai_due_at: string | null;
          ai_engaged: boolean;
          ai_handoff_at: string | null;
          ai_handoff_reason: string | null;
          ai_last_reply_at: string | null;
          ai_pending_at: string | null;
          ai_pending_message_id: string | null;
          ai_reply_count: number;
          assignee_id: string | null;
          channel_id: string;
          contact_id: string;
          created_at: string;
          first_response_at: string | null;
          id: string;
          last_customer_message_at: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          opened_at: string;
          organization_id: string;
          resolved_at: string | null;
          rotated_at: string | null;
          rotation_deadline: string | null;
          status: Database["public"]["Enums"]["conversation_status"];
          team_id: string | null;
          typing_until: string | null;
          unread_count: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "conversations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      claim_webhook_deliveries: {
        Args: { p_limit?: number };
        Returns: {
          attempts: number;
          event: string;
          id: string;
          payload: Json;
          secret: string;
          url: string;
          webhook_id: string;
        }[];
      };
      contact_label: { Args: { p_conversation: string }; Returns: string };
      create_api_key: { Args: { key_name: string }; Returns: string };
      create_organization: { Args: { org_name: string }; Returns: string };
      csat_rating: { Args: { p_body: string }; Returns: number };
      csat_summary: {
        Args: { p_days?: number };
        Returns: {
          agent_id: string;
          answered: number;
          average: number;
          handled_by_ai: boolean;
          satisfied: number;
          surveys: number;
        }[];
      };
      current_org_id: { Args: Record<PropertyKey, never>; Returns: string };
      current_role_name: {
        Args: Record<PropertyKey, never>;
        Returns: Database["public"]["Enums"]["app_role"];
      };
      current_team_ids: { Args: Record<PropertyKey, never>; Returns: string[] };
      dashboard_daily_messages: {
        Args: { p_days?: number };
        Returns: {
          day: string;
          inbound: number;
          outbound: number;
        }[];
      };
      enqueue_webhook_event: {
        Args: { p_data: Json; p_event: string; p_org: string };
        Returns: number;
      };
      expire_orders: { Args: Record<PropertyKey, never>; Returns: number };
      finish_ai_turn: {
        Args: {
          p_conversation_id: string;
          p_outcome: string;
          p_reason: string;
        };
        Returns: undefined;
      };
      followup_auto_enroll: {
        Args: Record<PropertyKey, never>;
        Returns: number;
      };
      followup_claim_due: {
        Args: { p_limit?: number };
        Returns: {
          agent_id: string | null;
          attempts: number;
          conversation_id: string;
          current_step: number;
          ended_at: string | null;
          enrolled_by: string | null;
          id: string;
          last_error: string | null;
          next_send_at: string | null;
          organization_id: string;
          replied_after_step: number | null;
          replied_at: string | null;
          sequence_id: string;
          started_at: string;
          status: string;
          steps_total: number;
          stop_reason: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "followup_enrollments";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      followup_due_at: {
        Args: {
          p_days: number;
          p_from: string;
          p_hours: number;
          p_send_hour: number;
          p_tz: string;
        };
        Returns: string;
      };
      followup_enroll: {
        Args: { p_conversation_id: string; p_sequence_id: string };
        Returns: {
          agent_id: string | null;
          attempts: number;
          conversation_id: string;
          current_step: number;
          ended_at: string | null;
          enrolled_by: string | null;
          id: string;
          last_error: string | null;
          next_send_at: string | null;
          organization_id: string;
          replied_after_step: number | null;
          replied_at: string | null;
          sequence_id: string;
          started_at: string;
          status: string;
          steps_total: number;
          stop_reason: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "followup_enrollments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      followup_record_send: {
        Args: {
          p_enrollment_id: string;
          p_error: string;
          p_message_id: string;
          p_outcome: string;
          p_position: number;
        };
        Returns: {
          agent_id: string | null;
          attempts: number;
          conversation_id: string;
          current_step: number;
          ended_at: string | null;
          enrolled_by: string | null;
          id: string;
          last_error: string | null;
          next_send_at: string | null;
          organization_id: string;
          replied_after_step: number | null;
          replied_at: string | null;
          sequence_id: string;
          started_at: string;
          status: string;
          steps_total: number;
          stop_reason: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "followup_enrollments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      followup_stats: {
        Args: { p_days?: number };
        Returns: {
          active: number;
          agent_id: string;
          completed: number;
          enrolled: number;
          failed: number;
          messages_sent: number;
          replied: number;
          replied_by_step: Json;
          sequence_id: string;
          stopped: number;
        }[];
      };
      followup_step_due: {
        Args: { p_from: string; p_position: number; p_sequence_id: string };
        Returns: string;
      };
      followup_stop: {
        Args: { p_enrollment_id: string };
        Returns: {
          agent_id: string | null;
          attempts: number;
          conversation_id: string;
          current_step: number;
          ended_at: string | null;
          enrolled_by: string | null;
          id: string;
          last_error: string | null;
          next_send_at: string | null;
          organization_id: string;
          replied_after_step: number | null;
          replied_at: string | null;
          sequence_id: string;
          started_at: string;
          status: string;
          steps_total: number;
          stop_reason: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "followup_enrollments";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      hand_to_ai: {
        Args: { conv_id: string };
        Returns: {
          ai_active: boolean;
          ai_busy_until: string | null;
          ai_due_at: string | null;
          ai_engaged: boolean;
          ai_handoff_at: string | null;
          ai_handoff_reason: string | null;
          ai_last_reply_at: string | null;
          ai_pending_at: string | null;
          ai_pending_message_id: string | null;
          ai_reply_count: number;
          assignee_id: string | null;
          channel_id: string;
          contact_id: string;
          created_at: string;
          first_response_at: string | null;
          id: string;
          last_customer_message_at: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          opened_at: string;
          organization_id: string;
          resolved_at: string | null;
          rotated_at: string | null;
          rotation_deadline: string | null;
          status: Database["public"]["Enums"]["conversation_status"];
          team_id: string | null;
          typing_until: string | null;
          unread_count: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "conversations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      ingest_channel_message: {
        Args: {
          p_body: string;
          p_channel_id: string;
          p_direction: Database["public"]["Enums"]["message_direction"];
          p_metadata: Json;
          p_profile_name: string;
          p_reply_to_wa_id: string;
          p_sent_at: string;
          p_type: string;
          p_wa_id: string;
          p_wa_message_id: string;
        };
        Returns: {
          conversation_id: string;
          inserted: boolean;
          message_id: string;
          organization_id: string;
        }[];
      };
      ingest_inbound_message: {
        Args: {
          p_body: string;
          p_metadata: Json;
          p_phone_number_id: string;
          p_profile_name: string;
          p_reply_to_wa_id: string;
          p_sent_at: string;
          p_type: string;
          p_wa_id: string;
          p_wa_message_id: string;
        };
        Returns: {
          conversation_id: string;
          inserted: boolean;
          message_id: string;
          organization_id: string;
        }[];
      };
      is_business_open: {
        Args: { p_at?: string; p_org: string };
        Returns: boolean;
      };
      is_master_admin: { Args: Record<PropertyKey, never>; Returns: boolean };
      mark_conversation_read: { Args: { conv_id: string }; Returns: undefined };
      master_tenant_overview: {
        Args: Record<PropertyKey, never>;
        Returns: {
          ai_replies_month: number;
          broadcast_month: number;
          channels: number;
          conversations: number;
          created_at: string;
          id: string;
          is_active: boolean;
          members: number;
          name: string;
          plan_expires_at: string;
          plan_id: string;
          plan_name: string;
          superadmins: Json;
          suspended_at: string;
        }[];
      };
      master_tenant_requests: {
        Args: Record<PropertyKey, never>;
        Returns: {
          company_name: string;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          note: string | null;
          organization_id: string | null;
          phone: string | null;
          reject_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "tenant_requests";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      move_conversation_label: {
        Args: { conv_id: string; from_label: string; to_label: string };
        Returns: undefined;
      };
      next_order_number: { Args: { p_org: string }; Returns: string };
      next_rotation_agent: {
        Args: { p_org: string; p_team: string };
        Returns: string;
      };
      notify_users: {
        Args: {
          p_body: string;
          p_tag: string;
          p_title: string;
          p_url: string;
          p_users: string[];
        };
        Returns: undefined;
      };
      org_plan_usage: {
        Args: Record<PropertyKey, never>;
        Returns: {
          ai_replies: number;
          ai_replies_per_month: number;
          broadcast_messages: number;
          broadcast_per_month: number;
          channels: number;
          expired: boolean;
          expires_at: string;
          max_channels: number;
          max_users: number;
          plan_name: string;
          price_monthly: number;
          users: number;
        }[];
      };
      performance_daily: {
        Args: { p_from: string; p_sla_minutes?: number; p_to: string };
        Returns: {
          day: string;
          median_response_seconds: number;
          new_chats: number;
          replies: number;
          resolved: number;
          within_sla: number;
        }[];
      };
      performance_report: {
        Args: { p_from: string; p_sla_minutes?: number; p_to: string };
        Returns: {
          actor: string;
          agent_id: string;
          avg_response_seconds: number;
          chats: number;
          csat_answered: number;
          csat_average: number;
          median_resolution_minutes: number;
          median_response_seconds: number;
          orders_paid: number;
          replies: number;
          resolved: number;
          revenue: number;
          within_sla: number;
        }[];
      };
      purge_expired_messages: {
        Args: Record<PropertyKey, never>;
        Returns: string[];
      };
      purge_webhook_deliveries: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      push_claim: {
        Args: { p_limit?: number };
        Returns: {
          body: string;
          created_at: string;
          id: string;
          sent_at: string | null;
          tag: string | null;
          title: string;
          url: string;
          user_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "push_queue";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      record_knowledge_gap: {
        Args: { p_conversation: string; p_org: string; p_question: string };
        Returns: undefined;
      };
      record_outbound_message: {
        Args: {
          p_body: string;
          p_conversation_id: string;
          p_media_filename: string;
          p_media_mime: string;
          p_media_path: string;
          p_metadata: Json;
          p_reply_to_wa_id: string;
          p_sender_id: string;
          p_type: string;
          p_wa_message_id: string;
        };
        Returns: {
          body: string | null;
          conversation_id: string;
          created_at: string;
          direction: Database["public"]["Enums"]["message_direction"];
          error: Json | null;
          id: string;
          media_filename: string | null;
          media_mime: string | null;
          media_path: string | null;
          metadata: NonNullable<Json>;
          organization_id: string;
          reply_to_wa_id: string | null;
          sender_id: string | null;
          status: Database["public"]["Enums"]["message_status"];
          type: string;
          wa_message_id: string | null;
        };
        SetofOptions: {
          from: "*";
          to: "messages";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      registration_mode: { Args: Record<PropertyKey, never>; Returns: string };
      reject_tenant_request: {
        Args: { reason?: string; request_id: string };
        Returns: undefined;
      };
      reply_waits: {
        Args: { p_from: string; p_org: string; p_to: string };
        Returns: {
          conversation_id: string;
          from_phone: boolean;
          is_ai: boolean;
          replied_at: string;
          sender_id: string;
          wait_seconds: number;
        }[];
      };
      request_tenant: {
        Args: { p_company: string; p_note?: string; p_phone?: string };
        Returns: {
          company_name: string;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          note: string | null;
          organization_id: string | null;
          phone: string | null;
          reject_reason: string | null;
          reviewed_at: string | null;
          reviewed_by: string | null;
          status: string;
          updated_at: string;
          user_id: string;
        };
        SetofOptions: {
          from: "*";
          to: "tenant_requests";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      revoke_api_key: { Args: { key_id: string }; Returns: undefined };
      search_knowledge: {
        Args: { p_limit?: number; p_org: string; p_query: string };
        Returns: {
          chunk_id: string;
          content: string;
          doc_title: string;
          product_id: string;
          product_name: string;
          rank: number;
        }[];
      };
      set_channel_connection: {
        Args: {
          p_display_phone: string;
          p_instance_name: string;
          p_status: string;
        };
        Returns: undefined;
      };
      set_conversation_ai: {
        Args: { active: boolean; conv_id: string };
        Returns: {
          ai_active: boolean;
          ai_busy_until: string | null;
          ai_due_at: string | null;
          ai_engaged: boolean;
          ai_handoff_at: string | null;
          ai_handoff_reason: string | null;
          ai_last_reply_at: string | null;
          ai_pending_at: string | null;
          ai_pending_message_id: string | null;
          ai_reply_count: number;
          assignee_id: string | null;
          channel_id: string;
          contact_id: string;
          created_at: string;
          first_response_at: string | null;
          id: string;
          last_customer_message_at: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          opened_at: string;
          organization_id: string;
          resolved_at: string | null;
          rotated_at: string | null;
          rotation_deadline: string | null;
          status: Database["public"]["Enums"]["conversation_status"];
          team_id: string | null;
          typing_until: string | null;
          unread_count: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "conversations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      set_conversation_status: {
        Args: {
          conv_id: string;
          new_status: Database["public"]["Enums"]["conversation_status"];
        };
        Returns: {
          ai_active: boolean;
          ai_busy_until: string | null;
          ai_due_at: string | null;
          ai_engaged: boolean;
          ai_handoff_at: string | null;
          ai_handoff_reason: string | null;
          ai_last_reply_at: string | null;
          ai_pending_at: string | null;
          ai_pending_message_id: string | null;
          ai_reply_count: number;
          assignee_id: string | null;
          channel_id: string;
          contact_id: string;
          created_at: string;
          first_response_at: string | null;
          id: string;
          last_customer_message_at: string | null;
          last_message_at: string | null;
          last_message_preview: string | null;
          opened_at: string;
          organization_id: string;
          resolved_at: string | null;
          rotated_at: string | null;
          rotation_deadline: string | null;
          status: Database["public"]["Enums"]["conversation_status"];
          team_id: string | null;
          typing_until: string | null;
          unread_count: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "conversations";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      test_webhook: { Args: { webhook: string }; Returns: undefined };
      usage_month: { Args: { p_org: string }; Returns: string };
      use_quota: {
        Args: { p_amount?: number; p_kind: string; p_org: string };
        Returns: number;
      };
      wake_push: { Args: Record<PropertyKey, never>; Returns: undefined };
      wake_webhook_dispatch: {
        Args: Record<PropertyKey, never>;
        Returns: undefined;
      };
      webhook_conversation_json: { Args: { p_conv: string }; Returns: Json };
    };
    Enums: {
      agent_status: "online" | "away" | "offline";
      ai_provider: "openai" | "anthropic" | "deepseek" | "gemini" | "custom";
      app_role: "admin" | "supervisor" | "agent";
      channel_provider:
        | "cloud_api"
        | "qr"
        | "messenger"
        | "instagram"
        | "telegram"
        | "webchat";
      conversation_status: "open" | "pending" | "resolved";
      message_direction: "inbound" | "outbound";
      message_status: "received" | "sent" | "delivered" | "read" | "failed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      agent_status: ["online", "away", "offline"],
      ai_provider: ["openai", "anthropic", "deepseek", "gemini", "custom"],
      app_role: ["admin", "supervisor", "agent"],
      channel_provider: [
        "cloud_api",
        "qr",
        "messenger",
        "instagram",
        "telegram",
        "webchat",
      ],
      conversation_status: ["open", "pending", "resolved"],
      message_direction: ["inbound", "outbound"],
      message_status: ["received", "sent", "delivered", "read", "failed"],
    },
  },
} as const;
