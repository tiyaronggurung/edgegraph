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
      analyses: {
        Row: {
          ai_reasoning: string | null
          confidence_score: number | null
          created_at: string
          edge_score: number | null
          edge70_detected: boolean | null
          game_name: string | null
          id: string
          league: string | null
          notes: Json | null
          odds_a: number | null
          odds_b: number | null
          pattern_type: string | null
          predicted_winner: string | null
          probability_a: number | null
          probability_b: number | null
          recommended_action: string | null
          risk_level: string | null
          score: string | null
          sport: string
          sport_fields: Json | null
          team_a: string | null
          team_b: string | null
          time_period: string | null
          uploaded_image_url: string | null
          user_id: string
          volume: number | null
        }
        Insert: {
          ai_reasoning?: string | null
          confidence_score?: number | null
          created_at?: string
          edge_score?: number | null
          edge70_detected?: boolean | null
          game_name?: string | null
          id?: string
          league?: string | null
          notes?: Json | null
          odds_a?: number | null
          odds_b?: number | null
          pattern_type?: string | null
          predicted_winner?: string | null
          probability_a?: number | null
          probability_b?: number | null
          recommended_action?: string | null
          risk_level?: string | null
          score?: string | null
          sport: string
          sport_fields?: Json | null
          team_a?: string | null
          team_b?: string | null
          time_period?: string | null
          uploaded_image_url?: string | null
          user_id: string
          volume?: number | null
        }
        Update: {
          ai_reasoning?: string | null
          confidence_score?: number | null
          created_at?: string
          edge_score?: number | null
          edge70_detected?: boolean | null
          game_name?: string | null
          id?: string
          league?: string | null
          notes?: Json | null
          odds_a?: number | null
          odds_b?: number | null
          pattern_type?: string | null
          predicted_winner?: string | null
          probability_a?: number | null
          probability_b?: number | null
          recommended_action?: string | null
          risk_level?: string | null
          score?: string | null
          sport?: string
          sport_fields?: Json | null
          team_a?: string | null
          team_b?: string | null
          time_period?: string | null
          uploaded_image_url?: string | null
          user_id?: string
          volume?: number | null
        }
        Relationships: []
      }
      bets: {
        Row: {
          analysis_id: string | null
          closing_captured_at: string | null
          closing_odds: number | null
          clv_percent: number | null
          confidence_score: number | null
          created_at: string
          date: string
          edge_score: number | null
          game: string | null
          id: string
          notes: string | null
          odds: number | null
          pattern_type: string | null
          pick: string | null
          profit_loss: number | null
          result: string | null
          sport: string | null
          stake: number | null
          user_id: string
        }
        Insert: {
          analysis_id?: string | null
          closing_captured_at?: string | null
          closing_odds?: number | null
          clv_percent?: number | null
          confidence_score?: number | null
          created_at?: string
          date?: string
          edge_score?: number | null
          game?: string | null
          id?: string
          notes?: string | null
          odds?: number | null
          pattern_type?: string | null
          pick?: string | null
          profit_loss?: number | null
          result?: string | null
          sport?: string | null
          stake?: number | null
          user_id: string
        }
        Update: {
          analysis_id?: string | null
          closing_captured_at?: string | null
          closing_odds?: number | null
          clv_percent?: number | null
          confidence_score?: number | null
          created_at?: string
          date?: string
          edge_score?: number | null
          game?: string | null
          id?: string
          notes?: string | null
          odds?: number | null
          pattern_type?: string | null
          pick?: string | null
          profit_loss?: number | null
          result?: string | null
          sport?: string | null
          stake?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bets_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      email_send_log: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          message_id: string | null
          metadata: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email: string
          status: string
          template_name: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          message_id?: string | null
          metadata?: Json | null
          recipient_email?: string
          status?: string
          template_name?: string
        }
        Relationships: []
      }
      email_send_state: {
        Row: {
          auth_email_ttl_minutes: number
          batch_size: number
          id: number
          retry_after_until: string | null
          send_delay_ms: number
          transactional_email_ttl_minutes: number
          updated_at: string
        }
        Insert: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Update: {
          auth_email_ttl_minutes?: number
          batch_size?: number
          id?: number
          retry_after_until?: string | null
          send_delay_ms?: number
          transactional_email_ttl_minutes?: number
          updated_at?: string
        }
        Relationships: []
      }
      email_unsubscribe_tokens: {
        Row: {
          created_at: string
          email: string
          id: string
          token: string
          used_at: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          token: string
          used_at?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          token?: string
          used_at?: string | null
        }
        Relationships: []
      }
      graph_snapshots: {
        Row: {
          analysis_id: string
          event_trigger: string | null
          id: string
          odds_a: number | null
          odds_b: number | null
          probability_a: number | null
          probability_b: number | null
          score_state: string | null
          timestamp: string
          user_id: string
          volume: number | null
        }
        Insert: {
          analysis_id: string
          event_trigger?: string | null
          id?: string
          odds_a?: number | null
          odds_b?: number | null
          probability_a?: number | null
          probability_b?: number | null
          score_state?: string | null
          timestamp?: string
          user_id: string
          volume?: number | null
        }
        Update: {
          analysis_id?: string
          event_trigger?: string | null
          id?: string
          odds_a?: number | null
          odds_b?: number | null
          probability_a?: number | null
          probability_b?: number | null
          score_state?: string | null
          timestamp?: string
          user_id?: string
          volume?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "graph_snapshots_analysis_id_fkey"
            columns: ["analysis_id"]
            isOneToOne: false
            referencedRelation: "analyses"
            referencedColumns: ["id"]
          },
        ]
      }
      live_predictions: {
        Row: {
          away_team: string
          computed_at: string
          elapsed: number | null
          explanation: Json | null
          fixture_id: string
          goals_away: number
          goals_home: number
          home_team: string
          league: string | null
          markets: Json
          provider_id: string
          snapshot: Json
          stats: Json
          status: string | null
          updated_at: string
        }
        Insert: {
          away_team: string
          computed_at?: string
          elapsed?: number | null
          explanation?: Json | null
          fixture_id: string
          goals_away?: number
          goals_home?: number
          home_team: string
          league?: string | null
          markets: Json
          provider_id: string
          snapshot: Json
          stats: Json
          status?: string | null
          updated_at?: string
        }
        Update: {
          away_team?: string
          computed_at?: string
          elapsed?: number | null
          explanation?: Json | null
          fixture_id?: string
          goals_away?: number
          goals_home?: number
          home_team?: string
          league?: string | null
          markets?: Json
          provider_id?: string
          snapshot?: Json
          stats?: Json
          status?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      patterns: {
        Row: {
          best_use: string | null
          condition_logic: string
          description: string
          example_behavior: string
          icon: string | null
          id: string
          name: string
          recommended_action: string
          risk_level: string
        }
        Insert: {
          best_use?: string | null
          condition_logic: string
          description: string
          example_behavior: string
          icon?: string | null
          id?: string
          name: string
          recommended_action: string
          risk_level: string
        }
        Update: {
          best_use?: string | null
          condition_logic?: string
          description?: string
          example_behavior?: string
          icon?: string | null
          id?: string
          name?: string
          recommended_action?: string
          risk_level?: string
        }
        Relationships: []
      }
      pending_digest_alerts: {
        Row: {
          alert_date: string
          created_at: string
          edge_pts: number | null
          fair_prob: number | null
          id: string
          kelly_half: number | null
          market_prob: number | null
          market_ticker: string
          market_title: string | null
          pattern: string | null
          sent: boolean
          sent_at: string | null
          side: string
          side_label: string | null
          sport: string | null
          user_id: string
        }
        Insert: {
          alert_date?: string
          created_at?: string
          edge_pts?: number | null
          fair_prob?: number | null
          id?: string
          kelly_half?: number | null
          market_prob?: number | null
          market_ticker: string
          market_title?: string | null
          pattern?: string | null
          sent?: boolean
          sent_at?: string | null
          side: string
          side_label?: string | null
          sport?: string | null
          user_id: string
        }
        Update: {
          alert_date?: string
          created_at?: string
          edge_pts?: number | null
          fair_prob?: number | null
          id?: string
          kelly_half?: number | null
          market_prob?: number | null
          market_ticker?: string
          market_title?: string | null
          pattern?: string | null
          sent?: boolean
          sent_at?: string | null
          side?: string
          side_label?: string | null
          sport?: string | null
          user_id?: string
        }
        Relationships: []
      }
      prediction_closes: {
        Row: {
          ai_prob: number | null
          closed_at: string
          ensemble_prob: number
          fixture_id: string
          id: number
          line: number | null
          market: string
          market_prob: number | null
          outcome: boolean | null
          pick: string
          stats_prob: number | null
        }
        Insert: {
          ai_prob?: number | null
          closed_at?: string
          ensemble_prob: number
          fixture_id: string
          id?: number
          line?: number | null
          market: string
          market_prob?: number | null
          outcome?: boolean | null
          pick: string
          stats_prob?: number | null
        }
        Update: {
          ai_prob?: number | null
          closed_at?: string
          ensemble_prob?: number
          fixture_id?: string
          id?: number
          line?: number | null
          market?: string
          market_prob?: number | null
          outcome?: boolean | null
          pick?: string
          stats_prob?: number | null
        }
        Relationships: []
      }
      prediction_history: {
        Row: {
          ai_prob: number | null
          computed_at: string
          fixture_id: string
          id: number
          line: number | null
          market: string
          pick: string
          probability: number
          stats_prob: number | null
        }
        Insert: {
          ai_prob?: number | null
          computed_at?: string
          fixture_id: string
          id?: number
          line?: number | null
          market: string
          pick: string
          probability: number
          stats_prob?: number | null
        }
        Update: {
          ai_prob?: number | null
          computed_at?: string
          fixture_id?: string
          id?: number
          line?: number | null
          market?: string
          pick?: string
          probability?: number
          stats_prob?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          alert_frequency: string
          alert_min_confidence: number
          alert_sport_filters: string[]
          bankroll: number
          billing_interval: string | null
          created_at: string
          current_period_end: string | null
          default_unit: number
          email: string | null
          id: string
          is_admin: boolean
          preferred_sports: string[]
          risk_tolerance: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string
          subscription_tier: string
        }
        Insert: {
          alert_frequency?: string
          alert_min_confidence?: number
          alert_sport_filters?: string[]
          bankroll?: number
          billing_interval?: string | null
          created_at?: string
          current_period_end?: string | null
          default_unit?: number
          email?: string | null
          id: string
          is_admin?: boolean
          preferred_sports?: string[]
          risk_tolerance?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          subscription_tier?: string
        }
        Update: {
          alert_frequency?: string
          alert_min_confidence?: number
          alert_sport_filters?: string[]
          bankroll?: number
          billing_interval?: string | null
          created_at?: string
          current_period_end?: string | null
          default_unit?: number
          email?: string | null
          id?: string
          is_admin?: boolean
          preferred_sports?: string[]
          risk_tolerance?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string
          subscription_tier?: string
        }
        Relationships: []
      }
      strategies: {
        Row: {
          active: boolean
          created_at: string
          id: string
          minimum_confidence: number | null
          name: string
          pattern_type: string | null
          recommended_action: string | null
          rules: string | null
          user_id: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          minimum_confidence?: number | null
          name: string
          pattern_type?: string | null
          recommended_action?: string | null
          rules?: string | null
          user_id: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          minimum_confidence?: number | null
          name?: string
          pattern_type?: string | null
          recommended_action?: string | null
          rules?: string | null
          user_id?: string
        }
        Relationships: []
      }
      suppressed_emails: {
        Row: {
          created_at: string
          email: string
          id: string
          metadata: Json | null
          reason: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          metadata?: Json | null
          reason: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          metadata?: Json | null
          reason?: string
        }
        Relationships: []
      }
      upgrade_events: {
        Row: {
          context: string | null
          created_at: string
          event_type: string
          id: string
          metadata: Json
          target_plan: string | null
          user_id: string | null
        }
        Insert: {
          context?: string | null
          created_at?: string
          event_type: string
          id?: string
          metadata?: Json
          target_plan?: string | null
          user_id?: string | null
        }
        Update: {
          context?: string | null
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json
          target_plan?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      usage_counters: {
        Row: {
          ai_verdicts_used: number
          bet_alerts_used: number
          created_at: string
          id: string
          period_start: string
          updated_at: string
          user_id: string
        }
        Insert: {
          ai_verdicts_used?: number
          bet_alerts_used?: number
          created_at?: string
          id?: string
          period_start: string
          updated_at?: string
          user_id: string
        }
        Update: {
          ai_verdicts_used?: number
          bet_alerts_used?: number
          created_at?: string
          id?: string
          period_start?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      verdict_log: {
        Row: {
          bet_id: string | null
          created_at: string
          edge_pts: number | null
          fair_prob: number | null
          id: string
          kelly_half: number | null
          market_prob: number | null
          market_ticker: string
          market_title: string | null
          pattern: string | null
          resolved_at: string | null
          result: string
          side: string
          side_label: string | null
          user_id: string
          verdict: string
        }
        Insert: {
          bet_id?: string | null
          created_at?: string
          edge_pts?: number | null
          fair_prob?: number | null
          id?: string
          kelly_half?: number | null
          market_prob?: number | null
          market_ticker: string
          market_title?: string | null
          pattern?: string | null
          resolved_at?: string | null
          result?: string
          side: string
          side_label?: string | null
          user_id: string
          verdict?: string
        }
        Update: {
          bet_id?: string | null
          created_at?: string
          edge_pts?: number | null
          fair_prob?: number | null
          id?: string
          kelly_half?: number | null
          market_prob?: number | null
          market_ticker?: string
          market_title?: string | null
          pattern?: string | null
          resolved_at?: string | null
          result?: string
          side?: string
          side_label?: string | null
          user_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "verdict_log_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      move_to_dlq: {
        Args: {
          dlq_name: string
          message_id: number
          payload: Json
          source_queue: string
        }
        Returns: number
      }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
