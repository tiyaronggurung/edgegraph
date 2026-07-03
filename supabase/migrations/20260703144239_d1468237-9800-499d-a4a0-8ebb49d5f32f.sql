ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS kalshi_api_key_id text,
  ADD COLUMN IF NOT EXISTS kalshi_private_key_pem text;