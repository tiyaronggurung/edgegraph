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
      auto_odds_calibration: {
        Row: {
          last_tuned_at: string
          max_cents: number
          min_cents: number
          min_velocity: number
          sample_size: number
          trigger: string
          updated_at: string
          user_id: string
          win_rate: number
        }
        Insert: {
          last_tuned_at?: string
          max_cents?: number
          min_cents?: number
          min_velocity?: number
          sample_size?: number
          trigger: string
          updated_at?: string
          user_id: string
          win_rate?: number
        }
        Update: {
          last_tuned_at?: string
          max_cents?: number
          min_cents?: number
          min_velocity?: number
          sample_size?: number
          trigger?: string
          updated_at?: string
          user_id?: string
          win_rate?: number
        }
        Relationships: []
      }
      auto_odds_decision_log: {
        Row: {
          actual_entered: boolean
          calibration_score: number | null
          confidence_score: number | null
          confidence_tier: string | null
          created_at: string
          edge: number | null
          entry_price_cents: number | null
          ev_score: number | null
          expected_value: number | null
          final_outcome: string | null
          final_pnl_usd: number | null
          history_samples_count: number | null
          id: string
          kalshi_favorite_side: string | null
          market_side_prob: number | null
          max_probability_last_10min: number | null
          min_probability_last_10min: number | null
          model_prob_10min_ago: number | null
          model_prob_1min_ago: number | null
          model_prob_3min_ago: number | null
          model_prob_5min_ago: number | null
          model_side_prob: number | null
          model_stability_score: number | null
          model_yes_prob: number | null
          momentum_score: number | null
          note: string | null
          order_id: string | null
          orderflow_score: number | null
          picked_side: string
          prediction_direction_10min_ago: string | null
          prediction_direction_1min_ago: string | null
          prediction_direction_3min_ago: string | null
          prediction_direction_5min_ago: string | null
          prediction_duration_seconds: number | null
          prediction_flip_count: number | null
          seconds_to_close: number | null
          sigma_multiplier: number | null
          sigma_score: number | null
          spot: number | null
          stake_used: number | null
          ticker: string
          time_bucket: string | null
          time_penalty: number | null
          user_id: string
          volregime_score: number | null
          whale_score: number | null
          would_enter: boolean
          would_skip_bucket_d: boolean | null
          would_skip_extreme_kalshi_weak_model: boolean | null
          would_skip_time_gate_400: boolean | null
        }
        Insert: {
          actual_entered?: boolean
          calibration_score?: number | null
          confidence_score?: number | null
          confidence_tier?: string | null
          created_at?: string
          edge?: number | null
          entry_price_cents?: number | null
          ev_score?: number | null
          expected_value?: number | null
          final_outcome?: string | null
          final_pnl_usd?: number | null
          history_samples_count?: number | null
          id?: string
          kalshi_favorite_side?: string | null
          market_side_prob?: number | null
          max_probability_last_10min?: number | null
          min_probability_last_10min?: number | null
          model_prob_10min_ago?: number | null
          model_prob_1min_ago?: number | null
          model_prob_3min_ago?: number | null
          model_prob_5min_ago?: number | null
          model_side_prob?: number | null
          model_stability_score?: number | null
          model_yes_prob?: number | null
          momentum_score?: number | null
          note?: string | null
          order_id?: string | null
          orderflow_score?: number | null
          picked_side: string
          prediction_direction_10min_ago?: string | null
          prediction_direction_1min_ago?: string | null
          prediction_direction_3min_ago?: string | null
          prediction_direction_5min_ago?: string | null
          prediction_duration_seconds?: number | null
          prediction_flip_count?: number | null
          seconds_to_close?: number | null
          sigma_multiplier?: number | null
          sigma_score?: number | null
          spot?: number | null
          stake_used?: number | null
          ticker: string
          time_bucket?: string | null
          time_penalty?: number | null
          user_id: string
          volregime_score?: number | null
          whale_score?: number | null
          would_enter?: boolean
          would_skip_bucket_d?: boolean | null
          would_skip_extreme_kalshi_weak_model?: boolean | null
          would_skip_time_gate_400?: boolean | null
        }
        Update: {
          actual_entered?: boolean
          calibration_score?: number | null
          confidence_score?: number | null
          confidence_tier?: string | null
          created_at?: string
          edge?: number | null
          entry_price_cents?: number | null
          ev_score?: number | null
          expected_value?: number | null
          final_outcome?: string | null
          final_pnl_usd?: number | null
          history_samples_count?: number | null
          id?: string
          kalshi_favorite_side?: string | null
          market_side_prob?: number | null
          max_probability_last_10min?: number | null
          min_probability_last_10min?: number | null
          model_prob_10min_ago?: number | null
          model_prob_1min_ago?: number | null
          model_prob_3min_ago?: number | null
          model_prob_5min_ago?: number | null
          model_side_prob?: number | null
          model_stability_score?: number | null
          model_yes_prob?: number | null
          momentum_score?: number | null
          note?: string | null
          order_id?: string | null
          orderflow_score?: number | null
          picked_side?: string
          prediction_direction_10min_ago?: string | null
          prediction_direction_1min_ago?: string | null
          prediction_direction_3min_ago?: string | null
          prediction_direction_5min_ago?: string | null
          prediction_duration_seconds?: number | null
          prediction_flip_count?: number | null
          seconds_to_close?: number | null
          sigma_multiplier?: number | null
          sigma_score?: number | null
          spot?: number | null
          stake_used?: number | null
          ticker?: string
          time_bucket?: string | null
          time_penalty?: number | null
          user_id?: string
          volregime_score?: number | null
          whale_score?: number | null
          would_enter?: boolean
          would_skip_bucket_d?: boolean | null
          would_skip_extreme_kalshi_weak_model?: boolean | null
          would_skip_time_gate_400?: boolean | null
        }
        Relationships: []
      }
      auto_odds_scalp_shadow: {
        Row: {
          created_at: string
          entered_at: string
          entry_cents: number
          entry_dist_to_strike: number
          entry_side: string
          entry_spot: number
          exit_cents: number | null
          exit_reason: string | null
          exit_spot: number | null
          exited_at: string | null
          id: string
          pnl_cents: number | null
          seconds_to_close_at_entry: number
          settled_yes: boolean | null
          setup_kind: string
          strike: number
          ticker: string
          user_id: string
        }
        Insert: {
          created_at?: string
          entered_at?: string
          entry_cents: number
          entry_dist_to_strike: number
          entry_side: string
          entry_spot: number
          exit_cents?: number | null
          exit_reason?: string | null
          exit_spot?: number | null
          exited_at?: string | null
          id?: string
          pnl_cents?: number | null
          seconds_to_close_at_entry: number
          settled_yes?: boolean | null
          setup_kind: string
          strike: number
          ticker: string
          user_id: string
        }
        Update: {
          created_at?: string
          entered_at?: string
          entry_cents?: number
          entry_dist_to_strike?: number
          entry_side?: string
          entry_spot?: number
          exit_cents?: number | null
          exit_reason?: string | null
          exit_spot?: number | null
          exited_at?: string | null
          id?: string
          pnl_cents?: number | null
          seconds_to_close_at_entry?: number
          settled_yes?: boolean | null
          setup_kind?: string
          strike?: number
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      auto_odds_settings: {
        Row: {
          auto_apply_studies: boolean
          auto_button_type: string | null
          consecutive_losses: number
          created_at: string
          enabled: boolean
          hedge_band_hi: number | null
          hedge_band_lo: number | null
          ignore_cents_band: boolean
          ignore_low_r2: boolean
          last_tick_at: string | null
          max_entry_cents: number
          model_gate_min: number | null
          oscillation_max: number | null
          shadow_flip_enabled: boolean
          skip_bucket_15_60s: boolean | null
          skip_bucket_lt15s: boolean | null
          stopped_reason: string | null
          tp_cents: number | null
          updated_at: string
          user_id: string
          vp_no_only: boolean
        }
        Insert: {
          auto_apply_studies?: boolean
          auto_button_type?: string | null
          consecutive_losses?: number
          created_at?: string
          enabled?: boolean
          hedge_band_hi?: number | null
          hedge_band_lo?: number | null
          ignore_cents_band?: boolean
          ignore_low_r2?: boolean
          last_tick_at?: string | null
          max_entry_cents?: number
          model_gate_min?: number | null
          oscillation_max?: number | null
          shadow_flip_enabled?: boolean
          skip_bucket_15_60s?: boolean | null
          skip_bucket_lt15s?: boolean | null
          stopped_reason?: string | null
          tp_cents?: number | null
          updated_at?: string
          user_id: string
          vp_no_only?: boolean
        }
        Update: {
          auto_apply_studies?: boolean
          auto_button_type?: string | null
          consecutive_losses?: number
          created_at?: string
          enabled?: boolean
          hedge_band_hi?: number | null
          hedge_band_lo?: number | null
          ignore_cents_band?: boolean
          ignore_low_r2?: boolean
          last_tick_at?: string | null
          max_entry_cents?: number
          model_gate_min?: number | null
          oscillation_max?: number | null
          shadow_flip_enabled?: boolean
          skip_bucket_15_60s?: boolean | null
          skip_bucket_lt15s?: boolean | null
          stopped_reason?: string | null
          tp_cents?: number | null
          updated_at?: string
          user_id?: string
          vp_no_only?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "auto_odds_settings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_odds_staking_config: {
        Row: {
          base_stake: number
          created_at: string
          loss_reduction_1_pct: number
          loss_reduction_2_pct: number
          max_consecutive_losses: number
          max_profit_exposure_pct: number
          max_stake: number
          profit_bank_start_pct: number
          unlock_wins: number
          updated_at: string
          user_id: string
          win_growth_pct: number
        }
        Insert: {
          base_stake?: number
          created_at?: string
          loss_reduction_1_pct?: number
          loss_reduction_2_pct?: number
          max_consecutive_losses?: number
          max_profit_exposure_pct?: number
          max_stake?: number
          profit_bank_start_pct?: number
          unlock_wins?: number
          updated_at?: string
          user_id: string
          win_growth_pct?: number
        }
        Update: {
          base_stake?: number
          created_at?: string
          loss_reduction_1_pct?: number
          loss_reduction_2_pct?: number
          max_consecutive_losses?: number
          max_profit_exposure_pct?: number
          max_stake?: number
          profit_bank_start_pct?: number
          unlock_wins?: number
          updated_at?: string
          user_id?: string
          win_growth_pct?: number
        }
        Relationships: []
      }
      auto_odds_studies: {
        Row: {
          applied_tunings: Json
          created_at: string
          findings: Json
          id: string
          model: string | null
          raw: Json | null
          rows_analyzed: number | null
          summary: string | null
          tunings: Json
          user_id: string
        }
        Insert: {
          applied_tunings?: Json
          created_at?: string
          findings?: Json
          id?: string
          model?: string | null
          raw?: Json | null
          rows_analyzed?: number | null
          summary?: string | null
          tunings?: Json
          user_id: string
        }
        Update: {
          applied_tunings?: Json
          created_at?: string
          findings?: Json
          id?: string
          model?: string | null
          raw?: Json | null
          rows_analyzed?: number | null
          summary?: string | null
          tunings?: Json
          user_id?: string
        }
        Relationships: []
      }
      auto_odds_study_log: {
        Row: {
          created_at: string
          crossed_50: boolean
          entered: boolean
          hedge_fired: boolean
          id: string
          kalshi_favorite_side: string | null
          model_side_prob: number | null
          model_yes_prob: number | null
          no_american: number | null
          no_cents: number | null
          note: string | null
          picked_side: string | null
          prior_yes_cents: number | null
          seconds_since_prior: number | null
          seconds_to_close: number | null
          spot: number | null
          spot_delta: number | null
          ticker: string
          time_bucket: string | null
          user_id: string
          window_start_at: string
          yes_american: number | null
          yes_cents: number | null
          yes_cents_delta: number | null
        }
        Insert: {
          created_at?: string
          crossed_50?: boolean
          entered?: boolean
          hedge_fired?: boolean
          id?: string
          kalshi_favorite_side?: string | null
          model_side_prob?: number | null
          model_yes_prob?: number | null
          no_american?: number | null
          no_cents?: number | null
          note?: string | null
          picked_side?: string | null
          prior_yes_cents?: number | null
          seconds_since_prior?: number | null
          seconds_to_close?: number | null
          spot?: number | null
          spot_delta?: number | null
          ticker: string
          time_bucket?: string | null
          user_id: string
          window_start_at: string
          yes_american?: number | null
          yes_cents?: number | null
          yes_cents_delta?: number | null
        }
        Update: {
          created_at?: string
          crossed_50?: boolean
          entered?: boolean
          hedge_fired?: boolean
          id?: string
          kalshi_favorite_side?: string | null
          model_side_prob?: number | null
          model_yes_prob?: number | null
          no_american?: number | null
          no_cents?: number | null
          note?: string | null
          picked_side?: string | null
          prior_yes_cents?: number | null
          seconds_since_prior?: number | null
          seconds_to_close?: number | null
          spot?: number | null
          spot_delta?: number | null
          ticker?: string
          time_bucket?: string | null
          user_id?: string
          window_start_at?: string
          yes_american?: number | null
          yes_cents?: number | null
          yes_cents_delta?: number | null
        }
        Relationships: []
      }
      auto_odds_tracked_orders: {
        Row: {
          closed_reason: string | null
          created_at: string
          entry_odds: number | null
          entry_side: string
          id: string
          last_zone: string | null
          order_id: string
          oscillation_count: number
          processed_settle: boolean
          updated_at: string
          user_id: string
          whipsaw_armed: boolean
        }
        Insert: {
          closed_reason?: string | null
          created_at?: string
          entry_odds?: number | null
          entry_side: string
          id?: string
          last_zone?: string | null
          order_id: string
          oscillation_count?: number
          processed_settle?: boolean
          updated_at?: string
          user_id: string
          whipsaw_armed?: boolean
        }
        Update: {
          closed_reason?: string | null
          created_at?: string
          entry_odds?: number | null
          entry_side?: string
          id?: string
          last_zone?: string | null
          order_id?: string
          oscillation_count?: number
          processed_settle?: boolean
          updated_at?: string
          user_id?: string
          whipsaw_armed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "auto_odds_tracked_orders_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "auto_trade_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "auto_odds_tracked_orders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_odds_tuning_audit: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          new_value: Json | null
          param: string
          prev_value: Json | null
          rationale: string | null
          reverted_at: string | null
          source: string
          study_id: string | null
          user_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          new_value?: Json | null
          param: string
          prev_value?: Json | null
          rationale?: string | null
          reverted_at?: string | null
          source?: string
          study_id?: string | null
          user_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          new_value?: Json | null
          param?: string
          prev_value?: Json | null
          rationale?: string | null
          reverted_at?: string | null
          source?: string
          study_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_odds_tuning_audit_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "auto_odds_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_trade_flip_shadow: {
        Row: {
          actual_outcome: string | null
          actual_pnl: number | null
          computed_at: string
          contracts: number
          entry_cents: number
          id: string
          min_mark_seen: number | null
          order_id: string
          placed_at: string
          settled_at: string | null
          side: string
          t30_first_cross_mark: number | null
          t30_first_cross_secs: number | null
          t30_killed_winner: boolean | null
          t30_loss_avoided: number | null
          t30_minutes_remaining: number | null
          t30_profit_given_up: number | null
          t30_recovered_to_tp: boolean | null
          t30_saved_loss: boolean | null
          t30_sim_exit_cents: number | null
          t30_sim_pnl: number | null
          t35_first_cross_mark: number | null
          t35_first_cross_secs: number | null
          t35_killed_winner: boolean | null
          t35_loss_avoided: number | null
          t35_minutes_remaining: number | null
          t35_profit_given_up: number | null
          t35_recovered_to_tp: boolean | null
          t35_saved_loss: boolean | null
          t35_sim_exit_cents: number | null
          t35_sim_pnl: number | null
          t40_first_cross_mark: number | null
          t40_first_cross_secs: number | null
          t40_killed_winner: boolean | null
          t40_loss_avoided: number | null
          t40_minutes_remaining: number | null
          t40_profit_given_up: number | null
          t40_recovered_to_tp: boolean | null
          t40_saved_loss: boolean | null
          t40_sim_exit_cents: number | null
          t40_sim_pnl: number | null
          t45_first_cross_mark: number | null
          t45_first_cross_secs: number | null
          t45_killed_winner: boolean | null
          t45_loss_avoided: number | null
          t45_minutes_remaining: number | null
          t45_profit_given_up: number | null
          t45_recovered_to_tp: boolean | null
          t45_saved_loss: boolean | null
          t45_sim_exit_cents: number | null
          t45_sim_pnl: number | null
          tape_samples: number
          ticker: string
          user_id: string
        }
        Insert: {
          actual_outcome?: string | null
          actual_pnl?: number | null
          computed_at?: string
          contracts: number
          entry_cents: number
          id?: string
          min_mark_seen?: number | null
          order_id: string
          placed_at: string
          settled_at?: string | null
          side: string
          t30_first_cross_mark?: number | null
          t30_first_cross_secs?: number | null
          t30_killed_winner?: boolean | null
          t30_loss_avoided?: number | null
          t30_minutes_remaining?: number | null
          t30_profit_given_up?: number | null
          t30_recovered_to_tp?: boolean | null
          t30_saved_loss?: boolean | null
          t30_sim_exit_cents?: number | null
          t30_sim_pnl?: number | null
          t35_first_cross_mark?: number | null
          t35_first_cross_secs?: number | null
          t35_killed_winner?: boolean | null
          t35_loss_avoided?: number | null
          t35_minutes_remaining?: number | null
          t35_profit_given_up?: number | null
          t35_recovered_to_tp?: boolean | null
          t35_saved_loss?: boolean | null
          t35_sim_exit_cents?: number | null
          t35_sim_pnl?: number | null
          t40_first_cross_mark?: number | null
          t40_first_cross_secs?: number | null
          t40_killed_winner?: boolean | null
          t40_loss_avoided?: number | null
          t40_minutes_remaining?: number | null
          t40_profit_given_up?: number | null
          t40_recovered_to_tp?: boolean | null
          t40_saved_loss?: boolean | null
          t40_sim_exit_cents?: number | null
          t40_sim_pnl?: number | null
          t45_first_cross_mark?: number | null
          t45_first_cross_secs?: number | null
          t45_killed_winner?: boolean | null
          t45_loss_avoided?: number | null
          t45_minutes_remaining?: number | null
          t45_profit_given_up?: number | null
          t45_recovered_to_tp?: boolean | null
          t45_saved_loss?: boolean | null
          t45_sim_exit_cents?: number | null
          t45_sim_pnl?: number | null
          tape_samples?: number
          ticker: string
          user_id: string
        }
        Update: {
          actual_outcome?: string | null
          actual_pnl?: number | null
          computed_at?: string
          contracts?: number
          entry_cents?: number
          id?: string
          min_mark_seen?: number | null
          order_id?: string
          placed_at?: string
          settled_at?: string | null
          side?: string
          t30_first_cross_mark?: number | null
          t30_first_cross_secs?: number | null
          t30_killed_winner?: boolean | null
          t30_loss_avoided?: number | null
          t30_minutes_remaining?: number | null
          t30_profit_given_up?: number | null
          t30_recovered_to_tp?: boolean | null
          t30_saved_loss?: boolean | null
          t30_sim_exit_cents?: number | null
          t30_sim_pnl?: number | null
          t35_first_cross_mark?: number | null
          t35_first_cross_secs?: number | null
          t35_killed_winner?: boolean | null
          t35_loss_avoided?: number | null
          t35_minutes_remaining?: number | null
          t35_profit_given_up?: number | null
          t35_recovered_to_tp?: boolean | null
          t35_saved_loss?: boolean | null
          t35_sim_exit_cents?: number | null
          t35_sim_pnl?: number | null
          t40_first_cross_mark?: number | null
          t40_first_cross_secs?: number | null
          t40_killed_winner?: boolean | null
          t40_loss_avoided?: number | null
          t40_minutes_remaining?: number | null
          t40_profit_given_up?: number | null
          t40_recovered_to_tp?: boolean | null
          t40_saved_loss?: boolean | null
          t40_sim_exit_cents?: number | null
          t40_sim_pnl?: number | null
          t45_first_cross_mark?: number | null
          t45_first_cross_secs?: number | null
          t45_killed_winner?: boolean | null
          t45_loss_avoided?: number | null
          t45_minutes_remaining?: number | null
          t45_profit_given_up?: number | null
          t45_recovered_to_tp?: boolean | null
          t45_saved_loss?: boolean | null
          t45_sim_exit_cents?: number | null
          t45_sim_pnl?: number | null
          tape_samples?: number
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      auto_trade_loss_cap_resets: {
        Row: {
          created_at: string
          reset_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          reset_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          reset_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "auto_trade_loss_cap_resets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_trade_odds_shadow: {
        Row: {
          contracts: number
          early_exited: boolean
          entry_velocity_cents: number | null
          exit_cents: number | null
          exit_reason: string | null
          exited_at: string | null
          final_yes_cents: number | null
          fired_at: string
          flip_count_at_fire: number
          id: string
          limit_cents: number
          no_cents_at_fire: number
          parent_shadow_id: string | null
          pnl_usd: number | null
          rotation_index: number
          seconds_to_close_at_fire: number
          settled: boolean
          settled_at: string | null
          side: string
          spot_at_fire: number | null
          stake_usd: number
          strike: number
          ticker: string
          trigger: string
          user_id: string
          won: boolean | null
          yes_cents_at_fire: number
        }
        Insert: {
          contracts: number
          early_exited?: boolean
          entry_velocity_cents?: number | null
          exit_cents?: number | null
          exit_reason?: string | null
          exited_at?: string | null
          final_yes_cents?: number | null
          fired_at?: string
          flip_count_at_fire: number
          id?: string
          limit_cents: number
          no_cents_at_fire: number
          parent_shadow_id?: string | null
          pnl_usd?: number | null
          rotation_index?: number
          seconds_to_close_at_fire: number
          settled?: boolean
          settled_at?: string | null
          side: string
          spot_at_fire?: number | null
          stake_usd: number
          strike: number
          ticker: string
          trigger: string
          user_id: string
          won?: boolean | null
          yes_cents_at_fire: number
        }
        Update: {
          contracts?: number
          early_exited?: boolean
          entry_velocity_cents?: number | null
          exit_cents?: number | null
          exit_reason?: string | null
          exited_at?: string | null
          final_yes_cents?: number | null
          fired_at?: string
          flip_count_at_fire?: number
          id?: string
          limit_cents?: number
          no_cents_at_fire?: number
          parent_shadow_id?: string | null
          pnl_usd?: number | null
          rotation_index?: number
          seconds_to_close_at_fire?: number
          settled?: boolean
          settled_at?: string | null
          side?: string
          spot_at_fire?: number | null
          stake_usd?: number
          strike?: number
          ticker?: string
          trigger?: string
          user_id?: string
          won?: boolean | null
          yes_cents_at_fire?: number
        }
        Relationships: [
          {
            foreignKeyName: "auto_trade_odds_shadow_parent_shadow_id_fkey"
            columns: ["parent_shadow_id"]
            isOneToOne: false
            referencedRelation: "auto_trade_odds_shadow"
            referencedColumns: ["id"]
          },
        ]
      }
      auto_trade_odds_skip_log: {
        Row: {
          created_at: string
          detail: Json | null
          flip_count: number | null
          id: number
          no_cents: number | null
          reason: string
          seconds_to_close: number | null
          ticker: string
          trigger_candidate: string | null
          user_id: string
          yes_cents: number | null
        }
        Insert: {
          created_at?: string
          detail?: Json | null
          flip_count?: number | null
          id?: number
          no_cents?: number | null
          reason: string
          seconds_to_close?: number | null
          ticker: string
          trigger_candidate?: string | null
          user_id: string
          yes_cents?: number | null
        }
        Update: {
          created_at?: string
          detail?: Json | null
          flip_count?: number | null
          id?: number
          no_cents?: number | null
          reason?: string
          seconds_to_close?: number | null
          ticker?: string
          trigger_candidate?: string | null
          user_id?: string
          yes_cents?: number | null
        }
        Relationships: []
      }
      auto_trade_orders: {
        Row: {
          close_time: string
          contracts: number
          contracts_remaining: number | null
          created_at: string
          edge_pts: number
          entry_price_cents: number | null
          error_message: string | null
          event_ticker: string | null
          exit_ladder: Json | null
          gap_in_sigmas: number
          id: string
          inputs_snapshot: Json | null
          is_martingale: boolean
          kalshi_order_id: string | null
          limit_cents: number
          market_yes_price: number
          mode: string
          model_prob: number
          partial_pnl_usd: number
          pnl_usd: number | null
          seconds_to_close: number
          session_id: string
          settle_price: number | null
          settled_at: string | null
          side: string
          sigma_distance: number
          spot_at_entry: number
          stake_usd: number
          status: string
          strike: number
          ticker: string
          user_id: string
        }
        Insert: {
          close_time: string
          contracts: number
          contracts_remaining?: number | null
          created_at?: string
          edge_pts: number
          entry_price_cents?: number | null
          error_message?: string | null
          event_ticker?: string | null
          exit_ladder?: Json | null
          gap_in_sigmas: number
          id?: string
          inputs_snapshot?: Json | null
          is_martingale?: boolean
          kalshi_order_id?: string | null
          limit_cents: number
          market_yes_price: number
          mode?: string
          model_prob: number
          partial_pnl_usd?: number
          pnl_usd?: number | null
          seconds_to_close: number
          session_id: string
          settle_price?: number | null
          settled_at?: string | null
          side: string
          sigma_distance: number
          spot_at_entry: number
          stake_usd: number
          status?: string
          strike: number
          ticker: string
          user_id: string
        }
        Update: {
          close_time?: string
          contracts?: number
          contracts_remaining?: number | null
          created_at?: string
          edge_pts?: number
          entry_price_cents?: number | null
          error_message?: string | null
          event_ticker?: string | null
          exit_ladder?: Json | null
          gap_in_sigmas?: number
          id?: string
          inputs_snapshot?: Json | null
          is_martingale?: boolean
          kalshi_order_id?: string | null
          limit_cents?: number
          market_yes_price?: number
          mode?: string
          model_prob?: number
          partial_pnl_usd?: number
          pnl_usd?: number | null
          seconds_to_close?: number
          session_id?: string
          settle_price?: number | null
          settled_at?: string | null
          side?: string
          sigma_distance?: number
          spot_at_entry?: number
          stake_usd?: number
          status?: string
          strike?: number
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      auto_trade_skip_log: {
        Row: {
          ask_price: number | null
          close_time: string | null
          created_at: string
          ev_edge: number | null
          id: string
          model_prob: number | null
          seconds_to_close: number | null
          settle_price: number | null
          settled_at: string | null
          side: string
          sigma_distance: number | null
          skip_reason: string
          spot_at_skip: number | null
          strike: number | null
          ticker: string
          user_id: string
          would_have_pnl: number | null
          would_have_won: boolean | null
        }
        Insert: {
          ask_price?: number | null
          close_time?: string | null
          created_at?: string
          ev_edge?: number | null
          id?: string
          model_prob?: number | null
          seconds_to_close?: number | null
          settle_price?: number | null
          settled_at?: string | null
          side: string
          sigma_distance?: number | null
          skip_reason: string
          spot_at_skip?: number | null
          strike?: number | null
          ticker: string
          user_id: string
          would_have_pnl?: number | null
          would_have_won?: boolean | null
        }
        Update: {
          ask_price?: number | null
          close_time?: string | null
          created_at?: string
          ev_edge?: number | null
          id?: string
          model_prob?: number | null
          seconds_to_close?: number | null
          settle_price?: number | null
          settled_at?: string | null
          side?: string
          sigma_distance?: number | null
          skip_reason?: string
          spot_at_skip?: number | null
          strike?: number | null
          ticker?: string
          user_id?: string
          would_have_pnl?: number | null
          would_have_won?: boolean | null
        }
        Relationships: []
      }
      auto_trade_ta_shadow: {
        Row: {
          actual_outcome: string | null
          actual_pnl_usd: number | null
          all_three_agree: boolean | null
          created_at: string
          edge_pts: number | null
          full_loss: boolean | null
          id: string
          kalshi_direction: string | null
          kalshi_price_cents: number | null
          model_direction: string | null
          model_prob: number | null
          nearest_round_level: number | null
          order_id: string | null
          rejection_wick_flag: boolean | null
          resistance_level: number | null
          settled_at: string | null
          side_evaluated: string | null
          support_level: number | null
          ta_confidence: number | null
          ta_direction_1m: string | null
          ta_direction_5m: string | null
          ta_direction_combined: string | null
          ta_disagrees_kalshi: boolean | null
          ta_disagrees_model: boolean | null
          ta_reasons: Json | null
          ticker: string | null
          trend_1m: string | null
          trend_5m: string | null
          two_of_three_agree: boolean | null
          updated_at: string
          user_id: string
        }
        Insert: {
          actual_outcome?: string | null
          actual_pnl_usd?: number | null
          all_three_agree?: boolean | null
          created_at?: string
          edge_pts?: number | null
          full_loss?: boolean | null
          id?: string
          kalshi_direction?: string | null
          kalshi_price_cents?: number | null
          model_direction?: string | null
          model_prob?: number | null
          nearest_round_level?: number | null
          order_id?: string | null
          rejection_wick_flag?: boolean | null
          resistance_level?: number | null
          settled_at?: string | null
          side_evaluated?: string | null
          support_level?: number | null
          ta_confidence?: number | null
          ta_direction_1m?: string | null
          ta_direction_5m?: string | null
          ta_direction_combined?: string | null
          ta_disagrees_kalshi?: boolean | null
          ta_disagrees_model?: boolean | null
          ta_reasons?: Json | null
          ticker?: string | null
          trend_1m?: string | null
          trend_5m?: string | null
          two_of_three_agree?: boolean | null
          updated_at?: string
          user_id: string
        }
        Update: {
          actual_outcome?: string | null
          actual_pnl_usd?: number | null
          all_three_agree?: boolean | null
          created_at?: string
          edge_pts?: number | null
          full_loss?: boolean | null
          id?: string
          kalshi_direction?: string | null
          kalshi_price_cents?: number | null
          model_direction?: string | null
          model_prob?: number | null
          nearest_round_level?: number | null
          order_id?: string | null
          rejection_wick_flag?: boolean | null
          resistance_level?: number | null
          settled_at?: string | null
          side_evaluated?: string | null
          support_level?: number | null
          ta_confidence?: number | null
          ta_direction_1m?: string | null
          ta_direction_5m?: string | null
          ta_direction_combined?: string | null
          ta_disagrees_kalshi?: boolean | null
          ta_disagrees_model?: boolean | null
          ta_reasons?: Json | null
          ticker?: string | null
          trend_1m?: string | null
          trend_5m?: string | null
          two_of_three_agree?: boolean | null
          updated_at?: string
          user_id?: string
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
      big_flip_killswitch: {
        Row: {
          halted: boolean
          halted_at: string | null
          reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          halted?: boolean
          halted_at?: string | null
          reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          halted?: boolean
          halted_at?: string | null
          reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      big_flip_signals: {
        Row: {
          detected_at: string
          flip_at: string
          id: number
          new_no: number
          new_yes: number
          passed_rules: boolean
          prev_no: number
          prev_yes: number
          reject_reason: string | null
          seconds_to_close: number
          spot: number
          strike: number
          ticker: string
          to_side: string
          user_id: string
          yes_delta: number
        }
        Insert: {
          detected_at?: string
          flip_at: string
          id?: number
          new_no: number
          new_yes: number
          passed_rules: boolean
          prev_no: number
          prev_yes: number
          reject_reason?: string | null
          seconds_to_close: number
          spot: number
          strike: number
          ticker: string
          to_side: string
          user_id: string
          yes_delta: number
        }
        Update: {
          detected_at?: string
          flip_at?: string
          id?: number
          new_no?: number
          new_yes?: number
          passed_rules?: boolean
          prev_no?: number
          prev_yes?: number
          reject_reason?: string | null
          seconds_to_close?: number
          spot?: number
          strike?: number
          ticker?: string
          to_side?: string
          user_id?: string
          yes_delta?: number
        }
        Relationships: []
      }
      btc_calibration: {
        Row: {
          actual_rate: number | null
          avg_market_prob: number | null
          avg_model_prob: number | null
          avg_theory_prob: number | null
          correction_factor: number
          created_at: string
          id: string
          last_fitted_at: string | null
          n_correct: number
          n_samples: number
          sigma_bucket: string
          time_bucket: string
          updated_at: string
        }
        Insert: {
          actual_rate?: number | null
          avg_market_prob?: number | null
          avg_model_prob?: number | null
          avg_theory_prob?: number | null
          correction_factor?: number
          created_at?: string
          id?: string
          last_fitted_at?: string | null
          n_correct?: number
          n_samples?: number
          sigma_bucket: string
          time_bucket: string
          updated_at?: string
        }
        Update: {
          actual_rate?: number | null
          avg_market_prob?: number | null
          avg_model_prob?: number | null
          avg_theory_prob?: number | null
          correction_factor?: number
          created_at?: string
          id?: string
          last_fitted_at?: string | null
          n_correct?: number
          n_samples?: number
          sigma_bucket?: string
          time_bucket?: string
          updated_at?: string
        }
        Relationships: []
      }
      btc_isotonic_fit: {
        Row: {
          brier_test: number | null
          brier_train: number | null
          code_version: string | null
          data_cutoff: string | null
          fitted_at: string
          id: string
          logloss_test: number | null
          logloss_train: number | null
          n_test: number
          n_train: number
          pins: Json
          scope: string
          time_bucket: string | null
        }
        Insert: {
          brier_test?: number | null
          brier_train?: number | null
          code_version?: string | null
          data_cutoff?: string | null
          fitted_at?: string
          id?: string
          logloss_test?: number | null
          logloss_train?: number | null
          n_test: number
          n_train: number
          pins: Json
          scope: string
          time_bucket?: string | null
        }
        Update: {
          brier_test?: number | null
          brier_train?: number | null
          code_version?: string | null
          data_cutoff?: string | null
          fitted_at?: string
          id?: string
          logloss_test?: number | null
          logloss_train?: number | null
          n_test?: number
          n_train?: number
          pins?: Json
          scope?: string
          time_bucket?: string | null
        }
        Relationships: []
      }
      btc_model_predictions: {
        Row: {
          anchor_z: number | null
          chart_strength: number | null
          chart_verdict: string | null
          close_time: string
          created_at: string
          edge_pts: number
          event_ticker: string | null
          flip_count: number
          flipped_at: string | null
          id: string
          independent_prob: number | null
          jump_features: Json | null
          live_side: string | null
          market_yes_price: number
          model_prob: number
          outcome: string | null
          physics_prob: number | null
          settle_price: number | null
          settled_at: string | null
          side: string
          sigma_at_snapshot: number | null
          snapshot_seconds_to_close: number
          spot_at_snapshot: number
          strike: number
          theory_yes_prob: number | null
          ticker: string
          time_bucket: string | null
          updated_at: string
          was_correct: boolean | null
        }
        Insert: {
          anchor_z?: number | null
          chart_strength?: number | null
          chart_verdict?: string | null
          close_time: string
          created_at?: string
          edge_pts: number
          event_ticker?: string | null
          flip_count?: number
          flipped_at?: string | null
          id?: string
          independent_prob?: number | null
          jump_features?: Json | null
          live_side?: string | null
          market_yes_price: number
          model_prob: number
          outcome?: string | null
          physics_prob?: number | null
          settle_price?: number | null
          settled_at?: string | null
          side: string
          sigma_at_snapshot?: number | null
          snapshot_seconds_to_close: number
          spot_at_snapshot: number
          strike: number
          theory_yes_prob?: number | null
          ticker: string
          time_bucket?: string | null
          updated_at?: string
          was_correct?: boolean | null
        }
        Update: {
          anchor_z?: number | null
          chart_strength?: number | null
          chart_verdict?: string | null
          close_time?: string
          created_at?: string
          edge_pts?: number
          event_ticker?: string | null
          flip_count?: number
          flipped_at?: string | null
          id?: string
          independent_prob?: number | null
          jump_features?: Json | null
          live_side?: string | null
          market_yes_price?: number
          model_prob?: number
          outcome?: string | null
          physics_prob?: number | null
          settle_price?: number | null
          settled_at?: string | null
          side?: string
          sigma_at_snapshot?: number | null
          snapshot_seconds_to_close?: number
          spot_at_snapshot?: number
          strike?: number
          theory_yes_prob?: number | null
          ticker?: string
          time_bucket?: string | null
          updated_at?: string
          was_correct?: boolean | null
        }
        Relationships: []
      }
      btc_odds_tape: {
        Row: {
          id: number
          no_cents: number
          seconds_to_close: number
          snapped_at: string
          spot: number
          strike: number
          ticker: string
          user_id: string
          yes_cents: number
        }
        Insert: {
          id?: number
          no_cents: number
          seconds_to_close: number
          snapped_at?: string
          spot: number
          strike: number
          ticker: string
          user_id: string
          yes_cents: number
        }
        Update: {
          id?: number
          no_cents?: number
          seconds_to_close?: number
          snapped_at?: string
          spot?: number
          strike?: number
          ticker?: string
          user_id?: string
          yes_cents?: number
        }
        Relationships: []
      }
      btc_polymarket_triple_window: {
        Row: {
          actual_outcome: string | null
          combined_conf: number | null
          combined_dir: string | null
          created_at: string
          enrichment_json: Json | null
          expiration_value: number | null
          id: string
          kalshi_ticker: string
          market_close_ms: number
          market_open_ms: number
          settled_at: string | null
          trendline_1m: string | null
          trendline_5m: string | null
          updated_at: string
          w1_avg_prob: number | null
          w1_chart_strength: number | null
          w1_chart_verdict: string | null
          w1_close_prob: number | null
          w1_max_prob: number | null
          w1_min_prob: number | null
          w1_open_prob: number | null
          w1_samples: number | null
          w1_trendline_dir: string | null
          w2_avg_prob: number | null
          w2_chart_strength: number | null
          w2_chart_verdict: string | null
          w2_close_prob: number | null
          w2_max_prob: number | null
          w2_min_prob: number | null
          w2_open_prob: number | null
          w2_samples: number | null
          w2_trendline_dir: string | null
          w3_avg_prob: number | null
          w3_chart_strength: number | null
          w3_chart_verdict: string | null
          w3_close_prob: number | null
          w3_max_prob: number | null
          w3_min_prob: number | null
          w3_open_prob: number | null
          w3_samples: number | null
          w3_trendline_dir: string | null
        }
        Insert: {
          actual_outcome?: string | null
          combined_conf?: number | null
          combined_dir?: string | null
          created_at?: string
          enrichment_json?: Json | null
          expiration_value?: number | null
          id?: string
          kalshi_ticker: string
          market_close_ms: number
          market_open_ms: number
          settled_at?: string | null
          trendline_1m?: string | null
          trendline_5m?: string | null
          updated_at?: string
          w1_avg_prob?: number | null
          w1_chart_strength?: number | null
          w1_chart_verdict?: string | null
          w1_close_prob?: number | null
          w1_max_prob?: number | null
          w1_min_prob?: number | null
          w1_open_prob?: number | null
          w1_samples?: number | null
          w1_trendline_dir?: string | null
          w2_avg_prob?: number | null
          w2_chart_strength?: number | null
          w2_chart_verdict?: string | null
          w2_close_prob?: number | null
          w2_max_prob?: number | null
          w2_min_prob?: number | null
          w2_open_prob?: number | null
          w2_samples?: number | null
          w2_trendline_dir?: string | null
          w3_avg_prob?: number | null
          w3_chart_strength?: number | null
          w3_chart_verdict?: string | null
          w3_close_prob?: number | null
          w3_max_prob?: number | null
          w3_min_prob?: number | null
          w3_open_prob?: number | null
          w3_samples?: number | null
          w3_trendline_dir?: string | null
        }
        Update: {
          actual_outcome?: string | null
          combined_conf?: number | null
          combined_dir?: string | null
          created_at?: string
          enrichment_json?: Json | null
          expiration_value?: number | null
          id?: string
          kalshi_ticker?: string
          market_close_ms?: number
          market_open_ms?: number
          settled_at?: string | null
          trendline_1m?: string | null
          trendline_5m?: string | null
          updated_at?: string
          w1_avg_prob?: number | null
          w1_chart_strength?: number | null
          w1_chart_verdict?: string | null
          w1_close_prob?: number | null
          w1_max_prob?: number | null
          w1_min_prob?: number | null
          w1_open_prob?: number | null
          w1_samples?: number | null
          w1_trendline_dir?: string | null
          w2_avg_prob?: number | null
          w2_chart_strength?: number | null
          w2_chart_verdict?: string | null
          w2_close_prob?: number | null
          w2_max_prob?: number | null
          w2_min_prob?: number | null
          w2_open_prob?: number | null
          w2_samples?: number | null
          w2_trendline_dir?: string | null
          w3_avg_prob?: number | null
          w3_chart_strength?: number | null
          w3_chart_verdict?: string | null
          w3_close_prob?: number | null
          w3_max_prob?: number | null
          w3_min_prob?: number | null
          w3_open_prob?: number | null
          w3_samples?: number | null
          w3_trendline_dir?: string | null
        }
        Relationships: []
      }
      crypto_gate_shadow_sim: {
        Row: {
          created_at: string
          gate_name: string
          id: string
          order_id: string
          order_source: string
          outcome: string
          pnl_saved: number
          pnl_usd: number
          threshold: Json
          user_id: string
          would_have_blocked: boolean
        }
        Insert: {
          created_at?: string
          gate_name: string
          id?: string
          order_id: string
          order_source: string
          outcome: string
          pnl_saved: number
          pnl_usd: number
          threshold: Json
          user_id: string
          would_have_blocked: boolean
        }
        Update: {
          created_at?: string
          gate_name?: string
          id?: string
          order_id?: string
          order_source?: string
          outcome?: string
          pnl_saved?: number
          pnl_usd?: number
          threshold?: Json
          user_id?: string
          would_have_blocked?: boolean
        }
        Relationships: []
      }
      crypto_model_studies: {
        Row: {
          created_at: string
          dominant_failures: Json
          id: string
          miss_id_watermark: string | null
          misses_analyzed: number
          model: string
          raw: Json | null
          recommendations: Json
          summary: string
          user_id: string
          wins_analyzed: number
        }
        Insert: {
          created_at?: string
          dominant_failures?: Json
          id?: string
          miss_id_watermark?: string | null
          misses_analyzed?: number
          model: string
          raw?: Json | null
          recommendations?: Json
          summary: string
          user_id: string
          wins_analyzed?: number
        }
        Update: {
          created_at?: string
          dominant_failures?: Json
          id?: string
          miss_id_watermark?: string | null
          misses_analyzed?: number
          model?: string
          raw?: Json | null
          recommendations?: Json
          summary?: string
          user_id?: string
          wins_analyzed?: number
        }
        Relationships: []
      }
      crypto_study_feedback: {
        Row: {
          created_at: string
          id: string
          note: string | null
          rec_gate: string | null
          rec_index: number
          rec_suggested: string | null
          study_id: string
          updated_at: string
          user_id: string
          vote: string
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          rec_gate?: string | null
          rec_index: number
          rec_suggested?: string | null
          study_id: string
          updated_at?: string
          user_id: string
          vote: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          rec_gate?: string | null
          rec_index?: number
          rec_suggested?: string | null
          study_id?: string
          updated_at?: string
          user_id?: string
          vote?: string
        }
        Relationships: [
          {
            foreignKeyName: "crypto_study_feedback_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "crypto_model_studies"
            referencedColumns: ["id"]
          },
        ]
      }
      crypto_trade_misses: {
        Row: {
          actual_dir: string
          created_at: string
          diagnosed_reason: string
          id: string
          inputs_snapshot: Json | null
          pnl_usd: number | null
          predicted_dir: string
          reason_tags: string[]
          settle_price: number | null
          spot_at_entry: number | null
          strike: number | null
          ticker: string
          trade_id: string
          user_id: string
        }
        Insert: {
          actual_dir: string
          created_at?: string
          diagnosed_reason: string
          id?: string
          inputs_snapshot?: Json | null
          pnl_usd?: number | null
          predicted_dir: string
          reason_tags?: string[]
          settle_price?: number | null
          spot_at_entry?: number | null
          strike?: number | null
          ticker: string
          trade_id: string
          user_id: string
        }
        Update: {
          actual_dir?: string
          created_at?: string
          diagnosed_reason?: string
          id?: string
          inputs_snapshot?: Json | null
          pnl_usd?: number | null
          predicted_dir?: string
          reason_tags?: string[]
          settle_price?: number | null
          spot_at_entry?: number | null
          strike?: number | null
          ticker?: string
          trade_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crypto_trade_misses_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: true
            referencedRelation: "crypto_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      crypto_trades: {
        Row: {
          bankroll_usd: number | null
          chart_verdict_score: number | null
          close_time: string | null
          contracts: number
          created_at: string
          edge_pts: number | null
          error: string | null
          event_ticker: string | null
          id: string
          inputs_snapshot: Json | null
          kalshi_order_id: string | null
          kelly_multiplier: number | null
          market_yes_price: number | null
          model_prob: number | null
          outcome: string | null
          pnl_usd: number | null
          raw: Json | null
          settled_yes_price: number | null
          side: string
          spot_at_entry: number | null
          stake_usd: number
          status: string
          strike: number | null
          ticker: string
          user_id: string
        }
        Insert: {
          bankroll_usd?: number | null
          chart_verdict_score?: number | null
          close_time?: string | null
          contracts?: number
          created_at?: string
          edge_pts?: number | null
          error?: string | null
          event_ticker?: string | null
          id?: string
          inputs_snapshot?: Json | null
          kalshi_order_id?: string | null
          kelly_multiplier?: number | null
          market_yes_price?: number | null
          model_prob?: number | null
          outcome?: string | null
          pnl_usd?: number | null
          raw?: Json | null
          settled_yes_price?: number | null
          side: string
          spot_at_entry?: number | null
          stake_usd?: number
          status?: string
          strike?: number | null
          ticker: string
          user_id: string
        }
        Update: {
          bankroll_usd?: number | null
          chart_verdict_score?: number | null
          close_time?: string | null
          contracts?: number
          created_at?: string
          edge_pts?: number | null
          error?: string | null
          event_ticker?: string | null
          id?: string
          inputs_snapshot?: Json | null
          kalshi_order_id?: string | null
          kelly_multiplier?: number | null
          market_yes_price?: number | null
          model_prob?: number | null
          outcome?: string | null
          pnl_usd?: number | null
          raw?: Json | null
          settled_yes_price?: number | null
          side?: string
          spot_at_entry?: number | null
          stake_usd?: number
          status?: string
          strike?: number | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
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
      manual_kalshi_trades: {
        Row: {
          action: string
          contracts: number
          cost_usd: number | null
          created_at: string
          event_ticker: string | null
          filled_at: string
          id: string
          kalshi_order_id: string | null
          kalshi_trade_id: string
          pnl_usd: number | null
          price_cents: number
          raw: Json | null
          settle_price: number | null
          settled: boolean
          side: string
          ticker: string
          updated_at: string
          user_id: string
        }
        Insert: {
          action: string
          contracts: number
          cost_usd?: number | null
          created_at?: string
          event_ticker?: string | null
          filled_at: string
          id?: string
          kalshi_order_id?: string | null
          kalshi_trade_id: string
          pnl_usd?: number | null
          price_cents: number
          raw?: Json | null
          settle_price?: number | null
          settled?: boolean
          side: string
          ticker: string
          updated_at?: string
          user_id: string
        }
        Update: {
          action?: string
          contracts?: number
          cost_usd?: number | null
          created_at?: string
          event_ticker?: string | null
          filled_at?: string
          id?: string
          kalshi_order_id?: string | null
          kalshi_trade_id?: string
          pnl_usd?: number | null
          price_cents?: number
          raw?: Json | null
          settle_price?: number | null
          settled?: boolean
          side?: string
          ticker?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      martingale_recovery_state: {
        Row: {
          accepted_deficit_usd: number
          base_stake_usd: number
          consec_recovery_losses: number
          created_at: string
          deficit_usd: number
          enabled: boolean
          initial_deficit_usd: number
          last_shadow_id: string | null
          max_consec_recovery_losses: number
          max_stake_usd: number
          recovery_wins_completed: number
          session_loss_cap_usd: number
          session_loss_usd: number
          session_started_at: string
          stopped_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accepted_deficit_usd?: number
          base_stake_usd?: number
          consec_recovery_losses?: number
          created_at?: string
          deficit_usd?: number
          enabled?: boolean
          initial_deficit_usd?: number
          last_shadow_id?: string | null
          max_consec_recovery_losses?: number
          max_stake_usd?: number
          recovery_wins_completed?: number
          session_loss_cap_usd?: number
          session_loss_usd?: number
          session_started_at?: string
          stopped_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accepted_deficit_usd?: number
          base_stake_usd?: number
          consec_recovery_losses?: number
          created_at?: string
          deficit_usd?: number
          enabled?: boolean
          initial_deficit_usd?: number
          last_shadow_id?: string | null
          max_consec_recovery_losses?: number
          max_stake_usd?: number
          recovery_wins_completed?: number
          session_loss_cap_usd?: number
          session_loss_usd?: number
          session_started_at?: string
          stopped_reason?: string | null
          updated_at?: string
          user_id?: string
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
      polymarket_btc_tape: {
        Row: {
          agrees: boolean | null
          down_prob: number
          id: string
          kalshi_our_side_cents: number | null
          kalshi_side: string | null
          kalshi_ticker: string | null
          slug: string
          snapped_at: string
          up_prob: number
          user_id: string
          window_start: string
        }
        Insert: {
          agrees?: boolean | null
          down_prob: number
          id?: string
          kalshi_our_side_cents?: number | null
          kalshi_side?: string | null
          kalshi_ticker?: string | null
          slug: string
          snapped_at?: string
          up_prob: number
          user_id: string
          window_start: string
        }
        Update: {
          agrees?: boolean | null
          down_prob?: number
          id?: string
          kalshi_our_side_cents?: number | null
          kalshi_side?: string | null
          kalshi_ticker?: string | null
          slug?: string
          snapped_at?: string
          up_prob?: number
          user_id?: string
          window_start?: string
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
          kalshi_api_key_id: string | null
          kalshi_private_key_pem: string | null
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
          kalshi_api_key_id?: string | null
          kalshi_private_key_pem?: string | null
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
          kalshi_api_key_id?: string | null
          kalshi_private_key_pem?: string | null
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
      email_queue_dispatch: { Args: never; Returns: undefined }
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
