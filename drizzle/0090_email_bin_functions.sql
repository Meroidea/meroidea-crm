-- Custom SQL migration file, put your code below! --
-- Bin and Important for email threads (ADR-093).
-- Sessions may set only these two columns, and only through the trigger's rules below.
grant update (deleted_at, important) on "social_conversations" to authenticated;
--> statement-breakpoint
-- A session cannot choose when a thread went into the Bin (that would shorten its 30 days), bin
-- or flag anything but an email thread, or do either without `social.reply`.
create or replace function app.social_conversations_bin_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.deleted_at is not distinct from old.deleted_at
     and new.important is not distinct from old.important then
    return new;
  end if;
  if (select auth.uid()) is not null then
    if not app.has_permission(new.tenant_id, 'social.reply') then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    if not exists (select 1 from public.social_accounts a
                   where a.tenant_id = new.tenant_id and a.id = new.account_id
                     and a.platform = 'email') then
      raise exception 'only email threads go in the Bin or are marked important'
        using errcode = '42501';
    end if;
    -- The Bin's clock is the database's: set when a thread goes in, never moved while there.
    if new.deleted_at is not null and old.deleted_at is null then
      new.deleted_at := now();
    elsif new.deleted_at is not null and old.deleted_at is not null then
      new.deleted_at := old.deleted_at;
    end if;
  end if;
  return new;
end;
$$;
--> statement-breakpoint
create trigger social_conversations_bin_guard
  before update of deleted_at, important on "social_conversations"
  for each row execute function app.social_conversations_bin_guard();
--> statement-breakpoint
-- Deletes one binned email thread's rows and returns its stored files for the application to
-- remove from storage. Files still used by a signature or a draft are kept. Not callable by
-- sessions: `app.email_purge_thread` (a person) and the daily sweep (privileged) call it.
create or replace function app.email_delete_thread_rows(p_tenant uuid, p_conversation uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  paths text[];
begin
  if not exists (
    select 1 from public.social_conversations c
    join public.social_accounts a on a.tenant_id = c.tenant_id and a.id = c.account_id
    where c.tenant_id = p_tenant and c.id = p_conversation
      and c.deleted_at is not null and a.platform = 'email'
  ) then
    raise exception 'record not found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(distinct path), '{}') into paths from (
    select f ->> 'storagePath' as path
    from public.social_messages m
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(m.attachments) = 'array' then m.attachments else '[]'::jsonb end) f
    where m.tenant_id = p_tenant and m.conversation_id = p_conversation
    union all
    select c.participant_avatar_path from public.social_conversations c
    where c.tenant_id = p_tenant and c.id = p_conversation
  ) found
  where path is not null
    and not exists (select 1 from public.email_signatures s
                    where s.tenant_id = p_tenant and position(found.path in s.doc::text) > 0)
    and not exists (select 1 from public.email_drafts d
                    where d.tenant_id = p_tenant
                      and position(found.path in d.content::text) > 0);
  -- A ticket or a tracked help link made from the thread stays, without the thread.
  update public.tickets set conversation_id = null
  where tenant_id = p_tenant and conversation_id = p_conversation;
  update public.kb_article_links set conversation_id = null
  where tenant_id = p_tenant and conversation_id = p_conversation;
  delete from public.social_messages where tenant_id = p_tenant and conversation_id = p_conversation;
  delete from public.social_conversations where tenant_id = p_tenant and id = p_conversation;
  return query select unnest(paths);
end;
$$;
--> statement-breakpoint
revoke execute on function app.email_delete_thread_rows(uuid, uuid) from public, authenticated;
--> statement-breakpoint
-- "Delete forever" by a person: their own business, `social.manage`, and only from the Bin.
create or replace function app.email_purge_thread(p_conversation uuid)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
declare
  t uuid := app.active_tenant_id();
begin
  if t is null or t not in (select app.tenant_ids())
     or not app.has_permission(t, 'social.manage') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query select app.email_delete_thread_rows(t, p_conversation);
end;
$$;
--> statement-breakpoint
revoke execute on function app.email_purge_thread(uuid) from public;
--> statement-breakpoint
grant execute on function app.email_purge_thread(uuid) to authenticated;
