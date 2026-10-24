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
