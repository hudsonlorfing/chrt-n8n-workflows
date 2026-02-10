-- =============================================================================
-- Meeting Intel System: Full Schema
-- =============================================================================
-- Drop existing tables and recreate from scratch.
-- Run this in the Supabase SQL Editor.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Drop existing objects (cascade to remove dependents)
-- ---------------------------------------------------------------------------
drop view  if exists meeting_context          cascade;
drop table if exists agent_conversations      cascade;
drop table if exists agent_memory             cascade;
drop table if exists analysis_combinations    cascade;
drop table if exists analysis_templates       cascade;
drop table if exists meeting_analyses         cascade;
drop table if exists meeting_participants     cascade;
drop table if exists meetings                 cascade;

-- ---------------------------------------------------------------------------
-- Helper: auto-update updated_at on row change
-- ---------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------
-- 1. meetings
-- ---------------------------------------------------------------------------
create table meetings (
  id                uuid primary key default gen_random_uuid(),
  fireflies_id      text unique not null,
  hash              text unique,
  title             text not null,
  person_name       text,
  meeting_date      timestamptz,
  date_str          text,
  duration_mins     int,
  fireflies_url     text,
  fireflies_summary text,
  attendees_raw     text,
  is_external       boolean default false,
  meeting_type      text default 'general',
  suggested_apps    jsonb,
  app_confidence    text default 'low'
    check (app_confidence in ('low', 'medium', 'high')),
  status            text not null default 'pending'
    check (status in ('pending','transcript_fetched','ready','processing','completed','failed')),
  error_type        text,
  error_message     text,
  slack_channel_id  text,
  slack_thread_ts   text,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_meetings_status        on meetings (status);
create index idx_meetings_meeting_date  on meetings (meeting_date desc);
create index idx_meetings_slack_thread   on meetings (slack_thread_ts) where slack_thread_ts is not null;

create trigger trg_meetings_updated_at
  before update on meetings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. meeting_participants
-- ---------------------------------------------------------------------------
create table meeting_participants (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references meetings(id) on delete cascade,
  name                text,
  email               text,
  is_internal         boolean default false,
  role_in_meeting     text,
  hubspot_contact_id  text,
  hubspot_properties  jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create index idx_participants_meeting  on meeting_participants (meeting_id);
create index idx_participants_email    on meeting_participants (email) where email is not null;
create index idx_participants_hubspot  on meeting_participants (hubspot_contact_id) where hubspot_contact_id is not null;

create trigger trg_participants_updated_at
  before update on meeting_participants
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. meeting_analyses
-- ---------------------------------------------------------------------------
create table meeting_analyses (
  id                uuid primary key default gen_random_uuid(),
  meeting_id        uuid not null references meetings(id) on delete cascade,
  template_id       text,
  analysis_output   text,
  structured_data   jsonb,
  scores            jsonb,
  model_used        text,
  token_count       int,
  hubspot_note_id   text,
  github_commit_url text,
  created_by        text default 'system',
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_analyses_meeting    on meeting_analyses (meeting_id);
create index idx_analyses_template   on meeting_analyses (template_id) where template_id is not null;
create index idx_analyses_created    on meeting_analyses (created_at desc);

create trigger trg_analyses_updated_at
  before update on meeting_analyses
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. analysis_templates  (replaces configs/ai-apps/*.json)
-- ---------------------------------------------------------------------------
create table analysis_templates (
  id                text primary key,
  name              text not null,
  category          text not null,
  icon              text,
  description       text,
  auto_detect       jsonb,
  scoring           jsonb,
  extraction_targets jsonb not null,
  output_schema     jsonb,
  system_prompt     text not null,
  extra             jsonb,
  is_active         boolean default true,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create index idx_templates_category on analysis_templates (category);

create trigger trg_templates_updated_at
  before update on analysis_templates
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. analysis_combinations  (replaces common_combinations from index.json)
-- ---------------------------------------------------------------------------
create table analysis_combinations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  apps        jsonb not null,        -- [{id, weight}]
  trigger     jsonb not null,        -- {external, title_keywords}
  is_active   boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create trigger trg_combinations_updated_at
  before update on analysis_combinations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. agent_memory  (entity facts with provenance)
-- ---------------------------------------------------------------------------
create table agent_memory (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null
    check (entity_type in ('person','company','deal','topic')),
  entity_id     text not null,
  entity_name   text,
  fact          text not null,
  confidence    text default 'medium'
    check (confidence in ('low','medium','high')),
  source_meeting_id uuid references meetings(id) on delete set null,
  source_analysis_id uuid references meeting_analyses(id) on delete set null,
  is_active     boolean default true,
  expires_at    timestamptz,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create index idx_memory_entity     on agent_memory (entity_type, entity_id);
create index idx_memory_active     on agent_memory (is_active) where is_active = true;
create index idx_memory_source     on agent_memory (source_meeting_id) where source_meeting_id is not null;

create trigger trg_memory_updated_at
  before update on agent_memory
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. agent_conversations  (n8n Postgres Chat Memory compatible)
--    session_id = slack_thread_ts so WF7 & WF8 share the same thread
-- ---------------------------------------------------------------------------
create table agent_conversations (
  id          serial primary key,
  session_id  text not null,
  role        text not null check (role in ('user','assistant','system')),
  content     text not null,
  created_at  timestamptz default now()
);

create index idx_conversations_session on agent_conversations (session_id, created_at);

-- ---------------------------------------------------------------------------
-- 8. Convenience view: meeting_context
-- ---------------------------------------------------------------------------
create or replace view meeting_context as
select
  m.id                as meeting_id,
  m.title,
  m.meeting_date,
  m.meeting_type,
  m.status,
  m.slack_thread_ts,
  m.fireflies_id,
  m.is_external,
  m.duration_mins,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
        'name', p.name,
        'email', p.email,
        'is_internal', p.is_internal,
        'hubspot_contact_id', p.hubspot_contact_id
    ))
    from meeting_participants p
    where p.meeting_id = m.id),
    '[]'::jsonb
  ) as participants,
  coalesce(
    (select jsonb_agg(jsonb_build_object(
        'template_id', a.template_id,
        'scores', a.scores,
        'created_at', a.created_at
    ) order by a.created_at desc)
    from meeting_analyses a
    where a.meeting_id = m.id),
    '[]'::jsonb
  ) as analyses
from meetings m;

-- ---------------------------------------------------------------------------
-- 9. Row Level Security
-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
alter table meetings              enable row level security;
alter table meeting_participants  enable row level security;
alter table meeting_analyses      enable row level security;
alter table analysis_templates    enable row level security;
alter table analysis_combinations enable row level security;
alter table agent_memory          enable row level security;
alter table agent_conversations   enable row level security;

-- Permissive policy for authenticated users (service_role bypasses automatically)
create policy "Authenticated full access on meetings"
  on meetings for all to authenticated using (true) with check (true);

create policy "Authenticated full access on meeting_participants"
  on meeting_participants for all to authenticated using (true) with check (true);

create policy "Authenticated full access on meeting_analyses"
  on meeting_analyses for all to authenticated using (true) with check (true);

create policy "Authenticated full access on analysis_templates"
  on analysis_templates for all to authenticated using (true) with check (true);

create policy "Authenticated full access on analysis_combinations"
  on analysis_combinations for all to authenticated using (true) with check (true);

create policy "Authenticated full access on agent_memory"
  on agent_memory for all to authenticated using (true) with check (true);

create policy "Authenticated full access on agent_conversations"
  on agent_conversations for all to authenticated using (true) with check (true);

-- Service role access (anon key cannot access — only service_role and authenticated)
create policy "Service role full access on meetings"
  on meetings for all to service_role using (true) with check (true);

create policy "Service role full access on meeting_participants"
  on meeting_participants for all to service_role using (true) with check (true);

create policy "Service role full access on meeting_analyses"
  on meeting_analyses for all to service_role using (true) with check (true);

create policy "Service role full access on analysis_templates"
  on analysis_templates for all to service_role using (true) with check (true);

create policy "Service role full access on analysis_combinations"
  on analysis_combinations for all to service_role using (true) with check (true);

create policy "Service role full access on agent_memory"
  on agent_memory for all to service_role using (true) with check (true);

create policy "Service role full access on agent_conversations"
  on agent_conversations for all to service_role using (true) with check (true);

-- =============================================================================
-- Done. Run seed scripts next:
--   supabase/seed/seed_analysis_templates.sql
--   supabase/seed/seed_analysis_combinations.sql
-- =============================================================================
