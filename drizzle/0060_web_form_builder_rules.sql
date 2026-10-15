-- Website forms the admin builds (docs/leads.md §3.1): limits on what a form holds, and the
-- forms that already exist rebuilt as field lists that ask exactly what they asked before.

alter table "web_forms" add constraint web_forms_fields_is_list
  check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 30);
alter table "web_forms" add constraint web_forms_heading_length
  check (heading is null or char_length(heading) <= 120);
alter table "web_forms" add constraint web_forms_intro_length
  check (intro is null or char_length(intro) <= 1000);
alter table "web_forms" add constraint web_forms_submit_label_length
  check (submit_label is null or char_length(submit_label) <= 40);

--> statement-breakpoint

update "web_forms" f set
  fields = (
    select jsonb_agg(item order by ord)
    from (
      select 1 as ord, jsonb_build_object('id', 'first-name', 'target', 'firstName', 'label', 'First name', 'required', true, 'help', null) as item
      union all select 2, jsonb_build_object('id', 'last-name', 'target', 'lastName', 'label', 'Last name', 'required', false, 'help', null)
      union all select 3, jsonb_build_object('id', 'email', 'target', 'email', 'label', 'Email', 'required', true, 'help', null)
      union all select 4, jsonb_build_object('id', 'phone', 'target', 'phone', 'label', 'Phone', 'required', false, 'help', null)
      union all select 5, jsonb_build_object('id', 'company', 'target', 'companyName', 'label', 'Company', 'required', false, 'help', null) where f.ask_company
      union all select 6, jsonb_build_object('id', 'job-title', 'target', 'jobTitle', 'label', 'Job title', 'required', false, 'help', null) where f.ask_company
      union all select 7, jsonb_build_object('id', 'message', 'target', 'message', 'label', 'How can we help?', 'required', false, 'help', null) where f.ask_message
      union all select 8, jsonb_build_object('id', 'consent', 'target', 'consent', 'label', 'Send me news and offers by email. I can unsubscribe at any time.', 'required', false, 'help', null) where f.ask_consent
    ) items
  ),
  heading = coalesce(f.heading, f.name),
  published_at = case when f.is_active then coalesce(f.published_at, f.updated_at) else f.published_at end
where jsonb_array_length(f.fields) = 0;
