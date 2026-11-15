CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS users (
 id uuid PRIMARY KEY, username varchar(32) NOT NULL, email varchar(254) NOT NULL, password_hash text NOT NULL,
 role text NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')), disabled boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS users_username ON users(lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users(lower(email));
CREATE TABLE IF NOT EXISTS sessions(token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS teams(id uuid PRIMARY KEY, name varchar(48) NOT NULL UNIQUE, captain_id uuid NOT NULL REFERENCES users(id), invite_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS memberships(user_id uuid PRIMARY KEY REFERENCES users(id), team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE);
CREATE INDEX IF NOT EXISTS members_team ON memberships(team_id);
CREATE TABLE IF NOT EXISTS contests(id uuid PRIMARY KEY,title varchar(120) NOT NULL,description text NOT NULL DEFAULT '',starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,freeze_at timestamptz, published boolean NOT NULL DEFAULT false,team_limit integer NOT NULL DEFAULT 4 CHECK(team_limit BETWEEN 1 AND 20),created_at timestamptz NOT NULL DEFAULT now(),CHECK(ends_at > starts_at),CHECK(freeze_at IS NULL OR (freeze_at >= starts_at AND freeze_at < ends_at)));
CREATE TABLE IF NOT EXISTS registrations(contest_id uuid REFERENCES contests(id),team_id uuid REFERENCES teams(id),created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(contest_id,team_id));
CREATE TABLE IF NOT EXISTS challenges(id uuid PRIMARY KEY,title varchar(120) NOT NULL,description text NOT NULL DEFAULT '',category text NOT NULL,difficulty text NOT NULL,kind text NOT NULL CHECK(kind IN ('static_attachment','dynamic_attachment','static_container','dynamic_container')),flag_hash text NOT NULL DEFAULT '',initial_points integer NOT NULL DEFAULT 500 CHECK(initial_points BETWEEN 1 AND 10000),minimum_points integer NOT NULL DEFAULT 100,decay integer NOT NULL DEFAULT 20 CHECK(decay > 0),dynamic_score boolean NOT NULL DEFAULT true,published boolean NOT NULL DEFAULT false,practice boolean NOT NULL DEFAULT false,hints jsonb NOT NULL DEFAULT '[]',image text NOT NULL DEFAULT '',port integer NOT NULL DEFAULT 8080 CHECK(port BETWEEN 1024 AND 65535),cpu integer NOT NULL DEFAULT 500 CHECK(cpu BETWEEN 100 AND 4000),memory integer NOT NULL DEFAULT 256 CHECK(memory BETWEEN 32 AND 4096),ttl integer NOT NULL DEFAULT 1800 CHECK(ttl BETWEEN 60 AND 7200),created_at timestamptz NOT NULL DEFAULT now(),CHECK(minimum_points BETWEEN 1 AND initial_points));
CREATE INDEX IF NOT EXISTS challenges_listing ON challenges(published,practice,category,created_at DESC);
CREATE TABLE IF NOT EXISTS contest_challenges(contest_id uuid REFERENCES contests(id),challenge_id uuid REFERENCES challenges(id),PRIMARY KEY(contest_id,challenge_id));
CREATE TABLE IF NOT EXISTS submissions(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),challenge_id uuid NOT NULL REFERENCES challenges(id),scope text NOT NULL,owner_key text NOT NULL,correct boolean NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS submissions_user ON submissions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_scope ON submissions(scope,created_at DESC);
CREATE TABLE IF NOT EXISTS solves(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES challenges(id),scope text NOT NULL,owner_key text NOT NULL,user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(challenge_id,scope,owner_key));
CREATE INDEX IF NOT EXISTS solves_score ON solves(scope,challenge_id,created_at);
CREATE TABLE IF NOT EXISTS attachments(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES challenges(id),name varchar(180) NOT NULL,size bigint NOT NULL CHECK(size BETWEEN 0 AND 20971520),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS instances(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES challenges(id),scope text NOT NULL,owner_key text NOT NULL,requested_by uuid NOT NULL REFERENCES users(id),kind text NOT NULL,status text NOT NULL CHECK(status IN ('queued','starting','running','ready','stopping','stopped','failed')),spec jsonb NOT NULL,container_id text,endpoint text,artifact_size bigint,error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,max_expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS instances_queue ON instances(status,expires_at);
CREATE TABLE IF NOT EXISTS announcements(id uuid PRIMARY KEY,contest_id uuid REFERENCES contests(id),title varchar(120) NOT NULL,body text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_logs(id uuid PRIMARY KEY,actor_id uuid REFERENCES users(id),action text NOT NULL,target text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS audit_time ON audit_logs(created_at DESC);
CREATE TABLE IF NOT EXISTS rate_limits(key text PRIMARY KEY,hits integer NOT NULL,expires_at timestamptz NOT NULL);
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS articles(id uuid PRIMARY KEY,slug varchar(80) NOT NULL UNIQUE,title varchar(160) NOT NULL,category varchar(40) NOT NULL,kind text NOT NULL CHECK(kind IN ('document','tutorial')),body text NOT NULL DEFAULT '',published boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS articles_listing ON articles(published,kind,category);
CREATE TABLE IF NOT EXISTS article_progress(user_id uuid REFERENCES users(id),article_id uuid REFERENCES articles(id),completed_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,article_id));
CREATE TABLE IF NOT EXISTS learning_trees(id uuid PRIMARY KEY,title varchar(120) NOT NULL,description text NOT NULL DEFAULT '',published boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS learning_nodes(id uuid PRIMARY KEY,tree_id uuid NOT NULL REFERENCES learning_trees(id) ON DELETE CASCADE,title varchar(120) NOT NULL,article_id uuid REFERENCES articles(id),challenge_id uuid REFERENCES challenges(id),prerequisites jsonb NOT NULL DEFAULT '[]',position integer NOT NULL DEFAULT 0,CHECK(article_id IS NOT NULL OR challenge_id IS NOT NULL));
CREATE INDEX IF NOT EXISTS learning_nodes_tree ON learning_nodes(tree_id,position);
INSERT INTO schema_migrations(version) VALUES(2) ON CONFLICT DO NOTHING;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS access_mode text NOT NULL DEFAULT 'port' CHECK(access_mode IN ('port','domain'));
ALTER TABLE instances ADD COLUMN IF NOT EXISTS upstream_host text;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS upstream_port integer;
INSERT INTO schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id,expires_at DESC);
CREATE INDEX IF NOT EXISTS rate_limits_expiry ON rate_limits(expires_at);
CREATE INDEX IF NOT EXISTS registrations_team ON registrations(team_id);
CREATE INDEX IF NOT EXISTS contest_challenges_challenge ON contest_challenges(challenge_id);
CREATE INDEX IF NOT EXISTS attachments_challenge ON attachments(challenge_id);
CREATE INDEX IF NOT EXISTS solves_user_scope ON solves(user_id,scope,challenge_id);
CREATE INDEX IF NOT EXISTS instances_owner ON instances(scope,owner_key,created_at DESC);
CREATE INDEX IF NOT EXISTS instances_created ON instances(created_at DESC);
CREATE INDEX IF NOT EXISTS submissions_created ON submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS contests_listing ON contests(published,starts_at DESC);
CREATE INDEX IF NOT EXISTS announcements_contest ON announcements(contest_id,created_at DESC);
INSERT INTO schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS challenge_parts (
 id uuid PRIMARY KEY, challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
 title varchar(80) NOT NULL, description text NOT NULL DEFAULT '', position integer NOT NULL CHECK(position BETWEEN 0 AND 19),
 flag_hash text NOT NULL DEFAULT '', initial_points integer NOT NULL CHECK(initial_points BETWEEN 1 AND 10000),
 minimum_points integer NOT NULL CHECK(minimum_points BETWEEN 1 AND initial_points), UNIQUE(id,challenge_id));
CREATE INDEX IF NOT EXISTS challenge_parts_order ON challenge_parts(challenge_id,position);
CREATE TABLE IF NOT EXISTS part_solves (
 id uuid PRIMARY KEY, part_id uuid NOT NULL, challenge_id uuid NOT NULL,
 scope text NOT NULL, owner_key text NOT NULL, user_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(part_id,challenge_id) REFERENCES challenge_parts(id,challenge_id), UNIQUE(part_id,scope,owner_key));
CREATE INDEX IF NOT EXISTS part_solves_score ON part_solves(scope,part_id,created_at);
CREATE INDEX IF NOT EXISTS part_solves_challenge ON part_solves(challenge_id,scope,owner_key);
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS part_id uuid REFERENCES challenge_parts(id) ON DELETE SET NULL;
INSERT INTO schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS problemsets(id uuid PRIMARY KEY,title varchar(120) NOT NULL,description text NOT NULL DEFAULT '',published boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS problemsets_listing ON problemsets(published,created_at DESC);
CREATE TABLE IF NOT EXISTS problemset_items(problemset_id uuid REFERENCES problemsets(id) ON DELETE CASCADE,challenge_id uuid REFERENCES challenges(id),position integer NOT NULL,PRIMARY KEY(problemset_id,challenge_id));
CREATE INDEX IF NOT EXISTS problemset_items_order ON problemset_items(problemset_id,position);
ALTER TABLE contests ADD COLUMN IF NOT EXISTS poster_id uuid;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS poster_mime text;
INSERT INTO schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS contest_groups(id uuid PRIMARY KEY,contest_id uuid NOT NULL REFERENCES contests(id),name varchar(60) NOT NULL,description text NOT NULL DEFAULT '',position integer NOT NULL,UNIQUE(id,contest_id));
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES contest_groups(id);
CREATE INDEX IF NOT EXISTS registrations_group ON registrations(contest_id,group_id);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_pair ON memberships(user_id,team_id);
ALTER TABLE memberships DROP CONSTRAINT IF EXISTS memberships_pkey;
INSERT INTO schema_migrations(version) VALUES(7) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS contest_releases(id uuid PRIMARY KEY,contest_id uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,challenge_id uuid NOT NULL REFERENCES challenges(id),created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS contest_releases_feed ON contest_releases(contest_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS solves_feed ON solves(scope,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS part_solves_feed ON part_solves(scope,created_at DESC,id DESC);
INSERT INTO schema_migrations(version) VALUES(8) ON CONFLICT DO NOTHING;

ALTER TABLE challenges ADD COLUMN IF NOT EXISTS publish_at timestamptz;
CREATE INDEX IF NOT EXISTS challenges_scheduled ON challenges(publish_at,id) WHERE NOT published AND publish_at IS NOT NULL;
ALTER TABLE learning_nodes ADD COLUMN IF NOT EXISTS position_x real;
ALTER TABLE learning_nodes ADD COLUMN IF NOT EXISTS position_y real;
INSERT INTO schema_migrations(version) VALUES(9) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS docker_images(image text PRIMARY KEY,present boolean NOT NULL DEFAULT false,image_id text,size bigint,checked_at timestamptz,challenges jsonb NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS docker_worker_status(id integer PRIMARY KEY CHECK(id=1),checked_at timestamptz,error text);
CREATE TABLE IF NOT EXISTS docker_image_pulls(id uuid PRIMARY KEY,image text NOT NULL REFERENCES docker_images(image),reference text NOT NULL,requested_by uuid NOT NULL REFERENCES users(id),status text NOT NULL CHECK(status IN ('queued','pulling','succeeded','failed')),layers jsonb NOT NULL DEFAULT '[]',logs jsonb NOT NULL DEFAULT '[]',error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS docker_image_pull_active ON docker_image_pulls(image) WHERE status IN ('queued','pulling');
CREATE INDEX IF NOT EXISTS docker_image_pull_latest ON docker_image_pulls(image,created_at DESC);
INSERT INTO schema_migrations(version) VALUES(10) ON CONFLICT DO NOTHING;

ALTER TABLE challenge_parts ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'flag' CHECK(role IN ('flag','attack','defense'));
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS challenge_type text NOT NULL DEFAULT 'ctf' CHECK(challenge_type IN ('ctf','objective','awdp','awd'));
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS flag_mode text CHECK(flag_mode IN ('static','dynamic'));
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS resources jsonb;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS objective jsonb;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS patch_config jsonb;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS awd_config jsonb;
ALTER TABLE contest_challenges ADD COLUMN IF NOT EXISTS published boolean NOT NULL DEFAULT true;
ALTER TABLE contest_challenges ADD COLUMN IF NOT EXISTS release_at timestamptz;
ALTER TABLE contest_challenges ADD COLUMN IF NOT EXISTS scoring jsonb NOT NULL DEFAULT '{"mode":"inherit"}';
ALTER TABLE contest_challenges ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;
ALTER TABLE contest_challenges ADD COLUMN IF NOT EXISTS release_announced_at timestamptz;
CREATE INDEX IF NOT EXISTS contest_challenges_release ON contest_challenges(contest_id,published,release_at);
ALTER TABLE contests ADD COLUMN IF NOT EXISTS timing jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS contest_attempts(contest_id uuid NOT NULL,team_id uuid NOT NULL,section text NOT NULL CHECK(section IN ('objective','practical')),started_at timestamptz NOT NULL,deadline_at timestamptz NOT NULL,started_by uuid NOT NULL REFERENCES users(id),PRIMARY KEY(contest_id,team_id,section),FOREIGN KEY(contest_id,team_id) REFERENCES registrations(contest_id,team_id),CHECK(deadline_at>started_at));
CREATE TABLE IF NOT EXISTS objective_answers(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES challenges(id),scope text NOT NULL,owner_key text NOT NULL,user_id uuid NOT NULL REFERENCES users(id),answer jsonb NOT NULL,correct boolean,finalized_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(challenge_id,scope,owner_key));
CREATE INDEX IF NOT EXISTS objective_answers_scope ON objective_answers(scope,owner_key,finalized_at);
ALTER TABLE instances ADD COLUMN IF NOT EXISTS resource_type text;
UPDATE instances SET resource_type=CASE WHEN kind='dynamic_attachment' THEN 'attachment' ELSE 'container' END WHERE resource_type IS NULL;
ALTER TABLE instances ALTER COLUMN resource_type SET DEFAULT 'container';
ALTER TABLE instances ALTER COLUMN resource_type SET NOT NULL;
DROP INDEX IF EXISTS instances_active;
CREATE UNIQUE INDEX IF NOT EXISTS instances_active_resource ON instances(challenge_id,scope,owner_key,resource_type) WHERE status IN ('queued','starting','running','ready','stopping');
CREATE TABLE IF NOT EXISTS judge_jobs(id uuid PRIMARY KEY,challenge_id uuid NOT NULL REFERENCES challenges(id),scope text NOT NULL,owner_key text NOT NULL,requested_by uuid NOT NULL REFERENCES users(id),status text NOT NULL CHECK(status IN ('queued','building','checking','passed','failed','cancelled')),patch_id uuid NOT NULL,patch_name text NOT NULL,spec jsonb NOT NULL,result jsonb NOT NULL DEFAULT '{}',logs text NOT NULL DEFAULT '',error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz,deadline_at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS judge_jobs_active ON judge_jobs(challenge_id,scope,owner_key) WHERE status IN ('queued','building','checking');
CREATE INDEX IF NOT EXISTS judge_jobs_queue ON judge_jobs(status,created_at);
CREATE TABLE IF NOT EXISTS contest_rounds(id uuid PRIMARY KEY,contest_id uuid NOT NULL REFERENCES contests(id),challenge_id uuid NOT NULL REFERENCES challenges(id),number integer NOT NULL CHECK(number>=1),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','settled')),settings jsonb NOT NULL,settled_at timestamptz,UNIQUE(contest_id,challenge_id,number),CHECK(ends_at>starts_at));
CREATE INDEX IF NOT EXISTS contest_rounds_due ON contest_rounds(status,ends_at);
CREATE TABLE IF NOT EXISTS round_results(id uuid PRIMARY KEY,round_id uuid NOT NULL REFERENCES contest_rounds(id),owner_key text NOT NULL,unit_id uuid NOT NULL,points integer NOT NULL,details jsonb NOT NULL,user_id uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(round_id,owner_key,unit_id));
CREATE INDEX IF NOT EXISTS round_results_owner ON round_results(owner_key,created_at);
CREATE TABLE IF NOT EXISTS awd_flags(flag_hash text PRIMARY KEY,round_id uuid NOT NULL REFERENCES contest_rounds(id),instance_id uuid NOT NULL REFERENCES instances(id),owner_key text NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS awd_flags_round ON awd_flags(round_id,owner_key);
CREATE TABLE IF NOT EXISTS awd_attacks(id uuid PRIMARY KEY,flag_hash text NOT NULL REFERENCES awd_flags(flag_hash),attacker_key text NOT NULL,user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(flag_hash,attacker_key));
CREATE TABLE IF NOT EXISTS awd_checks(id uuid PRIMARY KEY,round_id uuid NOT NULL REFERENCES contest_rounds(id),instance_id uuid NOT NULL REFERENCES instances(id),owner_key text NOT NULL,status text NOT NULL CHECK(status IN ('queued','checking','up','down','error')),error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(round_id,owner_key));
UPDATE contest_challenges cc SET release_at=c.publish_at FROM challenges c WHERE cc.challenge_id=c.id AND c.publish_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=11);
UPDATE challenges SET published=CASE WHEN NOT practice AND EXISTS(SELECT 1 FROM contest_challenges cc WHERE cc.challenge_id=challenges.id) THEN true ELSE published END,publish_at=NULL WHERE publish_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=11);
INSERT INTO schema_migrations(version) VALUES(11) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS round_submissions(id uuid PRIMARY KEY,round_id uuid NOT NULL REFERENCES contest_rounds(id),unit_id uuid NOT NULL,owner_key text NOT NULL,user_id uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(round_id,unit_id,owner_key));
CREATE INDEX IF NOT EXISTS round_submissions_round ON round_submissions(round_id,unit_id);
ALTER TABLE judge_jobs ADD COLUMN IF NOT EXISTS cleanup_pending boolean NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS contest_notices(id uuid PRIMARY KEY,contest_id uuid NOT NULL REFERENCES contests(id),challenge_id uuid NOT NULL REFERENCES challenges(id),type text NOT NULL CHECK(type IN ('withdraw','hint')),challenge_title text NOT NULL,hint_count integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS contest_notices_feed ON contest_notices(contest_id,created_at DESC,id);
CREATE INDEX IF NOT EXISTS contest_notices_hints ON contest_notices(contest_id,challenge_id,created_at DESC) WHERE type='hint';

ALTER TABLE challenges ADD COLUMN IF NOT EXISTS flag_env text NOT NULL DEFAULT 'FLAG';
ALTER TABLE challenge_parts ADD COLUMN IF NOT EXISTS flag_env text;
UPDATE challenge_parts p SET flag_env='FLAG_'||ranked.n FROM (SELECT id,row_number() OVER(PARTITION BY challenge_id ORDER BY position,id) n FROM challenge_parts WHERE role<>'defense') ranked WHERE p.id=ranked.id AND p.flag_env IS NULL AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=12);
INSERT INTO schema_migrations(version) VALUES(12) ON CONFLICT DO NOTHING;

ALTER TABLE contest_groups ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}';
ALTER TABLE contest_groups ADD COLUMN IF NOT EXISTS challenge_permissions jsonb NOT NULL DEFAULT '{}';
INSERT INTO schema_migrations(version) VALUES(13) ON CONFLICT DO NOTHING;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS require_review boolean NOT NULL DEFAULT false;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'accepted' CHECK(status IN ('pending','accepted','rejected','suspended'));
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS review_note varchar(500) NOT NULL DEFAULT '';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES users(id);
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
UPDATE registrations SET accepted_at=created_at WHERE status='accepted' AND accepted_at IS NULL AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=14);
CREATE INDEX IF NOT EXISTS registrations_review ON registrations(contest_id,status,created_at DESC,team_id);
CREATE OR REPLACE VIEW accepted_registrations AS SELECT * FROM registrations WHERE status='accepted';
INSERT INTO schema_migrations(version) VALUES(14) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS issued_flags(contest_id uuid NOT NULL REFERENCES contests(id),challenge_id uuid NOT NULL REFERENCES challenges(id),part_key text NOT NULL,owner_key text NOT NULL,flag_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(contest_id,challenge_id,part_key,owner_key));
CREATE INDEX IF NOT EXISTS issued_flags_lookup ON issued_flags(contest_id,challenge_id,flag_hash);
CREATE TABLE IF NOT EXISTS integrity_events(id uuid PRIMARY KEY,contest_id uuid NOT NULL REFERENCES contests(id),submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id),source_team_id uuid NOT NULL REFERENCES teams(id),part_key text NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','confirmed','dismissed')),note varchar(1000) NOT NULL DEFAULT '',reviewed_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS integrity_events_feed ON integrity_events(contest_id,status,created_at DESC,id);
CREATE TABLE IF NOT EXISTS integrity_reviews(id uuid PRIMARY KEY,event_id uuid NOT NULL REFERENCES integrity_events(id),actor_id uuid NOT NULL REFERENCES users(id),status text NOT NULL CHECK(status IN ('open','confirmed','dismissed')),note varchar(1000) NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS integrity_reviews_event ON integrity_reviews(event_id,created_at DESC,id);
INSERT INTO schema_migrations(version) VALUES(15) ON CONFLICT DO NOTHING;

CREATE INDEX IF NOT EXISTS submissions_monitor ON submissions(scope,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS judge_jobs_monitor ON judge_jobs(scope,updated_at DESC);
CREATE INDEX IF NOT EXISTS integrity_events_updated ON integrity_events(contest_id,updated_at DESC);

ALTER TABLE contests ADD COLUMN IF NOT EXISTS writeup jsonb NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS contest_members(contest_id uuid NOT NULL,team_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),PRIMARY KEY(contest_id,team_id,user_id),UNIQUE(contest_id,user_id),FOREIGN KEY(contest_id,team_id) REFERENCES registrations(contest_id,team_id) ON DELETE CASCADE);
INSERT INTO contest_members(contest_id,team_id,user_id) SELECT r.contest_id,r.team_id,m.user_id FROM registrations r JOIN memberships m ON m.team_id=r.team_id WHERE r.status IN ('accepted','suspended') AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=16) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS contest_writeups(contest_id uuid NOT NULL REFERENCES contests(id),team_id uuid NOT NULL REFERENCES teams(id),file_id uuid NOT NULL UNIQUE,name varchar(180) NOT NULL,size integer NOT NULL CHECK(size>0 AND size<=20971520),format text NOT NULL CHECK(format IN ('pdf','zip')),version integer NOT NULL DEFAULT 1,submitted_by uuid NOT NULL REFERENCES users(id),submitted_at timestamptz NOT NULL DEFAULT now(),status text NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','accepted','changes_requested')),review_note varchar(1000) NOT NULL DEFAULT '',reviewed_by uuid REFERENCES users(id),reviewed_at timestamptz,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(contest_id,team_id));
CREATE INDEX IF NOT EXISTS contest_writeups_feed ON contest_writeups(contest_id,updated_at DESC,team_id);
CREATE TABLE IF NOT EXISTS writeup_history(id uuid PRIMARY KEY,contest_id uuid NOT NULL REFERENCES contests(id),team_id uuid NOT NULL REFERENCES teams(id),version integer NOT NULL,actor_id uuid NOT NULL REFERENCES users(id),action text NOT NULL CHECK(action IN ('submitted','accepted','changes_requested')),name varchar(180) NOT NULL,note varchar(1000) NOT NULL DEFAULT '',created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS writeup_history_team ON writeup_history(contest_id,team_id,created_at DESC,id);
INSERT INTO schema_migrations(version) VALUES(16) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS captcha_uses(id uuid PRIMARY KEY,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS captcha_uses_expiry ON captcha_uses(expires_at);
INSERT INTO schema_migrations(version) VALUES(17) ON CONFLICT DO NOTHING;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS practice_mode boolean NOT NULL DEFAULT false;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS spectator_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS spectator_scoreboard boolean NOT NULL DEFAULT true;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_mode text NOT NULL DEFAULT 'public' CHECK(registration_mode IN ('public','invite','teams'));
ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_code_hash text NOT NULL DEFAULT '';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_team_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS practice_only boolean NOT NULL DEFAULT false;
CREATE OR REPLACE VIEW accepted_registrations AS SELECT * FROM registrations WHERE status='accepted';
CREATE OR REPLACE VIEW ranked_registrations AS SELECT * FROM registrations WHERE status='accepted' AND NOT practice_only;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS contest_practice boolean NOT NULL DEFAULT false;
ALTER TABLE solves ADD COLUMN IF NOT EXISTS contest_practice boolean NOT NULL DEFAULT false;
ALTER TABLE part_solves ADD COLUMN IF NOT EXISTS contest_practice boolean NOT NULL DEFAULT false;
ALTER TABLE objective_answers ADD COLUMN IF NOT EXISTS contest_practice boolean NOT NULL DEFAULT false;
ALTER TABLE objective_answers DROP CONSTRAINT IF EXISTS objective_answers_challenge_id_scope_owner_key_key;
CREATE UNIQUE INDEX IF NOT EXISTS objective_answers_context ON objective_answers(challenge_id,scope,owner_key,contest_practice);
INSERT INTO schema_migrations(version) VALUES(18) ON CONFLICT DO NOTHING;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private'));
ALTER TABLE contests ADD COLUMN IF NOT EXISTS resource_limits jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(resource_limits)='object');
CREATE INDEX IF NOT EXISTS instances_contest_resource_quota ON instances(scope,resource_type,owner_key) WHERE status IN ('queued','starting','running','ready','stopping');
INSERT INTO schema_migrations(version) VALUES(19) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS system_settings(key text PRIMARY KEY,value jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;
ALTER TABLE instances ADD COLUMN IF NOT EXISTS renew_count integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS email_verifications(id uuid PRIMARY KEY,email text NOT NULL,code_hash text NOT NULL,attempts integer NOT NULL DEFAULT 0,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS email_verifications_expiry ON email_verifications(expires_at);
CREATE TABLE IF NOT EXISTS ai_routes(id uuid PRIMARY KEY,name varchar(80) NOT NULL,enabled boolean NOT NULL DEFAULT false,protocol text NOT NULL CHECK(protocol IN ('openai','anthropic')),base_url text NOT NULL,key_cipher text NOT NULL,access_hash text NOT NULL UNIQUE,access_prefix text NOT NULL,models jsonb NOT NULL,rpm integer NOT NULL,daily_limit integer NOT NULL,concurrency integer NOT NULL,max_tokens integer NOT NULL,timeout_seconds integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS ai_calls(id uuid PRIMARY KEY,route_id uuid NOT NULL REFERENCES ai_routes(id) ON DELETE CASCADE,model text NOT NULL,protocol text NOT NULL,status integer NOT NULL DEFAULT 0,input_tokens integer NOT NULL DEFAULT 0,output_tokens integer NOT NULL DEFAULT 0,elapsed_ms integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS ai_calls_route_time ON ai_calls(route_id,created_at DESC);
CREATE INDEX IF NOT EXISTS ai_calls_pending ON ai_calls(route_id,expires_at) WHERE status=0;
CREATE INDEX IF NOT EXISTS ai_calls_retention ON ai_calls(created_at);
CREATE INDEX IF NOT EXISTS ai_calls_expired ON ai_calls(expires_at) WHERE status=0;
INSERT INTO schema_migrations(version) VALUES(20) ON CONFLICT DO NOTHING;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS round_duration integer NOT NULL DEFAULT 300 CHECK(round_duration BETWEEN 60 AND 3600);
ALTER TABLE contests ADD COLUMN IF NOT EXISTS round_clock_from timestamptz;
CREATE TABLE IF NOT EXISTS contest_ticks(id uuid PRIMARY KEY,contest_id uuid NOT NULL REFERENCES contests(id),number integer NOT NULL CHECK(number>0),starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),UNIQUE(contest_id,number));
ALTER TABLE contest_rounds ADD COLUMN IF NOT EXISTS tick_id uuid REFERENCES contest_ticks(id);
ALTER TABLE contest_rounds DROP CONSTRAINT IF EXISTS contest_rounds_contest_id_challenge_id_number_key;
CREATE UNIQUE INDEX IF NOT EXISTS contest_rounds_tick_challenge ON contest_rounds(tick_id,challenge_id);
CREATE UNIQUE INDEX IF NOT EXISTS contest_rounds_legacy_number ON contest_rounds(contest_id,challenge_id,number) WHERE tick_id IS NULL;
CREATE INDEX IF NOT EXISTS contest_rounds_pending ON contest_rounds(contest_id,challenge_id,ends_at) WHERE status='open';
UPDATE contests c SET round_duration=r.duration FROM (SELECT contest_id,min((scoring->'round'->>'interval')::integer) duration FROM contest_challenges WHERE scoring->>'mode'='round' GROUP BY contest_id HAVING count(DISTINCT scoring->'round'->>'interval')=1) r WHERE c.id=r.contest_id AND r.duration BETWEEN 60 AND 3600 AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=21);
WITH old AS (
 SELECT c.id,c.round_duration,CASE WHEN coalesce(c.timing->'practical'->>'mode','inherit')='inherit' THEN c.starts_at ELSE (c.timing->'practical'->>'opens_at')::timestamptz END starts_at,
 CASE WHEN coalesce(c.timing->'practical'->>'mode','inherit')='inherit' THEN c.ends_at ELSE (c.timing->'practical'->>'closes_at')::timestamptz END ends_at,
 greatest(now(),max(r.ends_at+make_interval(secs=>coalesce((r.settings->'round'->>'interval')::integer,300)*greatest(0,coalesce((r.settings->'round'->>'flag_lifetime')::integer,1)-1)))) resume_at
 FROM contests c JOIN contest_rounds r ON r.contest_id=c.id AND r.tick_id IS NULL GROUP BY c.id
) UPDATE contests c SET round_clock_from=least(old.ends_at,old.starts_at+make_interval(secs=>ceil(extract(epoch FROM(old.resume_at-old.starts_at))/old.round_duration)*old.round_duration)) FROM old WHERE c.id=old.id AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=21);
CREATE INDEX IF NOT EXISTS awd_attacks_recent ON awd_attacks(created_at DESC);
INSERT INTO schema_migrations(version) VALUES(21) ON CONFLICT DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS real_name varchar(80) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_number varchar(48) NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(32) NOT NULL DEFAULT '';
INSERT INTO schema_migrations(version) VALUES(22) ON CONFLICT DO NOTHING;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS hint_policy jsonb NOT NULL DEFAULT '{"mode":"free"}';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS hint_overrides jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS hint_unlocks(id uuid PRIMARY KEY,contest_id uuid NOT NULL REFERENCES contests(id),challenge_id uuid NOT NULL REFERENCES challenges(id),hint_id uuid NOT NULL,owner_key text NOT NULL,user_id uuid NOT NULL REFERENCES users(id),policy jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(contest_id,challenge_id,hint_id,owner_key));
CREATE INDEX IF NOT EXISTS hint_unlocks_score ON hint_unlocks(contest_id,owner_key,created_at);
INSERT INTO schema_migrations(version) VALUES(23) ON CONFLICT DO NOTHING;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS submission_limits jsonb NOT NULL DEFAULT '{"flag":null,"defense":null}';
ALTER TABLE contests ADD COLUMN IF NOT EXISTS submission_overrides jsonb NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS submissions_attempt_count ON submissions(scope,challenge_id,owner_key) WHERE NOT contest_practice;
CREATE INDEX IF NOT EXISTS judge_jobs_team_revision ON judge_jobs(scope,owner_key,updated_at DESC);
INSERT INTO submissions(id,user_id,challenge_id,scope,owner_key,correct,created_at) SELECT a.id,a.user_id,r.challenge_id,r.contest_id::text,a.attacker_key,true,a.created_at FROM awd_attacks a JOIN awd_flags f ON f.flag_hash=a.flag_hash JOIN contest_rounds r ON r.id=f.round_id WHERE NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=24) ON CONFLICT(id) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES(24) ON CONFLICT DO NOTHING;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_opens_at timestamptz;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_closes_at timestamptz;
INSERT INTO schema_migrations(version) VALUES(25) ON CONFLICT DO NOTHING;

ALTER TABLE challenges ADD COLUMN IF NOT EXISTS flag_template text NOT NULL DEFAULT '';
ALTER TABLE challenge_parts ADD COLUMN IF NOT EXISTS flag_template text;
INSERT INTO schema_migrations(version) VALUES(26) ON CONFLICT DO NOTHING;

ALTER TABLE instances ALTER COLUMN challenge_id DROP NOT NULL;
ALTER TABLE instances DROP CONSTRAINT IF EXISTS instances_terminal_owner;
ALTER TABLE instances ADD CONSTRAINT instances_terminal_owner CHECK (
   (kind='terminal' AND resource_type='terminal' AND requested_by IS NOT NULL AND challenge_id IS NULL AND scope='practice' AND owner_key='u:'||requested_by::text)
   OR (kind<>'terminal' AND resource_type<>'terminal' AND challenge_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS instances_terminal_active ON instances(owner_key) WHERE kind='terminal' AND status IN ('queued','starting','running','ready','stopping');
INSERT INTO schema_migrations(version) VALUES(27) ON CONFLICT DO NOTHING;

ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id uuid;
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
UPDATE announcements a SET created_by=(
  SELECT l.actor_id FROM audit_logs l JOIN users u ON u.id=l.actor_id
  WHERE l.action='announcement.create' AND l.target=a.id::text ORDER BY l.created_at,l.id LIMIT 1
) WHERE a.created_by IS NULL AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=28);
INSERT INTO schema_migrations(version) VALUES(28) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS notifications(id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('system','contest','reminder')),title varchar(120) NOT NULL,body text NOT NULL CHECK(length(body)<=8000),href varchar(500),action_label varchar(30),sender_id uuid REFERENCES users(id) ON DELETE SET NULL,event_key text UNIQUE,audience text NOT NULL DEFAULT '自动通知',created_at timestamptz NOT NULL DEFAULT now(),withdrawn_at timestamptz);
CREATE TABLE IF NOT EXISTS notification_recipients(notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,read_at timestamptz,archived_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(notification_id,user_id));
CREATE INDEX IF NOT EXISTS notification_inbox ON notification_recipients(user_id,created_at DESC,notification_id DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_archive ON notification_recipients(user_id,created_at DESC,notification_id DESC) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS notification_unread ON notification_recipients(user_id) WHERE read_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS notification_revision ON notification_recipients(user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS notification_history ON notifications(created_at DESC,id DESC) WHERE sender_id IS NOT NULL AND kind='system';
INSERT INTO schema_migrations(version) VALUES(29) ON CONFLICT DO NOTHING;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actions jsonb NOT NULL DEFAULT '[]';
ALTER TABLE teams ADD COLUMN IF NOT EXISTS logo_id uuid;
ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_form jsonb NOT NULL DEFAULT '[]';
ALTER TABLE contest_groups ADD COLUMN IF NOT EXISTS review_mode text NOT NULL DEFAULT 'inherit' CHECK(review_mode IN ('inherit','auto','required'));
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS form_snapshot jsonb NOT NULL DEFAULT '[]';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS form_answers jsonb NOT NULL DEFAULT '{"team":{},"members":{}}';
ALTER TABLE registrations ADD COLUMN IF NOT EXISTS submitted_members jsonb NOT NULL DEFAULT '[]';
UPDATE contest_groups SET review_mode='required' WHERE coalesce((permissions->>'require_review')::boolean,false) AND review_mode='inherit' AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=30);
INSERT INTO schema_migrations(version) VALUES(30) ON CONFLICT DO NOTHING;

ALTER TABLE submissions ADD COLUMN IF NOT EXISTS flag_cipher text;
CREATE TABLE IF NOT EXISTS contest_flag_templates(
 contest_id uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
 challenge_id uuid NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
 owner_key text NOT NULL,part_key text NOT NULL,template text NOT NULL,
 PRIMARY KEY(contest_id,challenge_id,owner_key,part_key));
INSERT INTO contest_flag_templates(contest_id,challenge_id,owner_key,part_key,template)
 SELECT DISTINCT ON(co.id,i.challenge_id,i.owner_key,p.key) co.id,i.challenge_id,i.owner_key,p.key,
 coalesce(i.spec->'part_templates'->>p.key,i.spec->>'flag_template','')
 FROM instances i JOIN contests co ON co.id::text=i.scope JOIN challenges c ON c.id=i.challenge_id
 CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_array_length(coalesce(i.spec->'parts','[]'))>0 THEN i.spec->'parts' ELSE '[""]'::jsonb END) p(key)
 WHERE c.challenge_type<>'awd' AND coalesce(i.spec->>'flag_mode',CASE WHEN i.kind LIKE 'dynamic%' THEN 'dynamic' ELSE 'static' END)='dynamic'
 AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=31)
 ORDER BY co.id,i.challenge_id,i.owner_key,p.key,i.created_at DESC,i.id DESC ON CONFLICT DO NOTHING;
CREATE UNIQUE INDEX IF NOT EXISTS issued_flags_identity ON issued_flags(contest_id,challenge_id,part_key,owner_key,flag_hash);
ALTER TABLE issued_flags DROP CONSTRAINT IF EXISTS issued_flags_pkey;
INSERT INTO schema_migrations(version) VALUES(31) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS roles(id uuid PRIMARY KEY,name varchar(48) NOT NULL UNIQUE,permissions jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS user_roles(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,PRIMARY KEY(user_id,role_id));
CREATE INDEX IF NOT EXISTS user_roles_role ON user_roles(role_id,user_id);
CREATE TABLE IF NOT EXISTS user_grants(user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind text NOT NULL CHECK(kind IN ('challenge','contest')),target_id uuid NOT NULL,permissions jsonb NOT NULL,PRIMARY KEY(user_id,kind,target_id));
ALTER TABLE users ADD COLUMN IF NOT EXISTS access_profile jsonb NOT NULL DEFAULT '{"permissions":[],"roles":[],"grants":[]}';
INSERT INTO schema_migrations(version) VALUES(32) ON CONFLICT DO NOTHING;

ALTER TABLE contests ADD COLUMN IF NOT EXISTS traffic_mode text NOT NULL DEFAULT 'inherit' CHECK(traffic_mode IN ('inherit','off','stats','capture'));
CREATE TABLE IF NOT EXISTS instance_traffic(
 instance_id uuid PRIMARY KEY REFERENCES instances(id) ON DELETE CASCADE,
 rx_bytes bigint NOT NULL DEFAULT 0,tx_bytes bigint NOT NULL DEFAULT 0,
 last_rx bigint NOT NULL DEFAULT 0,last_tx bigint NOT NULL DEFAULT 0,
 rx_rate double precision NOT NULL DEFAULT 0,tx_rate double precision NOT NULL DEFAULT 0,
 sampled_at timestamptz,capture_status text NOT NULL DEFAULT 'off',capture_error text,
 capture_config text,capture_reserved bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS traffic_samples(instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,bucket timestamptz NOT NULL,rx_bytes bigint NOT NULL,tx_bytes bigint NOT NULL,PRIMARY KEY(instance_id,bucket));
CREATE INDEX IF NOT EXISTS traffic_samples_retention ON traffic_samples(bucket);
CREATE TABLE IF NOT EXISTS traffic_files(id uuid PRIMARY KEY,instance_id uuid NOT NULL REFERENCES instances(id) ON DELETE CASCADE,name text NOT NULL,size bigint NOT NULL,created_at timestamptz NOT NULL,UNIQUE(instance_id,name));
CREATE INDEX IF NOT EXISTS traffic_files_instance ON traffic_files(instance_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS traffic_files_retention ON traffic_files(created_at);
INSERT INTO schema_migrations(version) VALUES(33) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS help_documents(
 id uuid PRIMARY KEY,
 slug varchar(80) NOT NULL UNIQUE CHECK(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 title varchar(160) NOT NULL CHECK(length(trim(title))>0),
 category varchar(40) NOT NULL CHECK(length(trim(category))>0),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 100000),
 body text NOT NULL CHECK(length(body)<=200000),
 published boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS help_documents_order ON help_documents(position,title,id);
CREATE INDEX IF NOT EXISTS help_documents_published_order ON help_documents(position,title,id) WHERE published;

ALTER TABLE help_documents ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE help_documents ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES users(id) ON DELETE SET NULL;
UPDATE help_documents d SET created_by=(
 SELECT l.actor_id FROM audit_logs l JOIN users u ON u.id=l.actor_id
 WHERE l.action='help.save' AND l.target=d.id::text AND l.created_at=d.created_at
 ORDER BY l.created_at,l.id LIMIT 1
) WHERE d.created_by IS NULL AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=35);
UPDATE help_documents d SET updated_by=(
 SELECT l.actor_id FROM audit_logs l JOIN users u ON u.id=l.actor_id
 WHERE l.action='help.save' AND l.target=d.id::text AND l.created_at=d.updated_at
 ORDER BY l.created_at DESC,l.id DESC LIMIT 1
) WHERE d.updated_by IS NULL AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=35);
INSERT INTO schema_migrations(version) VALUES(35) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS api_keys(
 id uuid PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name varchar(80) NOT NULL CHECK(length(trim(name))>0),
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
 prefix varchar(16) NOT NULL,
 scopes jsonb NOT NULL CHECK(jsonb_typeof(scopes)='array'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 last_used_at timestamptz,
 revoked_at timestamptz);
CREATE INDEX IF NOT EXISTS api_keys_owner ON api_keys(user_id,created_at DESC,id DESC);
INSERT INTO schema_migrations(version) VALUES(36) ON CONFLICT DO NOTHING;

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS identity_id text;
INSERT INTO schema_migrations(version) VALUES(37) ON CONFLICT DO NOTHING;

ALTER TABLE contest_challenges ADD COLUMN IF NOT EXISTS logic jsonb NOT NULL DEFAULT '{"exclusive_group":null,"dependency":null}';
CREATE TABLE IF NOT EXISTS contest_exclusive_choices(
 contest_id uuid NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
 owner_key text NOT NULL,
 group_name varchar(60) NOT NULL CHECK(length(trim(group_name))>0),
 challenge_id uuid NOT NULL REFERENCES challenges(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(contest_id,owner_key,group_name));
INSERT INTO schema_migrations(version) VALUES(38) ON CONFLICT DO NOTHING;

ALTER TABLE contest_groups ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX IF NOT EXISTS contest_groups_one_default ON contest_groups(contest_id) WHERE is_default;
INSERT INTO contest_groups(id,contest_id,name,description,position,is_default)
 SELECT gen_random_uuid(),c.id,'默认组别','',-1,true FROM contests c
 WHERE NOT EXISTS(SELECT 1 FROM contest_groups g WHERE g.contest_id=c.id AND g.is_default)
 AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=39);
UPDATE registrations r SET group_id=g.id FROM contest_groups g
 WHERE r.contest_id=g.contest_id AND r.group_id IS NULL AND g.is_default
 AND NOT EXISTS(SELECT 1 FROM schema_migrations WHERE version=39);
INSERT INTO schema_migrations(version) VALUES(39) ON CONFLICT DO NOTHING;

ALTER TABLE contest_groups ADD COLUMN IF NOT EXISTS invite_code_cipher text NOT NULL DEFAULT '';
INSERT INTO schema_migrations(version) VALUES(40) ON CONFLICT DO NOTHING;

ALTER TABLE docker_image_pulls ALTER COLUMN image DROP NOT NULL;
ALTER TABLE docker_image_pulls ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'pull' CHECK(kind IN ('pull','load'));
ALTER TABLE docker_image_pulls ADD COLUMN IF NOT EXISTS image_refs jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS docker_image_uploads(
 id uuid PRIMARY KEY,
 requested_by uuid NOT NULL REFERENCES users(id),
 filename text NOT NULL,
 size bigint NOT NULL,
 received bigint NOT NULL DEFAULT 0,
 job_id uuid REFERENCES docker_image_pulls(id),
 updated_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version) VALUES(41) ON CONFLICT DO NOTHING;

ALTER TABLE challenges ADD COLUMN IF NOT EXISTS flag_targets jsonb;
ALTER TABLE challenge_parts ADD COLUMN IF NOT EXISTS flag_targets jsonb;
