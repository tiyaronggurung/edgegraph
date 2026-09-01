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
      auto_model_bet_errors: {
        Row: {
          created_at: string
          error: string
          id: string
          price_cents: number | null
          side: string | null
          stage: string
          stake_usd: number | null
          ticker: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          error: string
          id?: string
          price_cents?: number | null
          side?: string | null
          stage: string
          stake_usd?: number | null
          ticker?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          error?: string
          id?: string
          price_cents?: number | null
          side?: string | null
          stage?: string
          stake_usd?: number | null
          ticker?: string | null
          user_id?: string
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
      auto_odds_conviction_exit_shadow: {
        Row: {
          created_at: string
          current_bid_cents: number | null
          current_prob: number | null
          entry_ask_cents: number | null
          entry_prob: number | null
          hypothetical_exit_pnl: number | null
          id: string
          order_id: string
          prob_drop: number | null
          seconds_since_entry: number | null
          seconds_to_close: number | null
          settled_outcome: string | null
          settled_pnl: number | null
          signed_edge_now: number | null
          tick_at: string
          ticker: string
          user_id: string
          would_exit_010: boolean | null
          would_exit_015: boolean | null
          would_exit_020: boolean | null
        }
        Insert: {
          created_at?: string
          current_bid_cents?: number | null
          current_prob?: number | null
          entry_ask_cents?: number | null
          entry_prob?: number | null
          hypothetical_exit_pnl?: number | null
          id?: string
          order_id: string
          prob_drop?: number | null
          seconds_since_entry?: number | null
          seconds_to_close?: number | null
          settled_outcome?: string | null
          settled_pnl?: number | null
          signed_edge_now?: number | null
          tick_at?: string
          ticker: string
          user_id: string
          would_exit_010?: boolean | null
          would_exit_015?: boolean | null
          would_exit_020?: boolean | null
        }
        Update: {
          created_at?: string
          current_bid_cents?: number | null
          current_prob?: number | null
          entry_ask_cents?: number | null
          entry_prob?: number | null
          hypothetical_exit_pnl?: number | null
          id?: string
          order_id?: string
          prob_drop?: number | null
          seconds_since_entry?: number | null
          seconds_to_close?: number | null
          settled_outcome?: string | null
          settled_pnl?: number | null
          signed_edge_now?: number | null
          tick_at?: string
          ticker?: string
          user_id?: string
          would_exit_010?: boolean | null
          would_exit_015?: boolean | null
          would_exit_020?: boolean | null
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
          entry_ask_prob: number | null
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
          odds_band_eligible: boolean | null
          order_id: string | null
          orderflow_score: number | null
          picked_side: string
          prediction_direction_10min_ago: string | null
          prediction_direction_1min_ago: string | null
          prediction_direction_3min_ago: string | null
          prediction_direction_5min_ago: string | null
          prediction_duration_seconds: number | null
          prediction_flip_count: number | null
          realized_pnl_usd: number | null
          seconds_to_close: number | null
          sigma_distance: number | null
          sigma_multiplier: number | null
          sigma_score: number | null
          signed_edge: number | null
          signed_edge_veto_003_would_skip: boolean | null
          signed_edge_veto_005_would_skip: boolean | null
          signed_edge_veto_008_would_skip: boolean | null
          spot: number | null
          stake_used: number | null
          theoretical_pnl_100: number | null
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
          entry_ask_prob?: number | null
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
          odds_band_eligible?: boolean | null
          order_id?: string | null
          orderflow_score?: number | null
          picked_side: string
          prediction_direction_10min_ago?: string | null
          prediction_direction_1min_ago?: string | null
          prediction_direction_3min_ago?: string | null
          prediction_direction_5min_ago?: string | null
          prediction_duration_seconds?: number | null
          prediction_flip_count?: number | null
          realized_pnl_usd?: number | null
          seconds_to_close?: number | null
          sigma_distance?: number | null
          sigma_multiplier?: number | null
          sigma_score?: number | null
          signed_edge?: number | null
          signed_edge_veto_003_would_skip?: boolean | null
          signed_edge_veto_005_would_skip?: boolean | null
          signed_edge_veto_008_would_skip?: boolean | null
          spot?: number | null
          stake_used?: number | null
          theoretical_pnl_100?: number | null
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
          entry_ask_prob?: number | null
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
          odds_band_eligible?: boolean | null
          order_id?: string | null
          orderflow_score?: number | null
          picked_side?: string
          prediction_direction_10min_ago?: string | null
          prediction_direction_1min_ago?: string | null
          prediction_direction_3min_ago?: string | null
          prediction_direction_5min_ago?: string | null
          prediction_duration_seconds?: number | null
          prediction_flip_count?: number | null
          realized_pnl_usd?: number | null
          seconds_to_close?: number | null
          sigma_distance?: number | null
          sigma_multiplier?: number | null
          sigma_score?: number | null
          signed_edge?: number | null
          signed_edge_veto_003_would_skip?: boolean | null
          signed_edge_veto_005_would_skip?: boolean | null
          signed_edge_veto_008_would_skip?: boolean | null
          spot?: number | null
          stake_used?: number | null
          theoretical_pnl_100?: number | null
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
          exit_edge_decay_cents: number
          exit_flip_prob: number
          exit_late_sl_frac: number
          exit_odds_flip_cents: number
          exit_sl_frac: number
          exit_tp_frac: number
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
          exit_edge_decay_cents?: number
          exit_flip_prob?: number
          exit_late_sl_frac?: number
          exit_odds_flip_cents?: number
          exit_sl_frac?: number
          exit_tp_frac?: number
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
          exit_edge_decay_cents?: number
          exit_flip_prob?: number
          exit_late_sl_frac?: number
          exit_odds_flip_cents?: number
          exit_sl_frac?: number
          exit_tp_frac?: number
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
          entered_at: string | null
          entry_ask_cents: number | null
          entry_model_prob: number | null
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
          entered_at?: string | null
          entry_ask_cents?: number | null
          entry_model_prob?: number | null
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
          entered_at?: string | null
          entry_ask_cents?: number | null
          entry_model_prob?: number | null
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
          ctx_adx_15m: number | null
          ctx_bb_5m_pctb: number | null
          ctx_engine_version: string | null
          ctx_macd_15m_hist: number | null
          ctx_nearest_resistance_distance_pct: number | null
          ctx_nearest_support_distance_pct: number | null
          ctx_rsi_15m: number | null
          ctx_rsi_1h: number | null
          ctx_trend_alignment_score: number | null
          ctx_vp_price_position: string | null
          ctx_vwap_distance_pct: number | null
          dwell_gate_would_skip: boolean
          edge_pts: number
          entry_price_cents: number | null
          error_message: string | null
          event_ticker: string | null
          exit_ladder: Json | null
          funding_rate_at_fire: number | null
          funding_zscore_30d: number | null
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
          raw_dir_dwell_at_fire: number | null
          raw_streak_at_fire: number | null
          seconds_to_close: number
          session_id: string
          settle_price: number | null
          settle_spike_would_skip: boolean
          settle_spike_z_at_fire: number | null
          settled_at: string | null
          side: string
          sigma_distance: number
          spot_at_entry: number
          stake_usd: number
          status: string
          streak3_would_skip: boolean | null
          strike: number
          ticker: string
          user_id: string
        }
        Insert: {
          close_time: string
          contracts: number
          contracts_remaining?: number | null
          created_at?: string
          ctx_adx_15m?: number | null
          ctx_bb_5m_pctb?: number | null
          ctx_engine_version?: string | null
          ctx_macd_15m_hist?: number | null
          ctx_nearest_resistance_distance_pct?: number | null
          ctx_nearest_support_distance_pct?: number | null
          ctx_rsi_15m?: number | null
          ctx_rsi_1h?: number | null
          ctx_trend_alignment_score?: number | null
          ctx_vp_price_position?: string | null
          ctx_vwap_distance_pct?: number | null
          dwell_gate_would_skip?: boolean
          edge_pts: number
          entry_price_cents?: number | null
          error_message?: string | null
          event_ticker?: string | null
          exit_ladder?: Json | null
          funding_rate_at_fire?: number | null
          funding_zscore_30d?: number | null
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
          raw_dir_dwell_at_fire?: number | null
          raw_streak_at_fire?: number | null
          seconds_to_close: number
          session_id: string
          settle_price?: number | null
          settle_spike_would_skip?: boolean
          settle_spike_z_at_fire?: number | null
          settled_at?: string | null
          side: string
          sigma_distance: number
          spot_at_entry: number
          stake_usd: number
          status?: string
          streak3_would_skip?: boolean | null
          strike: number
          ticker: string
          user_id: string
        }
        Update: {
          close_time?: string
          contracts?: number
          contracts_remaining?: number | null
          created_at?: string
          ctx_adx_15m?: number | null
          ctx_bb_5m_pctb?: number | null
          ctx_engine_version?: string | null
          ctx_macd_15m_hist?: number | null
          ctx_nearest_resistance_distance_pct?: number | null
          ctx_nearest_support_distance_pct?: number | null
          ctx_rsi_15m?: number | null
          ctx_rsi_1h?: number | null
          ctx_trend_alignment_score?: number | null
          ctx_vp_price_position?: string | null
          ctx_vwap_distance_pct?: number | null
          dwell_gate_would_skip?: boolean
          edge_pts?: number
          entry_price_cents?: number | null
          error_message?: string | null
          event_ticker?: string | null
          exit_ladder?: Json | null
          funding_rate_at_fire?: number | null
          funding_zscore_30d?: number | null
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
          raw_dir_dwell_at_fire?: number | null
          raw_streak_at_fire?: number | null
          seconds_to_close?: number
          session_id?: string
          settle_price?: number | null
          settle_spike_would_skip?: boolean
          settle_spike_z_at_fire?: number | null
          settled_at?: string | null
          side?: string
          sigma_distance?: number
          spot_at_entry?: number
          stake_usd?: number
          status?: string
          streak3_would_skip?: boolean | null
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
      big_flip_lead_shadow: {
        Row: {
          brr_proxy: number | null
          brr_sample_count: number | null
          cheap_ask_cents: number
          cheap_side: string
          created_at: string
          gate_decision: string
          gate_reason: string | null
          id: string
          lead_delta: number | null
          live_fired: boolean
          model_prob: number | null
          model_side: string | null
          outcome: string | null
          pnl_usd: number | null
          seconds_to_close: number | null
          spot: number | null
          strike: number | null
          ticker: string
          user_id: string
        }
        Insert: {
          brr_proxy?: number | null
          brr_sample_count?: number | null
          cheap_ask_cents: number
          cheap_side: string
          created_at?: string
          gate_decision: string
          gate_reason?: string | null
          id?: string
          lead_delta?: number | null
          live_fired?: boolean
          model_prob?: number | null
          model_side?: string | null
          outcome?: string | null
          pnl_usd?: number | null
          seconds_to_close?: number | null
          spot?: number | null
          strike?: number | null
          ticker: string
          user_id: string
        }
        Update: {
          brr_proxy?: number | null
          brr_sample_count?: number | null
          cheap_ask_cents?: number
          cheap_side?: string
          created_at?: string
          gate_decision?: string
          gate_reason?: string | null
          id?: string
          lead_delta?: number | null
          live_fired?: boolean
          model_prob?: number | null
          model_side?: string | null
          outcome?: string | null
          pnl_usd?: number | null
          seconds_to_close?: number | null
          spot?: number | null
          strike?: number | null
          ticker?: string
          user_id?: string
        }
        Relationships: []
      }
      big_flip_signals: {
        Row: {
          detected_at: string
          fill_count: number | null
          fill_price_cents: number | null
          flip_at: string
          id: number
          kalshi_trade_id: string | null
          min_ask_cents: number | null
          model_side_conf: number | null
          new_no: number
          new_yes: number
          paper_fill_id: string | null
          passed_rules: boolean
          prev_no: number
          prev_yes: number
          reject_reason: string | null
          seconds_to_close: number
          spot: number
          strike: number
          ticker: string
          to_side: string
          trigger_kind: string
          user_id: string
          yes_delta: number
        }
        Insert: {
          detected_at?: string
          fill_count?: number | null
          fill_price_cents?: number | null
          flip_at: string
          id?: number
          kalshi_trade_id?: string | null
          min_ask_cents?: number | null
          model_side_conf?: number | null
          new_no: number
          new_yes: number
          paper_fill_id?: string | null
          passed_rules: boolean
          prev_no: number
          prev_yes: number
          reject_reason?: string | null
          seconds_to_close: number
          spot: number
          strike: number
          ticker: string
          to_side: string
          trigger_kind?: string
          user_id: string
          yes_delta: number
        }
        Update: {
          detected_at?: string
          fill_count?: number | null
          fill_price_cents?: number | null
          flip_at?: string
          id?: number
          kalshi_trade_id?: string | null
          min_ask_cents?: number | null
          model_side_conf?: number | null
          new_no?: number
          new_yes?: number
          paper_fill_id?: string | null
          passed_rules?: boolean
          prev_no?: number
          prev_yes?: number
          reject_reason?: string | null
          seconds_to_close?: number
          spot?: number
          strike?: number
          ticker?: string
          to_side?: string
          trigger_kind?: string
          user_id?: string
          yes_delta?: number
        }
        Relationships: [
          {
            foreignKeyName: "big_flip_signals_kalshi_trade_id_fkey"
            columns: ["kalshi_trade_id"]
            isOneToOne: false
            referencedRelation: "crypto_trades"
            referencedColumns: ["id"]
          },
        ]
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
      btc_candles: {
        Row: {
          bucket_start: string
          c: number
          h: number
          l: number
          o: number
          source: string | null
          tf: string
          updated_at: string
          v: number | null
        }
        Insert: {
          bucket_start: string
          c: number
          h: number
          l: number
          o: number
          source?: string | null
          tf: string
          updated_at?: string
          v?: number | null
        }
        Update: {
          bucket_start?: string
          c?: number
          h?: number
          l?: number
          o?: number
          source?: string | null
          tf?: string
          updated_at?: string
          v?: number | null
        }
        Relationships: []
      }
      btc_cross_exit_shadow: {
        Row: {
          close_time: string
          combined_pnl_cents: number | null
          created_at: string
          cross_cushion_usd: number | null
          cross_detected: boolean
          cross_seconds_to_close: number | null
          cross_spot: number | null
          cross_time: string | null
          entry_bid_cents: number | null
          entry_price_cents: number
          entry_seconds_to_close: number | null
          entry_side: string
          entry_spot: number | null
          entry_time: string
          exit_bid_cents: number | null
          exit_pnl_cents: number | null
          exit_reason: string | null
          flip_ask_cents: number | null
          flip_pnl_cents: number | null
          flip_reason: string | null
          flip_side: string | null
          flip_time_cutoff_seconds: number
          hold_pnl_cents: number | null
          id: string
          max_flip_ask_cents: number
          outcome: string | null
          settled: boolean
          source: string
          strike: number
          ticker: string
          trade_id: string | null
          updated_at: string
          would_exit: boolean
          would_flip: boolean
        }
        Insert: {
          close_time: string
          combined_pnl_cents?: number | null
          created_at?: string
          cross_cushion_usd?: number | null
          cross_detected?: boolean
          cross_seconds_to_close?: number | null
          cross_spot?: number | null
          cross_time?: string | null
          entry_bid_cents?: number | null
          entry_price_cents: number
          entry_seconds_to_close?: number | null
          entry_side: string
          entry_spot?: number | null
          entry_time: string
          exit_bid_cents?: number | null
          exit_pnl_cents?: number | null
          exit_reason?: string | null
          flip_ask_cents?: number | null
          flip_pnl_cents?: number | null
          flip_reason?: string | null
          flip_side?: string | null
          flip_time_cutoff_seconds?: number
          hold_pnl_cents?: number | null
          id?: string
          max_flip_ask_cents?: number
          outcome?: string | null
          settled?: boolean
          source?: string
          strike: number
          ticker: string
          trade_id?: string | null
          updated_at?: string
          would_exit?: boolean
          would_flip?: boolean
        }
        Update: {
          close_time?: string
          combined_pnl_cents?: number | null
          created_at?: string
          cross_cushion_usd?: number | null
          cross_detected?: boolean
          cross_seconds_to_close?: number | null
          cross_spot?: number | null
          cross_time?: string | null
          entry_bid_cents?: number | null
          entry_price_cents?: number
          entry_seconds_to_close?: number | null
          entry_side?: string
          entry_spot?: number | null
          entry_time?: string
          exit_bid_cents?: number | null
          exit_pnl_cents?: number | null
          exit_reason?: string | null
          flip_ask_cents?: number | null
          flip_pnl_cents?: number | null
          flip_reason?: string | null
          flip_side?: string | null
          flip_time_cutoff_seconds?: number
          hold_pnl_cents?: number | null
          id?: string
          max_flip_ask_cents?: number
          outcome?: string | null
          settled?: boolean
          source?: string
          strike?: number
          ticker?: string
          trade_id?: string | null
          updated_at?: string
          would_exit?: boolean
          would_flip?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "btc_cross_exit_shadow_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "ops_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      btc_gate_config: {
        Row: {
          btc_entry_gate_enabled: boolean
          config_version: number
          cvv_atr_lookback_hours: number
          cvv_atr_mult: number
          cvv_mode: string
          cvv_momentum_max_usd: number
          id: number
          log_gate_decisions: boolean
          max_ask_cents: number
          max_ask_mode: string
          min_calibrated_edge_points: number
          min_side_confidence: number
          positive_edge_mode: string
          require_live_side_agreement: boolean
          skip_guard_cushion_hard_usd: number
          skip_guard_cushion_soft_usd: number
          skip_guard_min_conf_tight: number
          skip_guard_mode: string
          slippage_buffer_prob: number
          updated_at: string
        }
        Insert: {
          btc_entry_gate_enabled?: boolean
          config_version?: number
          cvv_atr_lookback_hours?: number
          cvv_atr_mult?: number
          cvv_mode?: string
          cvv_momentum_max_usd?: number
          id?: number
          log_gate_decisions?: boolean
          max_ask_cents?: number
          max_ask_mode?: string
          min_calibrated_edge_points?: number
          min_side_confidence?: number
          positive_edge_mode?: string
          require_live_side_agreement?: boolean
          skip_guard_cushion_hard_usd?: number
          skip_guard_cushion_soft_usd?: number
          skip_guard_min_conf_tight?: number
          skip_guard_mode?: string
          slippage_buffer_prob?: number
          updated_at?: string
        }
        Update: {
          btc_entry_gate_enabled?: boolean
          config_version?: number
          cvv_atr_lookback_hours?: number
          cvv_atr_mult?: number
          cvv_mode?: string
          cvv_momentum_max_usd?: number
          id?: number
          log_gate_decisions?: boolean
          max_ask_cents?: number
          max_ask_mode?: string
          min_calibrated_edge_points?: number
          min_side_confidence?: number
          positive_edge_mode?: string
          require_live_side_agreement?: boolean
          skip_guard_cushion_hard_usd?: number
          skip_guard_cushion_soft_usd?: number
          skip_guard_min_conf_tight?: number
          skip_guard_mode?: string
          slippage_buffer_prob?: number
          updated_at?: string
        }
        Relationships: []
      }
      btc_gate_decision_log: {
        Row: {
          all_reasons: Json | null
          calibrated_edge: number | null
          close_time: string | null
          config_version: number | null
          decision_bucket: number
          decision_ts: string
          estimated_fee: number | null
          event_id: string | null
          fee_adjusted_edge: number | null
          gate_action: string
          id: number
          live_agreement_passed: boolean | null
          live_side: string | null
          live_side_disagrees: boolean | null
          locked_side: string
          model_prob: number | null
          no_ask: number | null
          no_bid: number | null
          positive_edge_mode: string | null
          positive_edge_passed: boolean | null
          positive_edge_shadow_pass: boolean | null
          primary_reason: string | null
          raw_model_edge: number | null
          require_live_agreement: boolean | null
          require_positive_edge: boolean | null
          seconds_to_close: number | null
          selected_side_ask: number | null
          side_conf_threshold: number | null
          side_confidence: number | null
          side_confidence_passed: boolean | null
          slippage_adjusted_edge: number | null
          source_path: string
          ticker: string
          yes_ask: number | null
          yes_bid: number | null
        }
        Insert: {
          all_reasons?: Json | null
          calibrated_edge?: number | null
          close_time?: string | null
          config_version?: number | null
          decision_bucket: number
          decision_ts?: string
          estimated_fee?: number | null
          event_id?: string | null
          fee_adjusted_edge?: number | null
          gate_action: string
          id?: number
          live_agreement_passed?: boolean | null
          live_side?: string | null
          live_side_disagrees?: boolean | null
          locked_side: string
          model_prob?: number | null
          no_ask?: number | null
          no_bid?: number | null
          positive_edge_mode?: string | null
          positive_edge_passed?: boolean | null
          positive_edge_shadow_pass?: boolean | null
          primary_reason?: string | null
          raw_model_edge?: number | null
          require_live_agreement?: boolean | null
          require_positive_edge?: boolean | null
          seconds_to_close?: number | null
          selected_side_ask?: number | null
          side_conf_threshold?: number | null
          side_confidence?: number | null
          side_confidence_passed?: boolean | null
          slippage_adjusted_edge?: number | null
          source_path: string
          ticker: string
          yes_ask?: number | null
          yes_bid?: number | null
        }
        Update: {
          all_reasons?: Json | null
          calibrated_edge?: number | null
          close_time?: string | null
          config_version?: number | null
          decision_bucket?: number
          decision_ts?: string
          estimated_fee?: number | null
          event_id?: string | null
          fee_adjusted_edge?: number | null
          gate_action?: string
          id?: number
          live_agreement_passed?: boolean | null
          live_side?: string | null
          live_side_disagrees?: boolean | null
          locked_side?: string
          model_prob?: number | null
          no_ask?: number | null
          no_bid?: number | null
          positive_edge_mode?: string | null
          positive_edge_passed?: boolean | null
          positive_edge_shadow_pass?: boolean | null
          primary_reason?: string | null
          raw_model_edge?: number | null
          require_live_agreement?: boolean | null
          require_positive_edge?: boolean | null
          seconds_to_close?: number | null
          selected_side_ask?: number | null
          side_conf_threshold?: number | null
          side_confidence?: number | null
          side_confidence_passed?: boolean | null
          slippage_adjusted_edge?: number | null
          source_path?: string
          ticker?: string
          yes_ask?: number | null
          yes_bid?: number | null
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
      btc_kalshi_odds_snapshots: {
        Row: {
          created_at: string
          delta_up: number | null
          id: number
          kalshi_implied_spot: number | null
          kalshi_last_price_cents: number | null
          kalshi_no_vol_60s: number | null
          kalshi_open_interest: number | null
          kalshi_trade_count_60s: number | null
          kalshi_volume: number | null
          kalshi_yes_ask: number | null
          kalshi_yes_bid: number | null
          kalshi_yes_mid: number | null
          kalshi_yes_vol_60s: number | null
          our_down_ask: number | null
          our_mid: number | null
          our_sigma: number | null
          our_tilt: number | null
          our_up_ask: number | null
          seconds_to_close: number | null
          snap_bucket_sec: number
          snapped_at: string
          spot_buy_vol_1m: number | null
          spot_buy_vol_win: number | null
          spot_composite: number | null
          spot_sell_vol_1m: number | null
          spot_sell_vol_win: number | null
          spot_vol_imb_1m: number | null
          spot_vol_imb_win: number | null
          strike: number
          ticker: string
        }
        Insert: {
          created_at?: string
          delta_up?: number | null
          id?: number
          kalshi_implied_spot?: number | null
          kalshi_last_price_cents?: number | null
          kalshi_no_vol_60s?: number | null
          kalshi_open_interest?: number | null
          kalshi_trade_count_60s?: number | null
          kalshi_volume?: number | null
          kalshi_yes_ask?: number | null
          kalshi_yes_bid?: number | null
          kalshi_yes_mid?: number | null
          kalshi_yes_vol_60s?: number | null
          our_down_ask?: number | null
          our_mid?: number | null
          our_sigma?: number | null
          our_tilt?: number | null
          our_up_ask?: number | null
          seconds_to_close?: number | null
          snap_bucket_sec: number
          snapped_at?: string
          spot_buy_vol_1m?: number | null
          spot_buy_vol_win?: number | null
          spot_composite?: number | null
          spot_sell_vol_1m?: number | null
          spot_sell_vol_win?: number | null
          spot_vol_imb_1m?: number | null
          spot_vol_imb_win?: number | null
          strike: number
          ticker: string
        }
        Update: {
          created_at?: string
          delta_up?: number | null
          id?: number
          kalshi_implied_spot?: number | null
          kalshi_last_price_cents?: number | null
          kalshi_no_vol_60s?: number | null
          kalshi_open_interest?: number | null
          kalshi_trade_count_60s?: number | null
          kalshi_volume?: number | null
          kalshi_yes_ask?: number | null
          kalshi_yes_bid?: number | null
          kalshi_yes_mid?: number | null
          kalshi_yes_vol_60s?: number | null
          our_down_ask?: number | null
          our_mid?: number | null
          our_sigma?: number | null
          our_tilt?: number | null
          our_up_ask?: number | null
          seconds_to_close?: number | null
          snap_bucket_sec?: number
          snapped_at?: string
          spot_buy_vol_1m?: number | null
          spot_buy_vol_win?: number | null
          spot_composite?: number | null
          spot_sell_vol_1m?: number | null
          spot_sell_vol_win?: number | null
          spot_vol_imb_1m?: number | null
          spot_vol_imb_win?: number | null
          strike?: number
          ticker?: string
        }
        Relationships: []
      }
      btc_market_context: {
        Row: {
          adx_15m: number | null
          adx_15m_minus_di: number | null
          adx_15m_plus_di: number | null
          bb_5m_bandwidth: number | null
          bb_5m_lower: number | null
          bb_5m_mid: number | null
          bb_5m_pctb: number | null
          bb_5m_squeeze: boolean | null
          bb_5m_upper: number | null
          captured_at: string
          checkpoint_type: string
          context_engine_version: string
          fired: boolean
          id: string
          macd_15m_cross: string | null
          macd_15m_hist: number | null
          macd_15m_line: number | null
          macd_15m_signal: number | null
          macd_5m_cross: string | null
          macd_5m_hist: number | null
          macd_5m_line: number | null
          macd_5m_signal: number | null
          model_prob: number | null
          model_side: string | null
          nearest_resistance: number | null
          nearest_resistance_distance_pct: number | null
          nearest_resistance_distance_usd: number | null
          nearest_resistance_tf: string | null
          nearest_resistance_touches: number | null
          nearest_support: number | null
          nearest_support_distance_pct: number | null
          nearest_support_distance_usd: number | null
          nearest_support_tf: string | null
          nearest_support_touches: number | null
          order_id: string | null
          raw_json: Json | null
          rsi_15m: number | null
          rsi_1h: number | null
          rsi_5m: number | null
          side_conf: number | null
          spot_price: number | null
          sr_algorithm_version: string
          sr_zones_json: Json | null
          strike_distance_atr: number | null
          strike_distance_em: number | null
          strike_distance_pct: number | null
          strike_distance_usd: number | null
          strike_price: number | null
          ticker: string
          trend_15m: string | null
          trend_1h: string | null
          trend_1m: string | null
          trend_4h: string | null
          trend_5m: string | null
          trend_alignment_score: number | null
          volume_profile_version: string
          vp_poc: number | null
          vp_price_position: string | null
          vp_vah: number | null
          vp_val: number | null
          vwap_above: boolean | null
          vwap_distance_pct: number | null
          vwap_distance_usd: number | null
          vwap_session: number | null
          window_end_ts: string
          window_start_ts: string
        }
        Insert: {
          adx_15m?: number | null
          adx_15m_minus_di?: number | null
          adx_15m_plus_di?: number | null
          bb_5m_bandwidth?: number | null
          bb_5m_lower?: number | null
          bb_5m_mid?: number | null
          bb_5m_pctb?: number | null
          bb_5m_squeeze?: boolean | null
          bb_5m_upper?: number | null
          captured_at?: string
          checkpoint_type: string
          context_engine_version?: string
          fired?: boolean
          id?: string
          macd_15m_cross?: string | null
          macd_15m_hist?: number | null
          macd_15m_line?: number | null
          macd_15m_signal?: number | null
          macd_5m_cross?: string | null
          macd_5m_hist?: number | null
          macd_5m_line?: number | null
          macd_5m_signal?: number | null
          model_prob?: number | null
          model_side?: string | null
          nearest_resistance?: number | null
          nearest_resistance_distance_pct?: number | null
          nearest_resistance_distance_usd?: number | null
          nearest_resistance_tf?: string | null
          nearest_resistance_touches?: number | null
          nearest_support?: number | null
          nearest_support_distance_pct?: number | null
          nearest_support_distance_usd?: number | null
          nearest_support_tf?: string | null
          nearest_support_touches?: number | null
          order_id?: string | null
          raw_json?: Json | null
          rsi_15m?: number | null
          rsi_1h?: number | null
          rsi_5m?: number | null
          side_conf?: number | null
          spot_price?: number | null
          sr_algorithm_version?: string
          sr_zones_json?: Json | null
          strike_distance_atr?: number | null
          strike_distance_em?: number | null
          strike_distance_pct?: number | null
          strike_distance_usd?: number | null
          strike_price?: number | null
          ticker: string
          trend_15m?: string | null
          trend_1h?: string | null
          trend_1m?: string | null
          trend_4h?: string | null
          trend_5m?: string | null
          trend_alignment_score?: number | null
          volume_profile_version?: string
          vp_poc?: number | null
          vp_price_position?: string | null
          vp_vah?: number | null
          vp_val?: number | null
          vwap_above?: boolean | null
          vwap_distance_pct?: number | null
          vwap_distance_usd?: number | null
          vwap_session?: number | null
          window_end_ts: string
          window_start_ts: string
        }
        Update: {
          adx_15m?: number | null
          adx_15m_minus_di?: number | null
          adx_15m_plus_di?: number | null
          bb_5m_bandwidth?: number | null
          bb_5m_lower?: number | null
          bb_5m_mid?: number | null
          bb_5m_pctb?: number | null
          bb_5m_squeeze?: boolean | null
          bb_5m_upper?: number | null
          captured_at?: string
          checkpoint_type?: string
          context_engine_version?: string
          fired?: boolean
          id?: string
          macd_15m_cross?: string | null
          macd_15m_hist?: number | null
          macd_15m_line?: number | null
          macd_15m_signal?: number | null
          macd_5m_cross?: string | null
          macd_5m_hist?: number | null
          macd_5m_line?: number | null
          macd_5m_signal?: number | null
          model_prob?: number | null
          model_side?: string | null
          nearest_resistance?: number | null
          nearest_resistance_distance_pct?: number | null
          nearest_resistance_distance_usd?: number | null
          nearest_resistance_tf?: string | null
          nearest_resistance_touches?: number | null
          nearest_support?: number | null
          nearest_support_distance_pct?: number | null
          nearest_support_distance_usd?: number | null
          nearest_support_tf?: string | null
          nearest_support_touches?: number | null
          order_id?: string | null
          raw_json?: Json | null
          rsi_15m?: number | null
          rsi_1h?: number | null
          rsi_5m?: number | null
          side_conf?: number | null
          spot_price?: number | null
          sr_algorithm_version?: string
          sr_zones_json?: Json | null
          strike_distance_atr?: number | null
          strike_distance_em?: number | null
          strike_distance_pct?: number | null
          strike_distance_usd?: number | null
          strike_price?: number | null
          ticker?: string
          trend_15m?: string | null
          trend_1h?: string | null
          trend_1m?: string | null
          trend_4h?: string | null
          trend_5m?: string | null
          trend_alignment_score?: number | null
          volume_profile_version?: string
          vp_poc?: number | null
          vp_price_position?: string | null
          vp_vah?: number | null
          vp_val?: number | null
          vwap_above?: boolean | null
          vwap_distance_pct?: number | null
          vwap_distance_usd?: number | null
          vwap_session?: number | null
          window_end_ts?: string
          window_start_ts?: string
        }
        Relationships: []
      }
      btc_market_intel: {
        Row: {
          calculation_duration_ms: number | null
          chop_score: number
          close_time: string
          compression_score: number
          confidence: number
          continuation_score: number
          created_at: string
          decision_ts: string | null
          direction: string
          exhaustion_score: number
          expansion_score: number
          expected_move_15m_pct: number
          expected_move_15m_usd: number
          id: string
          input_lag_ms: number | null
          market_intel_version: string
          market_state: string
          market_window_id: string | null
          nearest_psych_level: number | null
          outcome: string | null
          pnl_usd: number | null
          prediction_id: string | null
          psych_distance_atr: number | null
          psych_distance_usd: number | null
          psych_level_interval: number | null
          psych_level_role: string | null
          psych_level_strength: number | null
          psych_state: string | null
          reasons_jsonb: Json
          reversal_score: number
          round_confluence_score: number | null
          seconds_to_close: number | null
          sequence_state: string | null
          settle_price: number | null
          settlement_link_status: string | null
          signals_jsonb: Json
          spot_at_compute: number
          status: string
          strike: number
          strike_distance_in_expected_moves: number
          strike_distance_usd: number
          structure_direction: string
          structure_strength: number
          ticker: string
          time_bucket: string | null
          user_id: string | null
          volatility_regime: string
          warnings_jsonb: Json
          window_close_ts: string | null
          window_open_ts: string | null
          window_start: string
        }
        Insert: {
          calculation_duration_ms?: number | null
          chop_score?: number
          close_time: string
          compression_score?: number
          confidence: number
          continuation_score?: number
          created_at?: string
          decision_ts?: string | null
          direction: string
          exhaustion_score?: number
          expansion_score?: number
          expected_move_15m_pct: number
          expected_move_15m_usd: number
          id?: string
          input_lag_ms?: number | null
          market_intel_version: string
          market_state: string
          market_window_id?: string | null
          nearest_psych_level?: number | null
          outcome?: string | null
          pnl_usd?: number | null
          prediction_id?: string | null
          psych_distance_atr?: number | null
          psych_distance_usd?: number | null
          psych_level_interval?: number | null
          psych_level_role?: string | null
          psych_level_strength?: number | null
          psych_state?: string | null
          reasons_jsonb?: Json
          reversal_score?: number
          round_confluence_score?: number | null
          seconds_to_close?: number | null
          sequence_state?: string | null
          settle_price?: number | null
          settlement_link_status?: string | null
          signals_jsonb?: Json
          spot_at_compute: number
          status?: string
          strike: number
          strike_distance_in_expected_moves: number
          strike_distance_usd: number
          structure_direction: string
          structure_strength: number
          ticker: string
          time_bucket?: string | null
          user_id?: string | null
          volatility_regime: string
          warnings_jsonb?: Json
          window_close_ts?: string | null
          window_open_ts?: string | null
          window_start: string
        }
        Update: {
          calculation_duration_ms?: number | null
          chop_score?: number
          close_time?: string
          compression_score?: number
          confidence?: number
          continuation_score?: number
          created_at?: string
          decision_ts?: string | null
          direction?: string
          exhaustion_score?: number
          expansion_score?: number
          expected_move_15m_pct?: number
          expected_move_15m_usd?: number
          id?: string
          input_lag_ms?: number | null
          market_intel_version?: string
          market_state?: string
          market_window_id?: string | null
          nearest_psych_level?: number | null
          outcome?: string | null
          pnl_usd?: number | null
          prediction_id?: string | null
          psych_distance_atr?: number | null
          psych_distance_usd?: number | null
          psych_level_interval?: number | null
          psych_level_role?: string | null
          psych_level_strength?: number | null
          psych_state?: string | null
          reasons_jsonb?: Json
          reversal_score?: number
          round_confluence_score?: number | null
          seconds_to_close?: number | null
          sequence_state?: string | null
          settle_price?: number | null
          settlement_link_status?: string | null
          signals_jsonb?: Json
          spot_at_compute?: number
          status?: string
          strike?: number
          strike_distance_in_expected_moves?: number
          strike_distance_usd?: number
          structure_direction?: string
          structure_strength?: number
          ticker?: string
          time_bucket?: string | null
          user_id?: string | null
          volatility_regime?: string
          warnings_jsonb?: Json
          window_close_ts?: string | null
          window_open_ts?: string | null
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "btc_market_intel_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "btc_model_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      btc_model_predictions: {
        Row: {
          anchor_z: number | null
          chart_strength: number | null
          chart_verdict: string | null
          close_time: string
          created_at: string
          cvv_atr_usd: number | null
          cvv_cushion_usd: number | null
          cvv_momentum_usd: number | null
          cvv_reason: string | null
          cvv_verdict: string | null
          cvv_would_lock_conf: number | null
          cvv_would_lock_side: string | null
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
          model_side_pre_study: string | null
          outcome: string | null
          physics_prob: number | null
          settle_price: number | null
          settled_at: string | null
          side: string
          sigma_at_snapshot: number | null
          skip_guard_cushion_usd: number | null
          skip_guard_reason: string | null
          skip_guard_verdict: string | null
          snapshot_seconds_to_close: number
          spot_at_snapshot: number
          strike: number
          study_auto_live_fired_at: string | null
          study_lock_confidence: number | null
          study_lock_kalshi_price_cents: number | null
          study_lock_seconds_to_close: number | null
          study_lock_source: string | null
          study_locked_at: string | null
          study_locked_side: string | null
          study_t7_at: string | null
          study_t7_conf: number | null
          study_t7_ratio: number | null
          study_t7_seconds_to_close: number | null
          study_t7_side: string | null
          study_t7_source: string | null
          study_t7_spot: number | null
          ta_bb_5m_pctb: number | null
          ta_engine_version: string | null
          ta_macd_5m_hist: number | null
          ta_reasons: Json | null
          ta_rsi_1m: number | null
          ta_rsi_5m: number | null
          ta_score: number | null
          ta_trend_alignment_score: number | null
          ta_vwap_dist_pct: number | null
          ta_vwap_rej_down: boolean
          ta_vwap_rej_up: boolean
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
          cvv_atr_usd?: number | null
          cvv_cushion_usd?: number | null
          cvv_momentum_usd?: number | null
          cvv_reason?: string | null
          cvv_verdict?: string | null
          cvv_would_lock_conf?: number | null
          cvv_would_lock_side?: string | null
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
          model_side_pre_study?: string | null
          outcome?: string | null
          physics_prob?: number | null
          settle_price?: number | null
          settled_at?: string | null
          side: string
          sigma_at_snapshot?: number | null
          skip_guard_cushion_usd?: number | null
          skip_guard_reason?: string | null
          skip_guard_verdict?: string | null
          snapshot_seconds_to_close: number
          spot_at_snapshot: number
          strike: number
          study_auto_live_fired_at?: string | null
          study_lock_confidence?: number | null
          study_lock_kalshi_price_cents?: number | null
          study_lock_seconds_to_close?: number | null
          study_lock_source?: string | null
          study_locked_at?: string | null
          study_locked_side?: string | null
          study_t7_at?: string | null
          study_t7_conf?: number | null
          study_t7_ratio?: number | null
          study_t7_seconds_to_close?: number | null
          study_t7_side?: string | null
          study_t7_source?: string | null
          study_t7_spot?: number | null
          ta_bb_5m_pctb?: number | null
          ta_engine_version?: string | null
          ta_macd_5m_hist?: number | null
          ta_reasons?: Json | null
          ta_rsi_1m?: number | null
          ta_rsi_5m?: number | null
          ta_score?: number | null
          ta_trend_alignment_score?: number | null
          ta_vwap_dist_pct?: number | null
          ta_vwap_rej_down?: boolean
          ta_vwap_rej_up?: boolean
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
          cvv_atr_usd?: number | null
          cvv_cushion_usd?: number | null
          cvv_momentum_usd?: number | null
          cvv_reason?: string | null
          cvv_verdict?: string | null
          cvv_would_lock_conf?: number | null
          cvv_would_lock_side?: string | null
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
          model_side_pre_study?: string | null
          outcome?: string | null
          physics_prob?: number | null
          settle_price?: number | null
          settled_at?: string | null
          side?: string
          sigma_at_snapshot?: number | null
          skip_guard_cushion_usd?: number | null
          skip_guard_reason?: string | null
          skip_guard_verdict?: string | null
          snapshot_seconds_to_close?: number
          spot_at_snapshot?: number
          strike?: number
          study_auto_live_fired_at?: string | null
          study_lock_confidence?: number | null
          study_lock_kalshi_price_cents?: number | null
          study_lock_seconds_to_close?: number | null
          study_lock_source?: string | null
          study_locked_at?: string | null
          study_locked_side?: string | null
          study_t7_at?: string | null
          study_t7_conf?: number | null
          study_t7_ratio?: number | null
          study_t7_seconds_to_close?: number | null
          study_t7_side?: string | null
          study_t7_source?: string | null
          study_t7_spot?: number | null
          ta_bb_5m_pctb?: number | null
          ta_engine_version?: string | null
          ta_macd_5m_hist?: number | null
          ta_reasons?: Json | null
          ta_rsi_1m?: number | null
          ta_rsi_5m?: number | null
          ta_score?: number | null
          ta_trend_alignment_score?: number | null
          ta_vwap_dist_pct?: number | null
          ta_vwap_rej_down?: boolean
          ta_vwap_rej_up?: boolean
          theory_yes_prob?: number | null
          ticker?: string
          time_bucket?: string | null
          updated_at?: string
          was_correct?: boolean | null
        }
        Relationships: []
      }
      btc_multi_tf_decision_log: {
        Row: {
          above_session_vwap: boolean | null
          atr_5m: number | null
          bias_1h: string | null
          bias_monthly: string | null
          bias_weekly: string | null
          conflict_reason: string | null
          created_at: string
          decision_state: string
          eligible_to_fire: boolean | null
          engine_version: string
          expected_value_after_fees: number | null
          id: string
          kalshi_ask: number | null
          kalshi_bid: number | null
          mae_usd: number | null
          mfe_usd: number | null
          model_prob: number | null
          multi_tf_result: string | null
          multi_tf_side: string | null
          nearest_resistance_distance: number | null
          nearest_resistance_status: string | null
          nearest_resistance_touches: number | null
          nearest_resistance_usd: number | null
          nearest_support_distance: number | null
          nearest_support_status: string | null
          nearest_support_touches: number | null
          nearest_support_usd: number | null
          proposed_side: string | null
          range_pct_24h: number | null
          range_pct_monthly: number | null
          range_pct_weekly: number | null
          seconds_to_close: number
          settled_close: number | null
          settled_outcome: string | null
          side_at_t_minus_1m: string | null
          side_at_t_minus_2m: string | null
          side_at_t_minus_30s: string | null
          side_at_t_minus_3m: string | null
          side_at_t_minus_5m: string | null
          side_confidence: number | null
          side_flip_count: number | null
          snapshot_at: string
          spot_price: number | null
          strike_distance_atr: number | null
          strike_distance_usd: number | null
          strike_price: number | null
          structure_1m: string | null
          structure_5m: string | null
          ta_only_result: string | null
          ta_only_side: string | null
          ta_reasons: Json | null
          ta_score: number | null
          window_close_at: string
          window_open_at: string
          window_ticker: string
        }
        Insert: {
          above_session_vwap?: boolean | null
          atr_5m?: number | null
          bias_1h?: string | null
          bias_monthly?: string | null
          bias_weekly?: string | null
          conflict_reason?: string | null
          created_at?: string
          decision_state: string
          eligible_to_fire?: boolean | null
          engine_version?: string
          expected_value_after_fees?: number | null
          id?: string
          kalshi_ask?: number | null
          kalshi_bid?: number | null
          mae_usd?: number | null
          mfe_usd?: number | null
          model_prob?: number | null
          multi_tf_result?: string | null
          multi_tf_side?: string | null
          nearest_resistance_distance?: number | null
          nearest_resistance_status?: string | null
          nearest_resistance_touches?: number | null
          nearest_resistance_usd?: number | null
          nearest_support_distance?: number | null
          nearest_support_status?: string | null
          nearest_support_touches?: number | null
          nearest_support_usd?: number | null
          proposed_side?: string | null
          range_pct_24h?: number | null
          range_pct_monthly?: number | null
          range_pct_weekly?: number | null
          seconds_to_close: number
          settled_close?: number | null
          settled_outcome?: string | null
          side_at_t_minus_1m?: string | null
          side_at_t_minus_2m?: string | null
          side_at_t_minus_30s?: string | null
          side_at_t_minus_3m?: string | null
          side_at_t_minus_5m?: string | null
          side_confidence?: number | null
          side_flip_count?: number | null
          snapshot_at?: string
          spot_price?: number | null
          strike_distance_atr?: number | null
          strike_distance_usd?: number | null
          strike_price?: number | null
          structure_1m?: string | null
          structure_5m?: string | null
          ta_only_result?: string | null
          ta_only_side?: string | null
          ta_reasons?: Json | null
          ta_score?: number | null
          window_close_at: string
          window_open_at: string
          window_ticker: string
        }
        Update: {
          above_session_vwap?: boolean | null
          atr_5m?: number | null
          bias_1h?: string | null
          bias_monthly?: string | null
          bias_weekly?: string | null
          conflict_reason?: string | null
          created_at?: string
          decision_state?: string
          eligible_to_fire?: boolean | null
          engine_version?: string
          expected_value_after_fees?: number | null
          id?: string
          kalshi_ask?: number | null
          kalshi_bid?: number | null
          mae_usd?: number | null
          mfe_usd?: number | null
          model_prob?: number | null
          multi_tf_result?: string | null
          multi_tf_side?: string | null
          nearest_resistance_distance?: number | null
          nearest_resistance_status?: string | null
          nearest_resistance_touches?: number | null
          nearest_resistance_usd?: number | null
          nearest_support_distance?: number | null
          nearest_support_status?: string | null
          nearest_support_touches?: number | null
          nearest_support_usd?: number | null
          proposed_side?: string | null
          range_pct_24h?: number | null
          range_pct_monthly?: number | null
          range_pct_weekly?: number | null
          seconds_to_close?: number
          settled_close?: number | null
          settled_outcome?: string | null
          side_at_t_minus_1m?: string | null
          side_at_t_minus_2m?: string | null
          side_at_t_minus_30s?: string | null
          side_at_t_minus_3m?: string | null
          side_at_t_minus_5m?: string | null
          side_confidence?: number | null
          side_flip_count?: number | null
          snapshot_at?: string
          spot_price?: number | null
          strike_distance_atr?: number | null
          strike_distance_usd?: number | null
          strike_price?: number | null
          structure_1m?: string | null
          structure_5m?: string | null
          ta_only_result?: string | null
          ta_only_side?: string | null
          ta_reasons?: Json | null
          ta_score?: number | null
          window_close_at?: string
          window_open_at?: string
          window_ticker?: string
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
      btc_pin_risk_shadow: {
        Row: {
          close_time: string
          created_at: string
          cushion_decay_usd_per_min: number | null
          cushion_usd: number | null
          flipped: boolean | null
          id: number
          implied_vs_composite_usd: number | null
          locked_side: string
          losing_ask_climb_cents: number | null
          losing_vol_ratio: number | null
          observed_at: string
          outcome: string | null
          score_ask_climb: number
          score_cushion: number
          score_divergence: number
          score_ta: number
          score_total: number
          score_volume: number
          seconds_to_close: number
          spot: number | null
          strike: number
          ta_flipped_against: boolean | null
          ta_score: number | null
          ticker: string
        }
        Insert: {
          close_time: string
          created_at?: string
          cushion_decay_usd_per_min?: number | null
          cushion_usd?: number | null
          flipped?: boolean | null
          id?: number
          implied_vs_composite_usd?: number | null
          locked_side: string
          losing_ask_climb_cents?: number | null
          losing_vol_ratio?: number | null
          observed_at?: string
          outcome?: string | null
          score_ask_climb?: number
          score_cushion?: number
          score_divergence?: number
          score_ta?: number
          score_total?: number
          score_volume?: number
          seconds_to_close: number
          spot?: number | null
          strike: number
          ta_flipped_against?: boolean | null
          ta_score?: number | null
          ticker: string
        }
        Update: {
          close_time?: string
          created_at?: string
          cushion_decay_usd_per_min?: number | null
          cushion_usd?: number | null
          flipped?: boolean | null
          id?: number
          implied_vs_composite_usd?: number | null
          locked_side?: string
          losing_ask_climb_cents?: number | null
          losing_vol_ratio?: number | null
          observed_at?: string
          outcome?: string | null
          score_ask_climb?: number
          score_cushion?: number
          score_divergence?: number
          score_ta?: number
          score_total?: number
          score_volume?: number
          seconds_to_close?: number
          spot?: number | null
          strike?: number
          ta_flipped_against?: boolean | null
          ta_score?: number | null
          ticker?: string
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
      btc_side_ticks: {
        Row: {
          above_strike_ratio_90s: number | null
          buy_price: number | null
          close_time: string | null
          created_at: string
          evaluated_at: string
          id: number
          mem_score: number | null
          mid_price: number | null
          reco_conf_pct: number | null
          reco_side: string | null
          seconds_to_close: number
          sell_price: number | null
          source: string
          spot: number | null
          strike: number | null
          ticker: string
          user_id: string | null
        }
        Insert: {
          above_strike_ratio_90s?: number | null
          buy_price?: number | null
          close_time?: string | null
          created_at?: string
          evaluated_at?: string
          id?: number
          mem_score?: number | null
          mid_price?: number | null
          reco_conf_pct?: number | null
          reco_side?: string | null
          seconds_to_close: number
          sell_price?: number | null
          source?: string
          spot?: number | null
          strike?: number | null
          ticker: string
          user_id?: string | null
        }
        Update: {
          above_strike_ratio_90s?: number | null
          buy_price?: number | null
          close_time?: string | null
          created_at?: string
          evaluated_at?: string
          id?: number
          mem_score?: number | null
          mid_price?: number | null
          reco_conf_pct?: number | null
          reco_side?: string | null
          seconds_to_close?: number
          sell_price?: number | null
          source?: string
          spot?: number | null
          strike?: number | null
          ticker?: string
          user_id?: string | null
        }
        Relationships: []
      }
      btc_spot_ticks: {
        Row: {
          aggressor_side: string | null
          ask: number | null
          bid: number | null
          id: number
          latency_ms: number | null
          observed_at: string
          observed_at_sec: number
          out_of_order: boolean
          received_at: string
          source: string
          source_timestamp: string | null
          spot: number
          volume: number | null
        }
        Insert: {
          aggressor_side?: string | null
          ask?: number | null
          bid?: number | null
          id?: number
          latency_ms?: number | null
          observed_at: string
          observed_at_sec: number
          out_of_order?: boolean
          received_at?: string
          source: string
          source_timestamp?: string | null
          spot: number
          volume?: number | null
        }
        Update: {
          aggressor_side?: string | null
          ask?: number | null
          bid?: number | null
          id?: number
          latency_ms?: number | null
          observed_at?: string
          observed_at_sec?: number
          out_of_order?: boolean
          received_at?: string
          source?: string
          source_timestamp?: string | null
          spot?: number
          volume?: number | null
        }
        Relationships: []
      }
      btc_trendline_config: {
        Row: {
          booster_mode: string
          id: number
          min_channel_width_pct: number
          min_swings: number
          quality_gates_enabled: boolean
          updated_at: string
        }
        Insert: {
          booster_mode?: string
          id?: number
          min_channel_width_pct?: number
          min_swings?: number
          quality_gates_enabled?: boolean
          updated_at?: string
        }
        Update: {
          booster_mode?: string
          id?: number
          min_channel_width_pct?: number
          min_swings?: number
          quality_gates_enabled?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      btc_trendline_shadow: {
        Row: {
          channel_width_pct: number | null
          created_at: string
          dist_to_lower_pct: number | null
          dist_to_upper_pct: number | null
          evaluated_at: string
          id: string
          is_wedge: boolean
          lower_intercept: number | null
          lower_price_now: number | null
          lower_slope: number | null
          next_return_15m: number | null
          outcome: string | null
          outcome_settled_at: string | null
          seconds_to_close: number | null
          spike_body_ratio: number | null
          spike_break_pct: number | null
          spike_detected: boolean
          spike_direction: string | null
          spot: number
          strike: number | null
          swings_used: number | null
          ticker: string
          upper_intercept: number | null
          upper_price_now: number | null
          upper_slope: number | null
          user_id: string
          wedge_bias: string | null
        }
        Insert: {
          channel_width_pct?: number | null
          created_at?: string
          dist_to_lower_pct?: number | null
          dist_to_upper_pct?: number | null
          evaluated_at?: string
          id?: string
          is_wedge?: boolean
          lower_intercept?: number | null
          lower_price_now?: number | null
          lower_slope?: number | null
          next_return_15m?: number | null
          outcome?: string | null
          outcome_settled_at?: string | null
          seconds_to_close?: number | null
          spike_body_ratio?: number | null
          spike_break_pct?: number | null
          spike_detected?: boolean
          spike_direction?: string | null
          spot: number
          strike?: number | null
          swings_used?: number | null
          ticker: string
          upper_intercept?: number | null
          upper_price_now?: number | null
          upper_slope?: number | null
          user_id: string
          wedge_bias?: string | null
        }
        Update: {
          channel_width_pct?: number | null
          created_at?: string
          dist_to_lower_pct?: number | null
          dist_to_upper_pct?: number | null
          evaluated_at?: string
          id?: string
          is_wedge?: boolean
          lower_intercept?: number | null
          lower_price_now?: number | null
          lower_slope?: number | null
          next_return_15m?: number | null
          outcome?: string | null
          outcome_settled_at?: string | null
          seconds_to_close?: number | null
          spike_body_ratio?: number | null
          spike_break_pct?: number | null
          spike_detected?: boolean
          spike_direction?: string | null
          spot?: number
          strike?: number | null
          swings_used?: number | null
          ticker?: string
          upper_intercept?: number | null
          upper_price_now?: number | null
          upper_slope?: number | null
          user_id?: string
          wedge_bias?: string | null
        }
        Relationships: []
      }
      btc_window_snapshots: {
        Row: {
          captured_at: string
          close_time: string
          created_at: string
          cushion_usd: number | null
          id: string
          kalshi_snapshot_at: string | null
          kalshi_snapshot_source: string | null
          model_confidence: number | null
          model_side: string | null
          no_ask_cents: number | null
          no_bid_cents: number | null
          open_interest: number | null
          outcome: string | null
          seconds_to_close: number
          source: string
          spot_usd: number | null
          strike_usd: number | null
          study_confidence: number | null
          study_locked: boolean
          study_side: string | null
          ticker: string
          trendline_buy: number | null
          trendline_mid: number | null
          trendline_position: string | null
          trendline_sell: number | null
          volume: number | null
          yes_ask_cents: number | null
          yes_bid_cents: number | null
        }
        Insert: {
          captured_at?: string
          close_time: string
          created_at?: string
          cushion_usd?: number | null
          id?: string
          kalshi_snapshot_at?: string | null
          kalshi_snapshot_source?: string | null
          model_confidence?: number | null
          model_side?: string | null
          no_ask_cents?: number | null
          no_bid_cents?: number | null
          open_interest?: number | null
          outcome?: string | null
          seconds_to_close: number
          source?: string
          spot_usd?: number | null
          strike_usd?: number | null
          study_confidence?: number | null
          study_locked?: boolean
          study_side?: string | null
          ticker: string
          trendline_buy?: number | null
          trendline_mid?: number | null
          trendline_position?: string | null
          trendline_sell?: number | null
          volume?: number | null
          yes_ask_cents?: number | null
          yes_bid_cents?: number | null
        }
        Update: {
          captured_at?: string
          close_time?: string
          created_at?: string
          cushion_usd?: number | null
          id?: string
          kalshi_snapshot_at?: string | null
          kalshi_snapshot_source?: string | null
          model_confidence?: number | null
          model_side?: string | null
          no_ask_cents?: number | null
          no_bid_cents?: number | null
          open_interest?: number | null
          outcome?: string | null
          seconds_to_close?: number
          source?: string
          spot_usd?: number | null
          strike_usd?: number | null
          study_confidence?: number | null
          study_locked?: boolean
          study_side?: string | null
          ticker?: string
          trendline_buy?: number | null
          trendline_mid?: number | null
          trendline_position?: string | null
          trendline_sell?: number | null
          volume?: number | null
          yes_ask_cents?: number | null
          yes_bid_cents?: number | null
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
      ev_decision_log: {
        Row: {
          actual_outcome: string | null
          calibration_bucket: string | null
          close_time: string
          created_at: string
          edge_prob: number
          edge_pts: number
          ev_per_contract: number
          ev_per_stake_10: number
          event_ticker: string | null
          fee_est: number
          id: number
          kalshi_no_price: number
          kalshi_yes_price: number
          market_implied_prob: number
          min_conf_threshold: number | null
          min_edge_threshold: number | null
          min_ev_threshold: number | null
          model_prob: number
          model_side: string
          model_side_prob: number
          passes_conf: boolean | null
          passes_edge: boolean | null
          passes_ev: boolean | null
          passes_price_ceiling: boolean | null
          price_ceiling: number | null
          realized_pnl_10: number | null
          regime_tag: string | null
          seconds_to_close: number
          selected_side_ask: number
          settled_at: string | null
          side_confidence: number | null
          snapshot_bucket: string
          snapshot_ts: string
          spot_at_snapshot: number | null
          strike: number | null
          target_offset_seconds: number | null
          ticker: string
          was_correct: boolean | null
          would_fire: boolean
          would_fire_gated: boolean | null
        }
        Insert: {
          actual_outcome?: string | null
          calibration_bucket?: string | null
          close_time: string
          created_at?: string
          edge_prob: number
          edge_pts: number
          ev_per_contract: number
          ev_per_stake_10: number
          event_ticker?: string | null
          fee_est: number
          id?: number
          kalshi_no_price: number
          kalshi_yes_price: number
          market_implied_prob: number
          min_conf_threshold?: number | null
          min_edge_threshold?: number | null
          min_ev_threshold?: number | null
          model_prob: number
          model_side: string
          model_side_prob: number
          passes_conf?: boolean | null
          passes_edge?: boolean | null
          passes_ev?: boolean | null
          passes_price_ceiling?: boolean | null
          price_ceiling?: number | null
          realized_pnl_10?: number | null
          regime_tag?: string | null
          seconds_to_close: number
          selected_side_ask: number
          settled_at?: string | null
          side_confidence?: number | null
          snapshot_bucket: string
          snapshot_ts?: string
          spot_at_snapshot?: number | null
          strike?: number | null
          target_offset_seconds?: number | null
          ticker: string
          was_correct?: boolean | null
          would_fire: boolean
          would_fire_gated?: boolean | null
        }
        Update: {
          actual_outcome?: string | null
          calibration_bucket?: string | null
          close_time?: string
          created_at?: string
          edge_prob?: number
          edge_pts?: number
          ev_per_contract?: number
          ev_per_stake_10?: number
          event_ticker?: string | null
          fee_est?: number
          id?: number
          kalshi_no_price?: number
          kalshi_yes_price?: number
          market_implied_prob?: number
          min_conf_threshold?: number | null
          min_edge_threshold?: number | null
          min_ev_threshold?: number | null
          model_prob?: number
          model_side?: string
          model_side_prob?: number
          passes_conf?: boolean | null
          passes_edge?: boolean | null
          passes_ev?: boolean | null
          passes_price_ceiling?: boolean | null
          price_ceiling?: number | null
          realized_pnl_10?: number | null
          regime_tag?: string | null
          seconds_to_close?: number
          selected_side_ask?: number
          settled_at?: string | null
          side_confidence?: number | null
          snapshot_bucket?: string
          snapshot_ts?: string
          spot_at_snapshot?: number | null
          strike?: number | null
          target_offset_seconds?: number | null
          ticker?: string
          was_correct?: boolean | null
          would_fire?: boolean
          would_fire_gated?: boolean | null
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
      kalshi_book_ledger: {
        Row: {
          close_time: string | null
          created_at: string
          house_if_no: number | null
          house_if_yes: number | null
          house_lean: string | null
          house_pnl: number | null
          id: string
          last_seen_at: string
          last_trade_ts: number | null
          no_avg_cents: number | null
          no_cost: number | null
          no_payout: number | null
          no_vol: number | null
          outcome: string | null
          settled_at: string | null
          strike: number | null
          ticker: string
          total_collected: number | null
          trade_count: number | null
          window_start: string
          yes_avg_cents: number | null
          yes_cost: number | null
          yes_payout: number | null
          yes_vol: number | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          house_if_no?: number | null
          house_if_yes?: number | null
          house_lean?: string | null
          house_pnl?: number | null
          id?: string
          last_seen_at?: string
          last_trade_ts?: number | null
          no_avg_cents?: number | null
          no_cost?: number | null
          no_payout?: number | null
          no_vol?: number | null
          outcome?: string | null
          settled_at?: string | null
          strike?: number | null
          ticker: string
          total_collected?: number | null
          trade_count?: number | null
          window_start: string
          yes_avg_cents?: number | null
          yes_cost?: number | null
          yes_payout?: number | null
          yes_vol?: number | null
        }
        Update: {
          close_time?: string | null
          created_at?: string
          house_if_no?: number | null
          house_if_yes?: number | null
          house_lean?: string | null
          house_pnl?: number | null
          id?: string
          last_seen_at?: string
          last_trade_ts?: number | null
          no_avg_cents?: number | null
          no_cost?: number | null
          no_payout?: number | null
          no_vol?: number | null
          outcome?: string | null
          settled_at?: string | null
          strike?: number | null
          ticker?: string
          total_collected?: number | null
          trade_count?: number | null
          window_start?: string
          yes_avg_cents?: number | null
          yes_cost?: number | null
          yes_payout?: number | null
          yes_vol?: number | null
        }
        Relationships: []
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
      model_loss_autopsy: {
        Row: {
          chart_verdict: string | null
          close_time: string
          created_at: string
          edge_pts: number | null
          failure_tags: string[]
          flip_count: number | null
          id: string
          model_prob: number
          model_side: string
          outcome: string
          primary_tag: string | null
          snapshot_seconds_to_close: number | null
          spot_at_snapshot: number | null
          strike: number | null
          strike_distance_pct: number | null
          ta_engine_version: string | null
          ta_score: number | null
          ticker: string
        }
        Insert: {
          chart_verdict?: string | null
          close_time: string
          created_at?: string
          edge_pts?: number | null
          failure_tags?: string[]
          flip_count?: number | null
          id?: string
          model_prob: number
          model_side: string
          outcome: string
          primary_tag?: string | null
          snapshot_seconds_to_close?: number | null
          spot_at_snapshot?: number | null
          strike?: number | null
          strike_distance_pct?: number | null
          ta_engine_version?: string | null
          ta_score?: number | null
          ticker: string
        }
        Update: {
          chart_verdict?: string | null
          close_time?: string
          created_at?: string
          edge_pts?: number | null
          failure_tags?: string[]
          flip_count?: number | null
          id?: string
          model_prob?: number
          model_side?: string
          outcome?: string
          primary_tag?: string | null
          snapshot_seconds_to_close?: number | null
          spot_at_snapshot?: number | null
          strike?: number | null
          strike_distance_pct?: number | null
          ta_engine_version?: string | null
          ta_score?: number | null
          ticker?: string
        }
        Relationships: []
      }
      ops_alerts: {
        Row: {
          acknowledged_at: string | null
          action_taken: string | null
          code: string
          created_at: string
          current_value: number | null
          details: Json
          id: string
          level: string
          manual_review_required: boolean
          metric: string | null
          resolved_at: string | null
          resume_conditions: string | null
          threshold_value: number | null
          triggered_at: string
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          action_taken?: string | null
          code: string
          created_at?: string
          current_value?: number | null
          details?: Json
          id?: string
          level: string
          manual_review_required?: boolean
          metric?: string | null
          resolved_at?: string | null
          resume_conditions?: string | null
          threshold_value?: number | null
          triggered_at?: string
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          action_taken?: string | null
          code?: string
          created_at?: string
          current_value?: number | null
          details?: Json
          id?: string
          level?: string
          manual_review_required?: boolean
          metric?: string | null
          resolved_at?: string | null
          resume_conditions?: string | null
          threshold_value?: number | null
          triggered_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ops_backtest_runs: {
        Row: {
          created_at: string
          id: string
          max_drawdown_pct: number | null
          results: Json
          rolling100_wr: number | null
          rolling30_wr: number | null
          run_at: string
          status: string
          through_date: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          max_drawdown_pct?: number | null
          results?: Json
          rolling100_wr?: number | null
          rolling30_wr?: number | null
          run_at?: string
          status?: string
          through_date?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          max_drawdown_pct?: number | null
          results?: Json
          rolling100_wr?: number | null
          rolling30_wr?: number | null
          run_at?: string
          status?: string
          through_date?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ops_daily_snapshots: {
        Row: {
          all_time_high_bankroll: number
          bets_placed: number
          closing_bankroll: number | null
          consecutive_losses: number
          created_at: string
          daily_pnl: number
          id: string
          mode_reason: string | null
          morning_bankroll: number
          review_only: boolean
          session_date: string
          staking_mode: string
          stop_reason: string | null
          stopped: boolean
          unit_pct: number
          unit_usd: number
          updated_at: string
          user_id: string
        }
        Insert: {
          all_time_high_bankroll?: number
          bets_placed?: number
          closing_bankroll?: number | null
          consecutive_losses?: number
          created_at?: string
          daily_pnl?: number
          id?: string
          mode_reason?: string | null
          morning_bankroll: number
          review_only?: boolean
          session_date: string
          staking_mode?: string
          stop_reason?: string | null
          stopped?: boolean
          unit_pct?: number
          unit_usd?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          all_time_high_bankroll?: number
          bets_placed?: number
          closing_bankroll?: number | null
          consecutive_losses?: number
          created_at?: string
          daily_pnl?: number
          id?: string
          mode_reason?: string | null
          morning_bankroll?: number
          review_only?: boolean
          session_date?: string
          staking_mode?: string
          stop_reason?: string | null
          stopped?: boolean
          unit_pct?: number
          unit_usd?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      ops_mode_changes: {
        Row: {
          actor: string
          changed_at: string
          created_at: string
          from_mode: string | null
          id: string
          reason: string
          to_mode: string
          user_id: string
        }
        Insert: {
          actor?: string
          changed_at?: string
          created_at?: string
          from_mode?: string | null
          id?: string
          reason: string
          to_mode: string
          user_id: string
        }
        Update: {
          actor?: string
          changed_at?: string
          created_at?: string
          from_mode?: string | null
          id?: string
          reason?: string
          to_mode?: string
          user_id?: string
        }
        Relationships: []
      }
      ops_rule_violations: {
        Row: {
          created_at: string
          description: string | null
          id: string
          occurred_at: string
          rule_code: string
          session_date: string
          trade_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          occurred_at?: string
          rule_code: string
          session_date: string
          trade_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          occurred_at?: string
          rule_code?: string
          session_date?: string
          trade_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ops_rule_violations_trade_id_fkey"
            columns: ["trade_id"]
            isOneToOne: false
            referencedRelation: "ops_trades"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_threshold_changes: {
        Row: {
          actor: string
          changed_at: string
          created_at: string
          id: string
          new_value: string
          previous_value: string | null
          reason: string
          threshold_key: string
          user_id: string | null
        }
        Insert: {
          actor?: string
          changed_at?: string
          created_at?: string
          id?: string
          new_value: string
          previous_value?: string | null
          reason: string
          threshold_key: string
          user_id?: string | null
        }
        Update: {
          actor?: string
          changed_at?: string
          created_at?: string
          id?: string
          new_value?: string
          previous_value?: string | null
          reason?: string
          threshold_key?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ops_trades: {
        Row: {
          ask_cents: number | null
          bankroll_after: number | null
          contracts: number | null
          created_at: string
          crypto_trade_id: string | null
          cushion_usd: number | null
          decision_at: string
          decision_snapshot: Json
          discipline_score: number
          id: string
          kalshi_order_id: string | null
          model_conf: number | null
          model_side: string | null
          notes: string | null
          potential_profit: number | null
          realized_pnl: number | null
          result: string | null
          rule_status: string
          seconds_left: number | null
          session_date: string
          side: string | null
          source: string
          spot_at_lock: number | null
          stake: number
          strike: number | null
          study_conf: number | null
          study_side: string | null
          ticker: string
          updated_at: string
          user_id: string
          utc_hour: number | null
          violations: string[]
        }
        Insert: {
          ask_cents?: number | null
          bankroll_after?: number | null
          contracts?: number | null
          created_at?: string
          crypto_trade_id?: string | null
          cushion_usd?: number | null
          decision_at?: string
          decision_snapshot?: Json
          discipline_score?: number
          id?: string
          kalshi_order_id?: string | null
          model_conf?: number | null
          model_side?: string | null
          notes?: string | null
          potential_profit?: number | null
          realized_pnl?: number | null
          result?: string | null
          rule_status?: string
          seconds_left?: number | null
          session_date: string
          side?: string | null
          source?: string
          spot_at_lock?: number | null
          stake?: number
          strike?: number | null
          study_conf?: number | null
          study_side?: string | null
          ticker: string
          updated_at?: string
          user_id: string
          utc_hour?: number | null
          violations?: string[]
        }
        Update: {
          ask_cents?: number | null
          bankroll_after?: number | null
          contracts?: number | null
          created_at?: string
          crypto_trade_id?: string | null
          cushion_usd?: number | null
          decision_at?: string
          decision_snapshot?: Json
          discipline_score?: number
          id?: string
          kalshi_order_id?: string | null
          model_conf?: number | null
          model_side?: string | null
          notes?: string | null
          potential_profit?: number | null
          realized_pnl?: number | null
          result?: string | null
          rule_status?: string
          seconds_left?: number | null
          session_date?: string
          side?: string | null
          source?: string
          spot_at_lock?: number | null
          stake?: number
          strike?: number | null
          study_conf?: number | null
          study_side?: string | null
          ticker?: string
          updated_at?: string
          user_id?: string
          utc_hour?: number | null
          violations?: string[]
        }
        Relationships: []
      }
      ops_window_evaluations: {
        Row: {
          close_time: string | null
          created_at: string
          decision_snapshot: Json
          evaluated_at: string
          fail_reasons: string[]
          filters: Json
          id: string
          outcome: string | null
          qualified: boolean
          ticker: string
          user_id: string | null
        }
        Insert: {
          close_time?: string | null
          created_at?: string
          decision_snapshot?: Json
          evaluated_at?: string
          fail_reasons?: string[]
          filters?: Json
          id?: string
          outcome?: string | null
          qualified?: boolean
          ticker: string
          user_id?: string | null
        }
        Update: {
          close_time?: string | null
          created_at?: string
          decision_snapshot?: Json
          evaluated_at?: string
          fail_reasons?: string[]
          filters?: Json
          id?: string
          outcome?: string | null
          qualified?: boolean
          ticker?: string
          user_id?: string | null
        }
        Relationships: []
      }
      ops_withdrawals: {
        Row: {
          completed_at: string | null
          created_at: string
          id: string
          milestone_from: number
          milestone_to: number
          required_amount: number
          status: string
          updated_at: string
          user_id: string
          withdrawn_amount: number
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          id?: string
          milestone_from: number
          milestone_to: number
          required_amount: number
          status?: string
          updated_at?: string
          user_id: string
          withdrawn_amount?: number
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          id?: string
          milestone_from?: number
          milestone_to?: number
          required_amount?: number
          status?: string
          updated_at?: string
          user_id?: string
          withdrawn_amount?: number
        }
        Relationships: []
      }
      own_engine_orders: {
        Row: {
          close_time: string | null
          closed_at: string | null
          contracts: number
          created_at: string
          cushion_usd: number | null
          edge_cents: number | null
          exit_price_cents: number | null
          exit_reason: string | null
          id: string
          model_prob: number | null
          outcome: string | null
          paper: boolean
          phase: string
          pnl_cents: number | null
          price_cents: number
          seconds_left: number | null
          side: string
          spot: number | null
          status: string
          strike: number | null
          ticker: string
          user_id: string
          z_score: number | null
        }
        Insert: {
          close_time?: string | null
          closed_at?: string | null
          contracts: number
          created_at?: string
          cushion_usd?: number | null
          edge_cents?: number | null
          exit_price_cents?: number | null
          exit_reason?: string | null
          id?: string
          model_prob?: number | null
          outcome?: string | null
          paper?: boolean
          phase: string
          pnl_cents?: number | null
          price_cents: number
          seconds_left?: number | null
          side: string
          spot?: number | null
          status?: string
          strike?: number | null
          ticker: string
          user_id: string
          z_score?: number | null
        }
        Update: {
          close_time?: string | null
          closed_at?: string | null
          contracts?: number
          created_at?: string
          cushion_usd?: number | null
          edge_cents?: number | null
          exit_price_cents?: number | null
          exit_reason?: string | null
          id?: string
          model_prob?: number | null
          outcome?: string | null
          paper?: boolean
          phase?: string
          pnl_cents?: number | null
          price_cents?: number
          seconds_left?: number | null
          side?: string
          spot?: number | null
          status?: string
          strike?: number | null
          ticker?: string
          user_id?: string
          z_score?: number | null
        }
        Relationships: []
      }
      own_engine_settings: {
        Row: {
          armed: boolean
          bankroll_cents: number
          blend_study: boolean
          created_at: string
          dominance_block_cents: number
          exit_capture_pct: number
          late_block_seconds: number
          late_cushion_usd: number
          max_pair_cost_cents: number
          max_price_cents: number
          min_edge_cents: number
          min_price_cents: number
          min_study_conf: number
          paper: boolean
          per_side_window_cap_usd: number
          per_window_cap_usd: number
          require_signal_agreement: boolean
          risk_per_trade_pct: number
          stack_fraction: number
          stack_gain_cents: number
          stop_loss_fraction: number
          study_weight: number
          updated_at: string
          user_id: string
          verdict_veto: boolean
        }
        Insert: {
          armed?: boolean
          bankroll_cents?: number
          blend_study?: boolean
          created_at?: string
          dominance_block_cents?: number
          exit_capture_pct?: number
          late_block_seconds?: number
          late_cushion_usd?: number
          max_pair_cost_cents?: number
          max_price_cents?: number
          min_edge_cents?: number
          min_price_cents?: number
          min_study_conf?: number
          paper?: boolean
          per_side_window_cap_usd?: number
          per_window_cap_usd?: number
          require_signal_agreement?: boolean
          risk_per_trade_pct?: number
          stack_fraction?: number
          stack_gain_cents?: number
          stop_loss_fraction?: number
          study_weight?: number
          updated_at?: string
          user_id: string
          verdict_veto?: boolean
        }
        Update: {
          armed?: boolean
          bankroll_cents?: number
          blend_study?: boolean
          created_at?: string
          dominance_block_cents?: number
          exit_capture_pct?: number
          late_block_seconds?: number
          late_cushion_usd?: number
          max_pair_cost_cents?: number
          max_price_cents?: number
          min_edge_cents?: number
          min_price_cents?: number
          min_study_conf?: number
          paper?: boolean
          per_side_window_cap_usd?: number
          per_window_cap_usd?: number
          require_signal_agreement?: boolean
          risk_per_trade_pct?: number
          stack_fraction?: number
          stack_gain_cents?: number
          stop_loss_fraction?: number
          study_weight?: number
          updated_at?: string
          user_id?: string
          verdict_veto?: boolean
        }
        Relationships: []
      }
      own_engine_skips: {
        Row: {
          code: string
          created_at: string
          id: string
          reason: string | null
          snapshot: Json | null
          ticker: string | null
          user_id: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          reason?: string | null
          snapshot?: Json | null
          ticker?: string | null
          user_id: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          reason?: string | null
          snapshot?: Json | null
          ticker?: string | null
          user_id?: string
        }
        Relationships: []
      }
      paper_balances: {
        Row: {
          balance_cents: number
          bankrupt_at: string | null
          created_at: string
          starting_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance_cents?: number
          bankrupt_at?: string | null
          created_at?: string
          starting_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance_cents?: number
          bankrupt_at?: string | null
          created_at?: string
          starting_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_fills: {
        Row: {
          button: string
          close_time: string
          contracts: number
          created_at: string
          entry_snapshot: Json
          fill_price_cents: number
          id: string
          payout_cents: number | null
          pnl_cents: number | null
          settled_at: string | null
          side: string
          stake_cents: number
          status: string
          ticker: string
          updated_at: string
          user_id: string
        }
        Insert: {
          button: string
          close_time: string
          contracts: number
          created_at?: string
          entry_snapshot?: Json
          fill_price_cents: number
          id?: string
          payout_cents?: number | null
          pnl_cents?: number | null
          settled_at?: string | null
          side: string
          stake_cents?: number
          status?: string
          ticker: string
          updated_at?: string
          user_id: string
        }
        Update: {
          button?: string
          close_time?: string
          contracts?: number
          created_at?: string
          entry_snapshot?: Json
          fill_price_cents?: number
          id?: string
          payout_cents?: number | null
          pnl_cents?: number | null
          settled_at?: string | null
          side?: string
          stake_cents?: number
          status?: string
          ticker?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_kalshi_account: {
        Row: {
          auto_buy: boolean
          auto_buy_contracts: number
          auto_buy_max_ask_cents: number
          auto_buy_min_conf: number
          auto_buy_min_cushion_usd: number
          cash_cents: number
          created_at: string
          starting_cents: number
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_buy?: boolean
          auto_buy_contracts?: number
          auto_buy_max_ask_cents?: number
          auto_buy_min_conf?: number
          auto_buy_min_cushion_usd?: number
          cash_cents?: number
          created_at?: string
          starting_cents?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_buy?: boolean
          auto_buy_contracts?: number
          auto_buy_max_ask_cents?: number
          auto_buy_min_conf?: number
          auto_buy_min_cushion_usd?: number
          cash_cents?: number
          created_at?: string
          starting_cents?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      paper_kalshi_events: {
        Row: {
          auto: boolean
          cash_cents: number | null
          contracts: number | null
          created_at: string
          id: string
          kind: string
          note: string | null
          pnl_cents: number | null
          position_id: string | null
          price_cents: number | null
          seconds_left: number | null
          side: string | null
          spot: number | null
          strike: number | null
          ticker: string
          user_id: string
        }
        Insert: {
          auto?: boolean
          cash_cents?: number | null
          contracts?: number | null
          created_at?: string
          id?: string
          kind: string
          note?: string | null
          pnl_cents?: number | null
          position_id?: string | null
          price_cents?: number | null
          seconds_left?: number | null
          side?: string | null
          spot?: number | null
          strike?: number | null
          ticker: string
          user_id: string
        }
        Update: {
          auto?: boolean
          cash_cents?: number | null
          contracts?: number | null
          created_at?: string
          id?: string
          kind?: string
          note?: string | null
          pnl_cents?: number | null
          position_id?: string | null
          price_cents?: number | null
          seconds_left?: number | null
          side?: string | null
          spot?: number | null
          strike?: number | null
          ticker?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "paper_kalshi_events_position_id_fkey"
            columns: ["position_id"]
            isOneToOne: false
            referencedRelation: "paper_kalshi_positions"
            referencedColumns: ["id"]
          },
        ]
      }
      paper_kalshi_positions: {
        Row: {
          auto_hedge: boolean
          close_time: string
          created_at: string
          crossed_at: string | null
          crossed_strike: boolean
          entry_contracts: number
          entry_price_cents: number
          entry_reason: string | null
          entry_seconds_left: number | null
          entry_side: string
          entry_spot: number | null
          exit_contracts: number | null
          exit_price_cents: number | null
          exit_reason: string | null
          exited_at: string | null
          hedge_contracts: number | null
          hedge_price_cents: number | null
          hedge_side: string | null
          hedged_at: string | null
          id: string
          outcome: string | null
          pnl_cents: number | null
          settled_at: string | null
          status: string
          strike: number | null
          ticker: string
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_hedge?: boolean
          close_time: string
          created_at?: string
          crossed_at?: string | null
          crossed_strike?: boolean
          entry_contracts: number
          entry_price_cents: number
          entry_reason?: string | null
          entry_seconds_left?: number | null
          entry_side: string
          entry_spot?: number | null
          exit_contracts?: number | null
          exit_price_cents?: number | null
          exit_reason?: string | null
          exited_at?: string | null
          hedge_contracts?: number | null
          hedge_price_cents?: number | null
          hedge_side?: string | null
          hedged_at?: string | null
          id?: string
          outcome?: string | null
          pnl_cents?: number | null
          settled_at?: string | null
          status?: string
          strike?: number | null
          ticker: string
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_hedge?: boolean
          close_time?: string
          created_at?: string
          crossed_at?: string | null
          crossed_strike?: boolean
          entry_contracts?: number
          entry_price_cents?: number
          entry_reason?: string | null
          entry_seconds_left?: number | null
          entry_side?: string
          entry_spot?: number | null
          exit_contracts?: number | null
          exit_price_cents?: number | null
          exit_reason?: string | null
          exited_at?: string | null
          hedge_contracts?: number | null
          hedge_price_cents?: number | null
          hedge_side?: string | null
          hedged_at?: string | null
          id?: string
          outcome?: string | null
          pnl_cents?: number | null
          settled_at?: string | null
          status?: string
          strike?: number | null
          ticker?: string
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
      pred_locks: {
        Row: {
          ask: number | null
          created_at: string
          edge: number | null
          id: string
          locked_at: string
          meta: Json
          side: string
          side_conf: number | null
          spot: number | null
          strike: number | null
          ticker: string
          time_left_sec: number | null
          updated_at: string
          user_id: string
          v1_fired: boolean
          v2_action: string | null
          v2_reason: string | null
          v2_side: string | null
          window_start: string
        }
        Insert: {
          ask?: number | null
          created_at?: string
          edge?: number | null
          id?: string
          locked_at?: string
          meta?: Json
          side: string
          side_conf?: number | null
          spot?: number | null
          strike?: number | null
          ticker: string
          time_left_sec?: number | null
          updated_at?: string
          user_id: string
          v1_fired?: boolean
          v2_action?: string | null
          v2_reason?: string | null
          v2_side?: string | null
          window_start: string
        }
        Update: {
          ask?: number | null
          created_at?: string
          edge?: number | null
          id?: string
          locked_at?: string
          meta?: Json
          side?: string
          side_conf?: number | null
          spot?: number | null
          strike?: number | null
          ticker?: string
          time_left_sec?: number | null
          updated_at?: string
          user_id?: string
          v1_fired?: boolean
          v2_action?: string | null
          v2_reason?: string | null
          v2_side?: string | null
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
          ops_auto_trade_enabled: boolean
          preferred_sports: string[]
          risk_tolerance: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          study_auto_live_enabled: boolean
          study_auto_stake_cents: number
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
          ops_auto_trade_enabled?: boolean
          preferred_sports?: string[]
          risk_tolerance?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          study_auto_live_enabled?: boolean
          study_auto_stake_cents?: number
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
          ops_auto_trade_enabled?: boolean
          preferred_sports?: string[]
          risk_tolerance?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          study_auto_live_enabled?: boolean
          study_auto_stake_cents?: number
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
      btc_ta_reblend_shadow: {
        Row: {
          close_time: string | null
          model_prob: number | null
          outcome: string | null
          shadow_model_prob: number | null
          shadow_side_conf: number | null
          side: string | null
          snapshot_seconds_to_close: number | null
          ta_score: number | null
          ticker: string | null
          was_correct: boolean | null
        }
        Insert: {
          close_time?: string | null
          model_prob?: number | null
          outcome?: string | null
          shadow_model_prob?: never
          shadow_side_conf?: never
          side?: string | null
          snapshot_seconds_to_close?: number | null
          ta_score?: number | null
          ticker?: string | null
          was_correct?: boolean | null
        }
        Update: {
          close_time?: string | null
          model_prob?: number | null
          outcome?: string | null
          shadow_model_prob?: never
          shadow_side_conf?: never
          side?: string | null
          snapshot_seconds_to_close?: number | null
          ta_score?: number | null
          ticker?: string | null
          was_correct?: boolean | null
        }
        Relationships: []
      }
      v_market_intel_alerts: {
        Row: {
          alert_cadence_high: boolean | null
          alert_direction_skewed: boolean | null
          alert_error_rate_high: boolean | null
          alert_input_lag_high: boolean | null
          alert_insufficient_high: boolean | null
          alert_missing_5m_high: boolean | null
          alert_settlement_match_low: boolean | null
          as_of: string | null
          total_snapshots: number | null
        }
        Relationships: []
      }
      v_market_intel_collection_health: {
        Row: {
          as_of: string | null
          avg_calc_ms: number | null
          avg_input_lag_ms: number | null
          avg_snapshots_per_ticker: number | null
          confidence_distribution: Json | null
          direction_distribution: Json | null
          error_pct: number | null
          error_rows: number | null
          insufficient_pct: number | null
          insufficient_rows: number | null
          market_state_distribution: Json | null
          matched_pct: number | null
          matched_rows: number | null
          median_snapshots_per_ticker: number | null
          missing_15m_pct: number | null
          missing_15m_rows: number | null
          missing_1m_pct: number | null
          missing_1m_rows: number | null
          missing_5m_pct: number | null
          missing_5m_rows: number | null
          ok_rows: number | null
          p95_calc_ms: number | null
          p95_input_lag_ms: number | null
          partial_pct: number | null
          partial_rows: number | null
          pending_rows: number | null
          psych_level_role_distribution: Json | null
          rows_per_hour: number | null
          sequence_state_distribution: Json | null
          status_distribution: Json | null
          total_snapshots: number | null
          unique_settled_tickers: number | null
          unique_tickers: number | null
          volatility_regime_distribution: Json | null
        }
        Relationships: []
      }
      v_market_intel_eval: {
        Row: {
          calculation_duration_ms: number | null
          decision_ts: string | null
          entry_yes_price: number | null
          input_lag_ms: number | null
          intel_confidence: number | null
          intel_direction: string | null
          intel_status: string | null
          is_first_snapshot: boolean | null
          is_last_preclose_snapshot: boolean | null
          market_intel_id: string | null
          market_state: string | null
          market_window_id: string | null
          pred_model_prob: number | null
          pred_side: string | null
          pred_strike: number | null
          psych_distance_atr: number | null
          psych_level_interval: number | null
          psych_level_role: string | null
          psych_level_strength: number | null
          psych_state: string | null
          seconds_to_close: number | null
          sequence_state: string | null
          settle_outcome: string | null
          settle_price: number | null
          settled_at: string | null
          settlement_link_status: string | null
          snapshot_number_in_window: number | null
          strike_distance_in_expected_moves: number | null
          structure_direction: string | null
          structure_strength: number | null
          ticker: string | null
          time_bucket: string | null
          user_id: string | null
          volatility_regime: string | null
          was_correct: boolean | null
          window_close_ts: string | null
          window_open_ts: string | null
        }
        Relationships: []
      }
      v_market_intel_window_primary: {
        Row: {
          bucket_center_s: number | null
          calculation_duration_ms: number | null
          chop_score: number | null
          close_time: string | null
          compression_score: number | null
          confidence: number | null
          continuation_score: number | null
          created_at: string | null
          decision_ts: string | null
          direction: string | null
          exhaustion_score: number | null
          expansion_score: number | null
          expected_move_15m_pct: number | null
          expected_move_15m_usd: number | null
          id: string | null
          input_lag_ms: number | null
          market_intel_version: string | null
          market_state: string | null
          market_window_id: string | null
          mwid_effective: string | null
          nearest_psych_level: number | null
          outcome: string | null
          pnl_usd: number | null
          prediction_id: string | null
          psych_distance_atr: number | null
          psych_distance_usd: number | null
          psych_level_interval: number | null
          psych_level_role: string | null
          psych_level_strength: number | null
          psych_state: string | null
          reasons_jsonb: Json | null
          reversal_score: number | null
          rn: number | null
          round_confluence_score: number | null
          seconds_to_close: number | null
          sequence_state: string | null
          settle_price: number | null
          settlement_link_status: string | null
          signals_jsonb: Json | null
          spot_at_compute: number | null
          status: string | null
          strike: number | null
          strike_distance_in_expected_moves: number | null
          strike_distance_usd: number | null
          structure_direction: string | null
          structure_strength: number | null
          ticker: string | null
          time_bucket: string | null
          user_id: string | null
          volatility_regime: string | null
          warnings_jsonb: Json | null
          window_close_ts: string | null
          window_open_ts: string | null
          window_start: string | null
        }
        Relationships: [
          {
            foreignKeyName: "btc_market_intel_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "btc_model_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _cron_secret: { Args: never; Returns: string }
      delete_email: {
        Args: { message_id: number; queue_name: string }
        Returns: boolean
      }
      email_queue_dispatch: { Args: never; Returns: undefined }
      enqueue_email: {
        Args: { payload: Json; queue_name: string }
        Returns: number
      }
      is_ops_admin: { Args: { _user_id: string }; Returns: boolean }
      mid_support_study: {
        Args: { _days?: number }
        Returns: {
          avg_mid_dist_pct: number
          bucket: string
          edge_vs_baseline: number
          n: number
          pct_up: number
        }[]
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
      prune_btc_candles: { Args: never; Returns: undefined }
      read_email_batch: {
        Args: { batch_size: number; queue_name: string; vt: number }
        Returns: {
          message: Json
          msg_id: number
          read_ct: number
        }[]
      }
      run_loss_autopsy: { Args: never; Returns: number }
      trendline_break_study: {
        Args: { _days?: number }
        Returns: {
          avg_dist_pct: number
          bucket: string
          n: number
          pct_up: number
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
