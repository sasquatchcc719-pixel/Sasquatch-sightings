ALTER TABLE phone_settings
ADD COLUMN IF NOT EXISTS temporary_open_line_mode boolean NOT NULL DEFAULT false;
