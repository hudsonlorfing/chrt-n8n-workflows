-- =============================================================================
-- Seed: analysis_combinations
-- Generated from configs/ai-apps/index.json → common_combinations
-- =============================================================================

insert into analysis_combinations (name, apps, trigger) values

(
  'Sales Discovery',
  '[{"id":"discovery-scorecard","weight":0.5},{"id":"spiced-analyzer","weight":0.3},{"id":"competitor-tracker","weight":0.2}]'::jsonb,
  '{"external":true,"title_keywords":["discovery","intro","initial","first call"]}'::jsonb
),

(
  'Sales Demo',
  '[{"id":"demo-scorecard","weight":0.6},{"id":"objection-handler","weight":0.25},{"id":"competitor-tracker","weight":0.15}]'::jsonb,
  '{"external":true,"title_keywords":["demo","presentation","walkthrough","platform overview"]}'::jsonb
),

(
  'Customer Check-in',
  '[{"id":"churn-risk-analyzer","weight":0.4},{"id":"qbr-analyzer","weight":0.4},{"id":"general-notes","weight":0.2}]'::jsonb,
  '{"external":true,"title_keywords":["qbr","quarterly","check-in","review","catch up"]}'::jsonb
),

(
  'Customer Onboarding',
  '[{"id":"onboarding-review","weight":0.7},{"id":"general-notes","weight":0.3}]'::jsonb,
  '{"external":true,"title_keywords":["onboarding","kickoff","implementation","setup"]}'::jsonb
),

(
  'Customer Research',
  '[{"id":"customer-interview","weight":0.6},{"id":"user-research","weight":0.4}]'::jsonb,
  '{"external":true,"title_keywords":["research","interview","feedback","user interview"]}'::jsonb
),

(
  'Candidate Interview',
  '[{"id":"interview-scorecard","weight":1.0}]'::jsonb,
  '{"external":true,"title_keywords":["interview","screen","candidate","hiring"]}'::jsonb
),

(
  'Team Sync',
  '[{"id":"team-sync","weight":0.7},{"id":"sprint-retro","weight":0.3}]'::jsonb,
  '{"external":false,"title_keywords":["standup","sync","team meeting","weekly"]}'::jsonb
),

(
  'One-on-One',
  '[{"id":"one-on-one","weight":1.0}]'::jsonb,
  '{"external":false,"title_keywords":["1:1","1-1","one on one","check-in"]}'::jsonb
),

(
  'Executive Strategy',
  '[{"id":"executive-strategy","weight":0.6},{"id":"qbr-analyzer","weight":0.25},{"id":"general-notes","weight":0.15}]'::jsonb,
  '{"external":false,"title_keywords":["strategy","pricing","organizational","leadership","executive","ceo","cfo","board"]}'::jsonb
)

on conflict (name) do update set
  apps = excluded.apps,
  trigger = excluded.trigger,
  is_active = true;
