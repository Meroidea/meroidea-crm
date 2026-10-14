CREATE TABLE "training_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"role_id" uuid,
	"department_id" uuid,
	"user_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_assignments_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "training_completions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"best_score" integer,
	"last_score" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_completions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "training_completions_person_key" UNIQUE("tenant_id","module_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "training_courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_courses_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "training_modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"video_url" text,
	"pass_mark" integer DEFAULT 80 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_modules_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "training_question_keys" (
	"question_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"correct_option" smallint NOT NULL,
	CONSTRAINT "training_question_keys_tenant_id_question_id_pk" PRIMARY KEY("tenant_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "training_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"options" text[] DEFAULT '{}'::text[] NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "training_questions_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."training_courses"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."roles"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_assignments" ADD CONSTRAINT "training_assignments_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_completions" ADD CONSTRAINT "training_completions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_completions" ADD CONSTRAINT "training_completions_module_fk" FOREIGN KEY ("tenant_id","module_id") REFERENCES "public"."training_modules"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_courses" ADD CONSTRAINT "training_courses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_modules" ADD CONSTRAINT "training_modules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_modules" ADD CONSTRAINT "training_modules_course_fk" FOREIGN KEY ("tenant_id","course_id") REFERENCES "public"."training_courses"("tenant_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_question_keys" ADD CONSTRAINT "training_question_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_question_keys" ADD CONSTRAINT "training_question_keys_question_fk" FOREIGN KEY ("tenant_id","question_id") REFERENCES "public"."training_questions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_questions" ADD CONSTRAINT "training_questions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_questions" ADD CONSTRAINT "training_questions_module_fk" FOREIGN KEY ("tenant_id","module_id") REFERENCES "public"."training_modules"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "training_assignments_course_idx" ON "training_assignments" USING btree ("tenant_id","course_id");--> statement-breakpoint
CREATE INDEX "training_completions_user_idx" ON "training_completions" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "training_courses_tenant_order_idx" ON "training_courses" USING btree ("tenant_id","position");--> statement-breakpoint
CREATE INDEX "training_modules_course_idx" ON "training_modules" USING btree ("tenant_id","course_id","position");--> statement-breakpoint
CREATE INDEX "training_questions_module_idx" ON "training_questions" USING btree ("tenant_id","module_id","position");--> statement-breakpoint
-- Staff training (ADR-050): rules, who may read and write what, marking in the database, the
-- feature switch, and grants for existing businesses' roles. See docs/database.md §7o.
alter table "training_courses" add constraint training_courses_status_known
  check (status in ('draft', 'published', 'archived'));
alter table "training_courses" add constraint training_courses_title_length
  check (char_length(title) between 2 and 150);
alter table "training_courses" add constraint training_courses_description_length
  check (description is null or char_length(description) <= 2000);
alter table "training_modules" add constraint training_modules_title_length
  check (char_length(title) between 2 and 150);
alter table "training_modules" add constraint training_modules_body_length
  check (char_length(body) <= 50000);
alter table "training_modules" add constraint training_modules_pass_mark_range
  check (pass_mark between 1 and 100);
alter table "training_modules" add constraint training_modules_video_https
  check (video_url is null or (video_url like 'https://%' and char_length(video_url) <= 500));
alter table "training_questions" add constraint training_questions_prompt_length
  check (char_length(prompt) between 3 and 500);
alter table "training_questions" add constraint training_questions_option_count
  check (cardinality(options) between 2 and 6);
alter table "training_question_keys" add constraint training_question_keys_option_known
  check (correct_option between 0 and 5);
alter table "training_assignments" add constraint training_assignments_audience_known
  check (
    (audience = 'everyone' and role_id is null and department_id is null and user_id is null)
    or (audience = 'role' and role_id is not null and department_id is null and user_id is null)
    or (audience = 'department' and department_id is not null and role_id is null and user_id is null)
    or (audience = 'person' and user_id is not null and role_id is null and department_id is null)
  );
create unique index training_assignments_target_key on "training_assignments" (
  tenant_id, course_id, audience,
  coalesce(role_id, department_id, user_id, '00000000-0000-0000-0000-000000000000'::uuid)
);
alter table "training_completions" add constraint training_completions_scores_range
  check (
    (best_score is null or best_score between 0 and 100)
    and (last_score is null or last_score between 0 and 100)
    and attempts >= 0
  );
alter table "training_completions" add constraint training_completions_passed_has_date
  check (not passed or completed_at is not null);

create trigger set_updated_at before update on "training_courses"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "training_modules"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "training_questions"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

-- Whether a course is assigned to a person: everyone, their role, their department (through
-- their staff record) or them by name. Internal: callable only from the functions below.
create function app.training_is_assigned(p_tenant uuid, p_course uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.training_assignments a
    join public.tenant_memberships m
      on m.tenant_id = a.tenant_id and m.user_id = p_user and m.status = 'active'
    where a.tenant_id = p_tenant and a.course_id = p_course
      and (
        a.audience = 'everyone'
        or (a.audience = 'role' and a.role_id = m.role_id)
        or (a.audience = 'person' and a.user_id = p_user)
        or (a.audience = 'department' and exists (
          select 1 from public.employees e
          where e.tenant_id = a.tenant_id and e.user_id = p_user
            and e.department_id = a.department_id
            and e.deleted_at is null and e.status <> 'ended'
        ))
      )
  );
$$;
revoke all on function app.training_is_assigned(uuid, uuid, uuid) from public;

-- For the policies: is this course in the signed-in person's own training, in the open business?
create function app.training_assigned_to_me(p_course uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.training_is_assigned(app.active_tenant_id(), p_course, app.user_id());
$$;
revoke all on function app.training_assigned_to_me(uuid) from public;
grant execute on function app.training_assigned_to_me(uuid) to authenticated;

--> statement-breakpoint

alter table "training_courses" enable row level security;
alter table "training_modules" enable row level security;
alter table "training_questions" enable row level security;
alter table "training_question_keys" enable row level security;
alter table "training_assignments" enable row level security;
alter table "training_completions" enable row level security;

-- Those who write training or follow everyone's progress see every course; everyone else sees a
-- published course only when it is assigned to them.
create policy training_courses_read on "training_courses" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
      or (select app.has_permission((select app.active_tenant_id()), 'training.view_all'))
      or (
        status = 'published'
        and (select app.has_permission((select app.active_tenant_id()), 'training.learn'))
        and app.training_assigned_to_me(id)
      )
    )
  );
create policy training_courses_write on "training_courses" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  );

-- Modules and questions follow their course: the subquery is itself filtered by the policy above.
create policy training_modules_read on "training_modules" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and exists (
      select 1 from public.training_courses c
      where c.tenant_id = training_modules.tenant_id and c.id = training_modules.course_id
    )
  );
create policy training_modules_write on "training_modules" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  );
create policy training_questions_read on "training_questions" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and exists (
      select 1 from public.training_modules m
      where m.tenant_id = training_questions.tenant_id and m.id = training_questions.module_id
    )
  );
create policy training_questions_write on "training_questions" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  );

-- The answers: only those who write the training, never those taking it.
create policy training_question_keys_manage on "training_question_keys" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  );

create policy training_assignments_read on "training_assignments" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
      or (select app.has_permission((select app.active_tenant_id()), 'training.view_all'))
    )
  );
create policy training_assignments_write on "training_assignments" for all to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  )
  with check (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
  );

-- Your own results, or everyone's for those who follow progress. Nobody writes them directly:
-- only app.submit_training_module does, after marking.
create policy training_completions_read on "training_completions" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (
      user_id = (select app.user_id())
      or (select app.has_permission((select app.active_tenant_id()), 'training.view_all'))
      or (select app.has_permission((select app.active_tenant_id()), 'training.manage'))
    )
  );

-- Owned by one feature: hidden entirely while it is switched off (ADR-038).
do $$
declare t text;
begin
  foreach t in array array['training_courses', 'training_modules', 'training_questions',
    'training_question_keys', 'training_assignments', 'training_completions']
  loop
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'training', 'training'
    );
  end loop;
end;
$$;

grant select, insert, update, delete on "training_courses" to authenticated;
grant select, insert, update, delete on "training_modules" to authenticated;
grant select, insert, update, delete on "training_questions" to authenticated;
grant select, insert, update, delete on "training_question_keys" to authenticated;
grant select, insert, delete on "training_assignments" to authenticated;
grant select on "training_completions" to authenticated;

--> statement-breakpoint

-- Marks a module for the signed-in person and records the result: the share of questions right
-- against the module's pass mark, or simply done for a module without questions. Runs with the
-- function owner's rights so the answers can be read without ever being shown to the person.
-- Answers are {question id: option index}. Passed stays passed; the best score is kept.
create function app.submit_training_module(p_module uuid, p_answers jsonb)
returns table (result_passed boolean, result_score integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.active_tenant_id();
  v_user uuid := app.user_id();
  v_course uuid;
  v_pass integer;
  v_total integer;
  v_correct integer;
  v_score integer;
  v_passed boolean;
begin
  if v_tenant is null or v_user is null
     or v_tenant not in (select app.tenant_ids())
     or not app.has_permission(v_tenant, 'training.learn') then
    raise exception 'training module not available' using errcode = '42501';
  end if;

  select m.course_id, m.pass_mark into v_course, v_pass
  from public.training_modules m
  join public.training_courses c on c.tenant_id = m.tenant_id and c.id = m.course_id
  where m.tenant_id = v_tenant and m.id = p_module and c.status = 'published';
  if v_course is null or not app.training_is_assigned(v_tenant, v_course, v_user) then
    raise exception 'training module not available' using errcode = '42501';
  end if;

  select
    count(*)::integer,
    count(*) filter (
      where (p_answers ->> q.id::text) ~ '^[0-9]$'
        and (p_answers ->> q.id::text)::smallint = k.correct_option
    )::integer
  into v_total, v_correct
  from public.training_questions q
  join public.training_question_keys k on k.tenant_id = q.tenant_id and k.question_id = q.id
  where q.tenant_id = v_tenant and q.module_id = p_module;

  if v_total = 0 then
    v_score := null;
    v_passed := true;
  else
    v_score := round(v_correct * 100.0 / v_total)::integer;
    v_passed := v_score >= v_pass;
  end if;

  insert into public.training_completions as tc
    (tenant_id, module_id, user_id, passed, best_score, last_score, attempts, completed_at,
     last_attempt_at)
  values
    (v_tenant, p_module, v_user, v_passed, v_score, v_score, 1,
     case when v_passed then now() end, now())
  on conflict (tenant_id, module_id, user_id) do update set
    passed = tc.passed or excluded.passed,
    best_score = greatest(tc.best_score, excluded.best_score),
    last_score = excluded.last_score,
    attempts = tc.attempts + 1,
    completed_at = coalesce(tc.completed_at, excluded.completed_at),
    last_attempt_at = now();

  return query select v_passed, v_score;
end;
$$;
revoke all on function app.submit_training_module(uuid, jsonb) from public;
grant execute on function app.submit_training_module(uuid, jsonb) to authenticated;

-- Progress per person and published course: how many modules, how many passed. Those who
-- follow everyone's progress get every active member (support seats aside); anyone else only
-- themselves. Assignment is worked out here, where departments can be read.
create function app.training_progress()
returns table (user_id uuid, course_id uuid, modules integer, passed integer)
language sql stable security definer set search_path = '' as $$
  with allowed as (
    select t.tenant, t.uid,
      app.has_permission(t.tenant, 'training.view_all') as everyone,
      app.has_permission(t.tenant, 'training.learn') as self
    from (select app.active_tenant_id() as tenant, app.user_id() as uid) t
    where t.tenant in (select app.tenant_ids())
  ),
  people as (
    select m.user_id, a.tenant
    from public.tenant_memberships m
    join allowed a on a.tenant = m.tenant_id
    where m.status = 'active' and not m.is_support
      and (a.everyone or (a.self and m.user_id = a.uid))
  )
  select p.user_id, c.id,
    (select count(*)::integer from public.training_modules mo
     where mo.tenant_id = c.tenant_id and mo.course_id = c.id),
    (select count(*)::integer from public.training_modules mo
     join public.training_completions tc
       on tc.tenant_id = mo.tenant_id and tc.module_id = mo.id
      and tc.user_id = p.user_id and tc.passed
     where mo.tenant_id = c.tenant_id and mo.course_id = c.id)
  from people p
  join public.training_courses c on c.tenant_id = p.tenant and c.status = 'published'
  where app.training_is_assigned(p.tenant, c.id, p.user_id);
$$;
revoke all on function app.training_progress() from public;
grant execute on function app.training_progress() to authenticated;

--> statement-breakpoint

create or replace function app.permission_feature(perm text) returns text
language sql immutable set search_path = '' as $$
  select case split_part(perm, '.', 1)
    when 'contacts' then 'crm'
    when 'opportunities' then 'crm'
    when 'revenue' then 'crm'
    when 'activities' then 'crm'
    when 'documents' then 'crm'
    when 'partners' then 'crm'
    when 'organizations' then 'crm'
    when 'products' then 'crm'
    when 'reports' then 'crm'
    when 'tasks' then 'tasks'
    when 'rosters' then 'roster'
    when 'timeoff' then 'timeoff'
    when 'timesheets' then 'timesheets'
    when 'employees' then 'staff'
    when 'recruitment' then 'recruitment'
    when 'reviews' then 'reviews'
    when 'tickets' then 'helpdesk'
    when 'projects' then 'projects'
    when 'productivity' then 'productivity'
    when 'inventory' then 'inventory'
    when 'purchasing' then 'purchasing'
    when 'files' then 'files'
    when 'invoices' then 'invoices'
    when 'expenses' then 'expenses'
    when 'payroll' then 'payroll'
    when 'concerns' then 'concerns'
    when 'training' then 'training'
    else null
  end;
$$;

--> statement-breakpoint

-- Existing businesses' roles get the same grants a new business's do. The feature itself stays
-- off until the platform owner switches it on for a business (ADR-029).
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('training.learn'), ('training.view_all'), ('training.manage')) as p(permission)
where r.key = 'owner'
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('training.learn'), ('training.view_all')) as p(permission)
where r.key = 'manager'
on conflict (role_id, permission) do nothing;

insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, 'training.learn', null
from public.roles r
where r.key in ('member', 'support')
on conflict (role_id, permission) do nothing;
