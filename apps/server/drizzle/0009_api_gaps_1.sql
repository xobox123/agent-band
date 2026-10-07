ALTER TABLE "agents" ALTER COLUMN "avatar" SET DATA TYPE jsonb USING
  CASE WHEN "avatar" IS NULL THEN NULL
    WHEN "avatar" ~ '^https://' THEN jsonb_build_object('kind', 'url', 'value', "avatar")
    WHEN "avatar" ~ '^av-[0-9]+$' THEN jsonb_build_object('kind', 'color', 'value', "avatar")
    ELSE jsonb_build_object('kind', 'initials', 'value', "avatar") END;
