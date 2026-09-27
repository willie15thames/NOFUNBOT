-- Keep historical migration checksums unchanged. Preserve both source tables.
-- A DO statement is atomic; locks prevent writers racing the reconciliation.
DO $$
BEGIN
  IF to_regclass('public."BotKv"') IS NOT NULL THEN
    LOCK TABLE public."BotKv", public.bot_kv IN SHARE ROW EXCLUSIVE MODE;
    IF EXISTS (
      SELECT 1 FROM public."BotKv" legacy
      JOIN public.bot_kv canonical ON canonical.key = legacy.key
      WHERE canonical.value IS DISTINCT FROM legacy.value
    ) THEN
      RAISE EXCEPTION 'Legacy BotKv and bot_kv contain conflicting values. Back up both tables and reconcile the conflicting keys before retrying this migration; no records were overwritten.';
    END IF;
    INSERT INTO public.bot_kv (key,value,source,checksum,"updatedAt","createdAt")
    SELECT key,value,source,checksum,"updatedAt","createdAt" FROM public."BotKv"
    ON CONFLICT (key) DO NOTHING;
  END IF;
END $$;
