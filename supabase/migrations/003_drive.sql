-- Add drive_file_id to documents so we can skip already-indexed Drive files
alter table documents add column if not exists drive_file_id text unique;

-- Store OAuth tokens + configured folder for the Drive integration (single row)
create table if not exists drive_tokens (
  id            int primary key default 1,
  access_token  text,
  refresh_token text not null,
  expiry_date   bigint,
  folder_id     text,
  folder_name   text,
  last_synced_at timestamptz
);
