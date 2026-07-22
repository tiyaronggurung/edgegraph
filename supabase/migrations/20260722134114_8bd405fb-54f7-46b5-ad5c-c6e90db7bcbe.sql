UPDATE public.btc_model_predictions
SET outcome = 'NO', was_correct = (side = 'NO'), settle_price = 65574.92, settled_at = now()
WHERE ticker = 'KXBTC15M-26JUL220930-30';