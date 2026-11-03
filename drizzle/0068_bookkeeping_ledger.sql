CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"subtype" text NOT NULL,
	"is_bank" boolean DEFAULT false NOT NULL,
	"system_key" text,
	"default_tax_code_id" uuid,
	"description" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ledger_accounts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_accounts_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "ledger_accounts_system_key" UNIQUE("tenant_id","system_key")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"contact_name" text,
	"is_adjustment" boolean DEFAULT false NOT NULL,
	"source_type" text,
	"source_id" uuid,
	"source_event" text,
	"payroll" boolean DEFAULT false NOT NULL,
	"currency" char(3) NOT NULL,
	"reverses_entry_id" uuid,
	"reversed_by_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ledger_entries_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_entries_number_key" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"tax_code_id" uuid,
	"tax_amount" numeric(14, 2),
	"payroll" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ledger_lines_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ledger_settings" (
	"tenant_id" uuid NOT NULL,
	"country_pack" char(2) NOT NULL,
	"financial_year_start_month" smallint NOT NULL,
	"start_date" date NOT NULL,
	"lock_date" date,
	"receipts_account_id" uuid NOT NULL,
	"invoice_income_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ledger_settings_pkey" PRIMARY KEY("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_tax_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(5, 2) NOT NULL,
	"kind" text NOT NULL,
	"applies_to" text NOT NULL,
	"system_key" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	CONSTRAINT "ledger_tax_codes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_tax_codes_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "ledger_tax_codes_system_key" UNIQUE("tenant_id","system_key")
);
--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_tax_code_fk" FOREIGN KEY ("tenant_id","default_tax_code_id") REFERENCES "public"."ledger_tax_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reverses_fk" FOREIGN KEY ("tenant_id","reverses_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_reversed_by_fk" FOREIGN KEY ("tenant_id","reversed_by_entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_fk" FOREIGN KEY ("tenant_id","entry_id") REFERENCES "public"."ledger_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_tax_code_fk" FOREIGN KEY ("tenant_id","tax_code_id") REFERENCES "public"."ledger_tax_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_settings" ADD CONSTRAINT "ledger_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_settings" ADD CONSTRAINT "ledger_settings_receipts_fk" FOREIGN KEY ("tenant_id","receipts_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_settings" ADD CONSTRAINT "ledger_settings_income_fk" FOREIGN KEY ("tenant_id","invoice_income_account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_tax_codes" ADD CONSTRAINT "ledger_tax_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_date_idx" ON "ledger_entries" USING btree ("tenant_id","date","number");--> statement-breakpoint
CREATE INDEX "ledger_entries_source_idx" ON "ledger_entries" USING btree ("tenant_id","source_type","source_id");--> statement-breakpoint
CREATE INDEX "ledger_lines_entry_idx" ON "ledger_lines" USING btree ("tenant_id","entry_id");--> statement-breakpoint
CREATE INDEX "ledger_lines_account_idx" ON "ledger_lines" USING btree ("tenant_id","account_id","date");--> statement-breakpoint
-- Bookkeeping, ledger core (ADR-060): the rules, who may read and write what, posting functions,
-- the feature switch, and grants for existing businesses' Admin role. See docs/database.md §7p.
alter table "ledger_tax_codes" add constraint ledger_tax_codes_kind_known
  check (kind in ('taxable', 'gst_free', 'input_taxed', 'export', 'capital', 'out_of_scope'));
alter table "ledger_tax_codes" add constraint ledger_tax_codes_applies_known
  check (applies_to in ('sales', 'purchases', 'both'));
alter table "ledger_tax_codes" add constraint ledger_tax_codes_rate_range
  check (rate >= 0 and rate <= 100);
alter table "ledger_tax_codes" add constraint ledger_tax_codes_code_format
  check (code ~ '^[A-Za-z0-9-]{1,12}$');
alter table "ledger_tax_codes" add constraint ledger_tax_codes_name_length
  check (char_length(name) between 2 and 80);

alter table "ledger_accounts" add constraint ledger_accounts_type_known
  check (
    (type = 'asset' and subtype in ('bank', 'current_asset', 'fixed_asset', 'non_current_asset'))
    or (type = 'liability' and subtype in ('current_liability', 'non_current_liability'))
    or (type = 'equity' and subtype = 'equity')
    or (type = 'income' and subtype in ('revenue', 'other_income'))
    or (type = 'expense' and subtype in ('cost_of_sales', 'expense', 'other_expense'))
  );
alter table "ledger_accounts" add constraint ledger_accounts_bank_kind
  check (not is_bank or type in ('asset', 'liability'));
alter table "ledger_accounts" add constraint ledger_accounts_code_format
  check (code ~ '^[A-Za-z0-9.-]{1,12}$');
alter table "ledger_accounts" add constraint ledger_accounts_name_length
  check (char_length(name) between 2 and 100);
alter table "ledger_accounts" add constraint ledger_accounts_description_length
  check (description is null or char_length(description) <= 500);

alter table "ledger_settings" add constraint ledger_settings_year_start_month
  check (financial_year_start_month between 1 and 12);
alter table "ledger_settings" add constraint ledger_settings_country_format
  check (country_pack ~ '^[A-Z]{2}$');

alter table "ledger_entries" add constraint ledger_entries_kind_known
  check (kind in ('money_in', 'money_out', 'transfer', 'journal', 'opening_balance', 'invoice',
                  'invoice_payment', 'payslip', 'payslip_payment', 'reversal'));
alter table "ledger_entries" add constraint ledger_entries_number_positive check (number > 0);
alter table "ledger_entries" add constraint ledger_entries_description_length
  check (char_length(description) between 1 and 300);
alter table "ledger_entries" add constraint ledger_entries_reference_length
  check (reference is null or char_length(reference) <= 100);
alter table "ledger_entries" add constraint ledger_entries_contact_length
  check (contact_name is null or char_length(contact_name) <= 150);
alter table "ledger_entries" add constraint ledger_entries_currency_format
  check (currency ~ '^[A-Z]{3}$');
alter table "ledger_entries" add constraint ledger_entries_source_complete
  check (
    (source_type is null and source_id is null and source_event is null)
    or (source_type in ('invoice', 'payslip') and source_id is not null and source_event is not null)
  );
alter table "ledger_entries" add constraint ledger_entries_reversal_link
  check ((kind = 'reversal') = (reverses_entry_id is not null));
alter table "ledger_entries" add constraint ledger_entries_adjustment_is_journal
  check (not is_adjustment or kind = 'journal');
-- Posting the same thing twice (an invoice re-sent, a double click) finds the first entry.
create unique index ledger_entries_source_event_key on "ledger_entries"
  (tenant_id, source_type, source_id, source_event) where source_type is not null;
create unique index ledger_entries_one_reversal_key on "ledger_entries"
  (tenant_id, reverses_entry_id) where reverses_entry_id is not null;

alter table "ledger_lines" add constraint ledger_lines_amounts_one_side
  check (debit >= 0 and credit >= 0 and (debit > 0) <> (credit > 0));
alter table "ledger_lines" add constraint ledger_lines_tax_amount_positive
  check (tax_amount is null or tax_amount >= 0);
alter table "ledger_lines" add constraint ledger_lines_description_length
  check (description is null or char_length(description) <= 300);

create trigger set_updated_at before update on "ledger_tax_codes"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "ledger_accounts"
  for each row execute function app.set_updated_at();
create trigger set_updated_at before update on "ledger_settings"
  for each row execute function app.set_updated_at();

--> statement-breakpoint

-- Double entry, checked when the transaction commits: every entry has at least two lines and
-- its debits equal its credits. Nothing unbalanced can be saved, whoever writes it.
create function app.ledger_check_balanced() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_entry uuid;
  v_debit numeric;
  v_credit numeric;
  v_lines integer;
  v_wrong_date integer;
begin
  -- Read through to_jsonb: NEW is an entry or a line, and only a line has entry_id.
  if tg_table_name = 'ledger_entries' then
    v_entry := (to_jsonb(new) ->> 'id')::uuid;
  else
    v_entry := (to_jsonb(new) ->> 'entry_id')::uuid;
  end if;
  if not exists (select 1 from public.ledger_entries e
                 where e.tenant_id = new.tenant_id and e.id = v_entry) then
    return null;
  end if;
  select coalesce(sum(l.debit), 0), coalesce(sum(l.credit), 0), count(*),
         count(*) filter (where l.date <> e.date or l.payroll <> e.payroll)
  into v_debit, v_credit, v_lines, v_wrong_date
  from public.ledger_lines l
  join public.ledger_entries e on e.tenant_id = l.tenant_id and e.id = l.entry_id
  where l.tenant_id = new.tenant_id and l.entry_id = v_entry;
  if v_lines < 2 or v_debit <> v_credit or v_debit = 0 or v_wrong_date > 0 then
    raise exception 'A ledger entry must balance: debits % and credits %', v_debit, v_credit
      using errcode = 'MB002';
  end if;
  return null;
end;
$$;
revoke all on function app.ledger_check_balanced() from public;

create constraint trigger ledger_entries_balanced after insert on "ledger_entries"
  deferrable initially deferred for each row execute function app.ledger_check_balanced();
create constraint trigger ledger_lines_balanced after insert on "ledger_lines"
  deferrable initially deferred for each row execute function app.ledger_check_balanced();

-- Posted entries are never edited: the only change ever made is linking the entry that reverses
-- it. Deleting stays possible for the platform owner's removal of a whole test business (ADR-056).
create function app.ledger_entries_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.reversed_by_entry_id is null and new.reversed_by_entry_id is not null
     and (to_jsonb(new) - 'reversed_by_entry_id') = (to_jsonb(old) - 'reversed_by_entry_id') then
    return new;
  end if;
  raise exception 'A posted ledger entry cannot be changed; reverse it instead'
    using errcode = 'MB002';
end;
$$;
create trigger ledger_entries_immutable before update on "ledger_entries"
  for each row execute function app.ledger_entries_immutable();

create function app.ledger_lines_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'A posted ledger line cannot be changed; reverse the entry instead'
    using errcode = 'MB002';
end;
$$;
create trigger ledger_lines_immutable before update on "ledger_lines"
  for each row execute function app.ledger_lines_immutable();

-- Accounts that posting relies on keep their identity, and an account's type cannot change once
-- money has been recorded against it (it would move history between reports).
create function app.ledger_accounts_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.system_key is distinct from old.system_key then
    raise exception 'A system account keeps its role' using errcode = 'MB002';
  end if;
  if new.archived_at is not null and old.archived_at is null then
    if old.system_key is not null then
      raise exception 'This account is needed by the books and cannot be archived'
        using errcode = 'MB002';
    end if;
    if exists (select 1 from public.ledger_settings s
               where s.tenant_id = old.tenant_id
                 and old.id in (s.receipts_account_id, s.invoice_income_account_id)) then
      raise exception 'This account is chosen in the books settings and cannot be archived'
        using errcode = 'MB002';
    end if;
  end if;
  if (new.type <> old.type or new.is_bank <> old.is_bank)
     and exists (select 1 from public.ledger_lines l
                 where l.tenant_id = old.tenant_id and l.account_id = old.id) then
    raise exception 'An account with transactions keeps its type' using errcode = 'MB002';
  end if;
  return new;
end;
$$;
create trigger ledger_accounts_guard before update on "ledger_accounts"
  for each row execute function app.ledger_accounts_guard();

create function app.ledger_tax_codes_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.system_key is distinct from old.system_key
     or (old.system_key is not null and new.archived_at is not null) then
    raise exception 'This tax code is needed by the books' using errcode = 'MB002';
  end if;
  return new;
end;
$$;
create trigger ledger_tax_codes_guard before update on "ledger_tax_codes"
  for each row execute function app.ledger_tax_codes_guard();

-- The settings choose a bank account to receive into and an income account to sell into.
create function app.ledger_settings_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.ledger_accounts a
                 where a.tenant_id = new.tenant_id and a.id = new.receipts_account_id
                   and a.is_bank and a.archived_at is null)
     or not exists (select 1 from public.ledger_accounts a
                    where a.tenant_id = new.tenant_id and a.id = new.invoice_income_account_id
                      and a.type = 'income' and a.archived_at is null) then
    raise exception 'Choose a bank account for receipts and an income account for invoices'
      using errcode = 'MB002';
  end if;
  return new;
end;
$$;
create trigger ledger_settings_guard before insert or update on "ledger_settings"
  for each row execute function app.ledger_settings_guard();

--> statement-breakpoint

-- The business's own date today.
create function app.ledger_today(p_tenant uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(t.timezone, 'UTC'))::date
  from public.tenants t where t.id = p_tenant;
$$;
revoke all on function app.ledger_today(uuid) from public;

-- An account the books rely on, found by its role.
create function app.ledger_system_account(p_tenant uuid, p_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_id uuid;
begin
  select a.id into v_id from public.ledger_accounts a
  where a.tenant_id = p_tenant and a.system_key = p_key;
  if v_id is null then
    raise exception 'The chart of accounts has no % account', p_key using errcode = 'MB003';
  end if;
  return v_id;
end;
$$;
revoke all on function app.ledger_system_account(uuid, text) from public;

create function app.ledger_system_tax_code(p_tenant uuid, p_key text) returns uuid
language sql stable security definer set search_path = '' as $$
  select c.id from public.ledger_tax_codes c where c.tenant_id = p_tenant and c.system_key = p_key;
$$;
revoke all on function app.ledger_system_tax_code(uuid, text) from public;

-- Writes one entry and its lines. Internal: every caller below checks who is asking first.
-- Lines are [{account_id, debit, credit, description, tax_code_id, tax_amount}] in that order.
create function app.ledger_insert_entry(
  p_tenant uuid, p_actor uuid, p_date date, p_kind text, p_description text,
  p_reference text, p_contact text, p_is_adjustment boolean,
  p_source_type text, p_source_id uuid, p_source_event text,
  p_payroll boolean, p_reverses uuid, p_lines jsonb, p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_lock date;
  v_currency char(3);
  v_number integer;
  v_entry uuid;
  v_line jsonb;
  v_position integer := 0;
  v_account uuid;
  v_tax_code uuid;
  v_debit numeric;
  v_credit numeric;
  v_tax numeric;
begin
  select s.lock_date into v_lock from public.ledger_settings s where s.tenant_id = p_tenant;
  if not found then
    raise exception 'The books are not set up yet' using errcode = 'MB003';
  end if;
  if p_date is null then
    raise exception 'A ledger entry needs a date' using errcode = 'MB002';
  end if;
  if v_lock is not null and p_date <= v_lock and not p_may_pass_lock then
    raise exception 'The books are locked up to %', to_char(v_lock, 'DD Mon YYYY')
      using errcode = 'MB001';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 2 and 200 then
    raise exception 'A ledger entry needs between 2 and 200 lines' using errcode = 'MB002';
  end if;

  select t.default_currency into v_currency from public.tenants t where t.id = p_tenant;
  perform pg_advisory_xact_lock(hashtext('ledger:' || p_tenant::text));
  select coalesce(max(e.number), 0) + 1 into v_number
  from public.ledger_entries e where e.tenant_id = p_tenant;

  insert into public.ledger_entries
    (tenant_id, number, date, kind, description, reference, contact_name, is_adjustment,
     source_type, source_id, source_event, payroll, currency, reverses_entry_id, created_by)
  values
    (p_tenant, v_number, p_date, p_kind, left(btrim(p_description), 300),
     nullif(btrim(coalesce(p_reference, '')), ''), nullif(btrim(coalesce(p_contact, '')), ''),
     coalesce(p_is_adjustment, false), p_source_type, p_source_id, p_source_event,
     coalesce(p_payroll, false), v_currency, p_reverses, p_actor)
  returning id into v_entry;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_account := (v_line ->> 'account_id')::uuid;
    v_tax_code := nullif(v_line ->> 'tax_code_id', '')::uuid;
    v_debit := coalesce(nullif(v_line ->> 'debit', '')::numeric, 0);
    v_credit := coalesce(nullif(v_line ->> 'credit', '')::numeric, 0);
    v_tax := nullif(v_line ->> 'tax_amount', '')::numeric;
    -- Cents only: a third decimal place would otherwise be rounded away silently.
    if v_debit <> round(v_debit, 2) or v_credit <> round(v_credit, 2)
       or (v_tax is not null and v_tax <> round(v_tax, 2)) then
      raise exception 'Amounts are in whole cents' using errcode = 'MB002';
    end if;
    if not exists (select 1 from public.ledger_accounts a
                   where a.tenant_id = p_tenant and a.id = v_account
                     and (a.archived_at is null or p_reverses is not null)) then
      raise exception 'That account is not in this business''s chart of accounts'
        using errcode = 'MB002';
    end if;
    if v_tax_code is not null and not exists (
      select 1 from public.ledger_tax_codes c where c.tenant_id = p_tenant and c.id = v_tax_code
    ) then
      raise exception 'That tax code is not one of this business''s' using errcode = 'MB002';
    end if;
    insert into public.ledger_lines
      (tenant_id, entry_id, account_id, date, debit, credit, description, tax_code_id,
       tax_amount, payroll, position)
    values
      (p_tenant, v_entry, v_account, p_date, v_debit, v_credit,
       nullif(left(btrim(coalesce(v_line ->> 'description', '')), 300), ''), v_tax_code, v_tax,
       coalesce(p_payroll, false), v_position);
    v_position := v_position + 1;
  end loop;
  -- Also checked at commit by the constraint triggers; here it fails at once, with the totals.
  select sum(l.debit), sum(l.credit) into v_debit, v_credit
  from public.ledger_lines l where l.tenant_id = p_tenant and l.entry_id = v_entry;
  if v_debit <> v_credit then
    raise exception 'A ledger entry must balance: debits % and credits %', v_debit, v_credit
      using errcode = 'MB002';
  end if;
  return v_entry;
end;
$$;
revoke all on function app.ledger_insert_entry(uuid, uuid, date, text, text, text, text, boolean,
  text, uuid, text, boolean, uuid, jsonb, boolean) from public;

-- Reverses an entry with its sides swapped. On the original date while that is still open,
-- otherwise today: a locked period is only ever corrected by a new entry after it.
create function app.ledger_reverse_internal(
  p_tenant uuid, p_actor uuid, p_entry uuid, p_description text, p_source_event text,
  p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.ledger_entries;
  v_lock date;
  v_date date;
  v_lines jsonb;
  v_reversal uuid;
begin
  select * into v_entry from public.ledger_entries e
  where e.tenant_id = p_tenant and e.id = p_entry for update;
  if not found then
    raise exception 'That entry was not found' using errcode = 'P0002';
  end if;
  if v_entry.reversed_by_entry_id is not null or v_entry.kind = 'reversal' then
    raise exception 'This entry has already been reversed' using errcode = 'MB002';
  end if;
  select s.lock_date into v_lock from public.ledger_settings s where s.tenant_id = p_tenant;
  v_date := case when v_lock is null or v_entry.date > v_lock then v_entry.date
                 else greatest(app.ledger_today(p_tenant), v_lock + 1) end;
  select jsonb_agg(jsonb_build_object(
           'account_id', l.account_id, 'debit', l.credit, 'credit', l.debit,
           'description', l.description, 'tax_code_id', l.tax_code_id, 'tax_amount', l.tax_amount)
         order by l.position)
  into v_lines
  from public.ledger_lines l where l.tenant_id = p_tenant and l.entry_id = p_entry;

  v_reversal := app.ledger_insert_entry(
    p_tenant, p_actor, v_date, 'reversal',
    coalesce(nullif(btrim(coalesce(p_description, '')), ''), 'Reverses ' || v_entry.description),
    v_entry.reference, v_entry.contact_name, false,
    v_entry.source_type, v_entry.source_id,
    case when v_entry.source_type is null then null else p_source_event end,
    v_entry.payroll, p_entry, v_lines, p_may_pass_lock);
  update public.ledger_entries set reversed_by_entry_id = v_reversal
  where tenant_id = p_tenant and id = p_entry;
  return v_reversal;
end;
$$;
revoke all on function app.ledger_reverse_internal(uuid, uuid, uuid, text, text, boolean)
  from public;

-- Who is asking, in which business. Refuses anyone who is not an active member of it.
create function app.ledger_caller() returns table (tenant uuid, actor uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid := app.active_tenant_id();
  v_user uuid := app.user_id();
begin
  if v_tenant is null or v_user is null or v_tenant not in (select app.tenant_ids()) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return query select v_tenant, v_user;
end;
$$;
revoke all on function app.ledger_caller() from public;

create function app.ledger_entry_permission(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind
    when 'money_in' then 'books.record'
    when 'money_out' then 'books.record'
    when 'transfer' then 'books.record'
    when 'journal' then 'books.journal'
    when 'opening_balance' then 'books.manage'
  end;
$$;
revoke all on function app.ledger_entry_permission(text) from public;

--> statement-breakpoint

-- Money in, money out, transfers, journals and opening balances entered in the books.
create function app.ledger_post_entry(
  p_kind text, p_date date, p_description text, p_reference text, p_contact text,
  p_is_adjustment boolean, p_lines jsonb
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_permission text := app.ledger_entry_permission(p_kind);
begin
  select c.tenant, c.actor into v_tenant, v_actor from app.ledger_caller() c;
  if v_permission is null then
    raise exception 'Entries of that kind are posted from their own document'
      using errcode = 'MB002';
  end if;
  if not app.has_permission(v_tenant, v_permission) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if coalesce(p_is_adjustment, false) and p_kind <> 'journal' then
    raise exception 'Only a journal can be an adjustment' using errcode = 'MB002';
  end if;
  if p_kind in ('money_in', 'money_out', 'transfer') and not exists (
    select 1 from jsonb_array_elements(p_lines) l
    join public.ledger_accounts a
      on a.tenant_id = v_tenant and a.id = (l.value ->> 'account_id')::uuid and a.is_bank
  ) then
    raise exception 'Money in, money out and transfers go through a bank account'
      using errcode = 'MB002';
  end if;
  return app.ledger_insert_entry(
    v_tenant, v_actor, p_date, p_kind, p_description, p_reference, p_contact,
    coalesce(p_is_adjustment, false), null, null, null, false, null, p_lines,
    app.has_permission(v_tenant, 'books.manage'));
end;
$$;
revoke all on function app.ledger_post_entry(text, date, text, text, text, boolean, jsonb)
  from public;
grant execute on function app.ledger_post_entry(text, date, text, text, text, boolean, jsonb)
  to authenticated;

-- Voids an entry made in the books by posting its reversal. Entries posted from an invoice or a
-- payslip are changed only through that document, so the two can never disagree.
create function app.ledger_void_entry(p_entry uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_kind text;
  v_permission text;
begin
  select c.tenant, c.actor into v_tenant, v_actor from app.ledger_caller() c;
  if not app.has_permission(v_tenant, 'books.view') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select e.kind into v_kind from public.ledger_entries e
  where e.tenant_id = v_tenant and e.id = p_entry and not e.payroll;
  if v_kind is null then
    raise exception 'That entry was not found' using errcode = 'P0002';
  end if;
  v_permission := app.ledger_entry_permission(v_kind);
  if v_permission is null then
    raise exception 'This entry came from an invoice or payslip; change it there'
      using errcode = 'MB002';
  end if;
  if not app.has_permission(v_tenant, v_permission) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  return app.ledger_reverse_internal(
    v_tenant, v_actor, p_entry, p_reason, null, app.has_permission(v_tenant, 'books.manage'));
end;
$$;
revoke all on function app.ledger_void_entry(uuid, text) from public;
grant execute on function app.ledger_void_entry(uuid, text) to authenticated;

--> statement-breakpoint

-- An invoice's effect on the books: issued (owed by the customer, income and GST), paid (money
-- in the bank) and voided (the issue reversed). Internal; the callers check permissions.
create function app.ledger_invoice_event(
  p_tenant uuid, p_actor uuid, p_invoice uuid, p_event text, p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.ledger_settings;
  v_invoice public.invoices;
  v_existing uuid;
  v_issued uuid;
  v_reference text;
  v_lines jsonb;
  v_paid date;
begin
  select * into v_settings from public.ledger_settings s where s.tenant_id = p_tenant;
  if not found then return null; end if;
  select * into v_invoice from public.invoices i where i.tenant_id = p_tenant and i.id = p_invoice;
  if not found then
    raise exception 'That invoice was not found' using errcode = 'P0002';
  end if;
  select e.id into v_existing from public.ledger_entries e
  where e.tenant_id = p_tenant and e.source_type = 'invoice' and e.source_id = p_invoice
    and e.source_event = p_event;
  if v_existing is not null then return v_existing; end if;
  v_reference := 'INV-' || lpad(v_invoice.number::text, 4, '0');

  if p_event = 'issued' then
    -- Before the books began, the amount owed is part of the opening balances.
    if v_invoice.status not in ('sent', 'paid') or v_invoice.total <= 0
       or v_invoice.issue_date < v_settings.start_date then
      return null;
    end if;
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', app.ledger_system_account(p_tenant, 'accounts_receivable'),
        'debit', v_invoice.total, 'description', 'Owed by ' || v_invoice.customer_name),
      jsonb_build_object(
        'account_id', v_settings.invoice_income_account_id, 'credit', v_invoice.subtotal,
        'description', 'Sales',
        'tax_code_id', app.ledger_system_tax_code(
          p_tenant, case when v_invoice.tax_rate > 0 then 'gst_on_income' else 'gst_free_income' end),
        'tax_amount', v_invoice.tax_total));
    if v_invoice.tax_total > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', app.ledger_system_account(p_tenant, 'gst'),
        'credit', v_invoice.tax_total, 'description', 'GST collected'));
    end if;
    return app.ledger_insert_entry(
      p_tenant, p_actor, v_invoice.issue_date, 'invoice', 'Invoice ' || v_reference,
      v_reference, v_invoice.customer_name, false, 'invoice', p_invoice, 'issued', false, null,
      v_lines, p_may_pass_lock);
  end if;

  if p_event = 'paid' then
    if v_invoice.status <> 'paid' or v_invoice.total <= 0 then return null; end if;
    v_paid := coalesce(
      (v_invoice.paid_at at time zone (select t.timezone from public.tenants t where t.id = p_tenant))::date,
      app.ledger_today(p_tenant));
    if v_paid < v_settings.start_date then return null; end if;
    perform app.ledger_invoice_event(p_tenant, p_actor, p_invoice, 'issued', p_may_pass_lock);
    v_lines := jsonb_build_array(
      jsonb_build_object('account_id', v_settings.receipts_account_id, 'debit', v_invoice.total,
                         'description', 'Payment from ' || v_invoice.customer_name),
      jsonb_build_object(
        'account_id', app.ledger_system_account(p_tenant, 'accounts_receivable'),
        'credit', v_invoice.total, 'description', 'Paid by ' || v_invoice.customer_name));
    return app.ledger_insert_entry(
      p_tenant, p_actor, v_paid, 'invoice_payment', 'Payment for invoice ' || v_reference,
      v_reference, v_invoice.customer_name, false, 'invoice', p_invoice, 'paid', false, null,
      v_lines, p_may_pass_lock);
  end if;

  if p_event = 'voided' then
    select e.id into v_issued from public.ledger_entries e
    where e.tenant_id = p_tenant and e.source_type = 'invoice' and e.source_id = p_invoice
      and e.source_event = 'issued' and e.reversed_by_entry_id is null;
    if v_issued is null then return null; end if;
    if exists (select 1 from public.ledger_entries e
               where e.tenant_id = p_tenant and e.source_type = 'invoice'
                 and e.source_id = p_invoice and e.source_event = 'paid'
                 and e.reversed_by_entry_id is null) then
      raise exception 'A paid invoice cannot be voided' using errcode = 'MB002';
    end if;
    return app.ledger_reverse_internal(
      p_tenant, p_actor, v_issued, 'Invoice ' || v_reference || ' voided', 'voided',
      p_may_pass_lock);
  end if;

  raise exception 'Unknown invoice event' using errcode = 'MB002';
end;
$$;
revoke all on function app.ledger_invoice_event(uuid, uuid, uuid, text, boolean) from public;

-- Whether the caller could post on this date now: true while the books are off or not set up,
-- after the lock date, or for whoever may post inside a locked period. Lets a document check
-- before doing something that cannot be taken back, such as emailing an invoice.
create function app.ledger_open_for(p_date date) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_lock date;
begin
  select c.tenant, c.actor into v_tenant, v_actor from app.ledger_caller() c;
  if not app.feature_enabled(v_tenant, 'books') then return true; end if;
  select s.lock_date into v_lock from public.ledger_settings s where s.tenant_id = v_tenant;
  return v_lock is null or p_date > v_lock or app.has_permission(v_tenant, 'books.manage');
end;
$$;
revoke all on function app.ledger_open_for(date) from public;
grant execute on function app.ledger_open_for(date) to authenticated;

-- Called by the invoices module in the same transaction as the status change, so an invoice and
-- its entries never disagree. Does nothing while the books are switched off or not set up.
create function app.ledger_post_invoice(p_invoice uuid, p_event text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid;
begin
  select c.tenant, c.actor into v_tenant, v_actor from app.ledger_caller() c;
  if not app.has_permission(v_tenant, 'invoices.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not app.feature_enabled(v_tenant, 'books') then return null; end if;
  return app.ledger_invoice_event(
    v_tenant, v_actor, p_invoice, p_event, app.has_permission(v_tenant, 'books.manage'));
end;
$$;
revoke all on function app.ledger_post_invoice(uuid, text) from public;
grant execute on function app.ledger_post_invoice(uuid, text) to authenticated;

-- A released payslip: wages and super as expenses, and what is now owed to the employee, the
-- tax office (PAYG withheld) and the super fund. Internal.
create function app.ledger_payslip_released(
  p_tenant uuid, p_actor uuid, p_payslip uuid, p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.ledger_settings;
  v_payslip public.payslips;
  v_existing uuid;
  v_lines jsonb;
  v_period text;
begin
  select * into v_settings from public.ledger_settings s where s.tenant_id = p_tenant;
  if not found then return null; end if;
  select * into v_payslip from public.payslips p
  where p.tenant_id = p_tenant and p.id = p_payslip and p.status = 'released';
  if not found or v_payslip.gross <= 0 or v_payslip.payment_date < v_settings.start_date then
    return null;
  end if;
  select e.id into v_existing from public.ledger_entries e
  where e.tenant_id = p_tenant and e.source_type = 'payslip' and e.source_id = p_payslip
    and e.source_event = 'released';
  if v_existing is not null then return v_existing; end if;

  v_lines := jsonb_build_array(jsonb_build_object(
    'account_id', app.ledger_system_account(p_tenant, 'wages_expense'),
    'debit', v_payslip.gross, 'description', 'Gross wages'));
  if v_payslip.super_amount > 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', app.ledger_system_account(p_tenant, 'super_expense'),
                         'debit', v_payslip.super_amount, 'description', 'Superannuation'),
      jsonb_build_object('account_id', app.ledger_system_account(p_tenant, 'super_payable'),
                         'credit', v_payslip.super_amount, 'description', 'Super owed to the fund'));
  end if;
  if v_payslip.tax_withheld > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', app.ledger_system_account(p_tenant, 'payg_withholding'),
      'credit', v_payslip.tax_withheld, 'description', 'PAYG withheld'));
  end if;
  if v_payslip.net > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', app.ledger_system_account(p_tenant, 'wages_payable'),
      'credit', v_payslip.net, 'description', 'Net pay owed'));
  end if;
  v_period := to_char(v_payslip.period_start, 'DD Mon') || ' – '
              || to_char(v_payslip.period_end, 'DD Mon YYYY');
  return app.ledger_insert_entry(
    p_tenant, p_actor, v_payslip.payment_date, 'payslip',
    'Pay for ' || v_payslip.employee_name || ', ' || v_period, null, v_payslip.employee_name,
    false, 'payslip', p_payslip, 'released', true, null, v_lines, p_may_pass_lock);
end;
$$;
revoke all on function app.ledger_payslip_released(uuid, uuid, uuid, boolean) from public;

create function app.ledger_post_payslip(p_payslip uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid;
begin
  select c.tenant, c.actor into v_tenant, v_actor from app.ledger_caller() c;
  if not app.has_permission(v_tenant, 'payroll.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not app.feature_enabled(v_tenant, 'books') then return null; end if;
  return app.ledger_payslip_released(
    v_tenant, v_actor, p_payslip, app.has_permission(v_tenant, 'books.manage'));
end;
$$;
revoke all on function app.ledger_post_payslip(uuid) from public;
grant execute on function app.ledger_post_payslip(uuid) to authenticated;

-- Net pay leaving the bank for a released payslip.
create function app.ledger_pay_payslip(p_payslip uuid, p_account uuid, p_date date) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_payslip public.payslips;
begin
  select c.tenant, c.actor into v_tenant, v_actor from app.ledger_caller() c;
  if not app.has_permission(v_tenant, 'books.record')
     or not app.has_permission(v_tenant, 'books.view_payroll') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.ledger_entries e
                 where e.tenant_id = v_tenant and e.source_type = 'payslip'
                   and e.source_id = p_payslip and e.source_event = 'released') then
    raise exception 'That payslip is not in the books' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.ledger_entries e
             where e.tenant_id = v_tenant and e.source_type = 'payslip'
               and e.source_id = p_payslip and e.source_event = 'paid') then
    raise exception 'This payslip has already been paid' using errcode = 'MB002';
  end if;
  select * into v_payslip from public.payslips p where p.tenant_id = v_tenant and p.id = p_payslip;
  if v_payslip.net <= 0 then
    raise exception 'There is no net pay to record' using errcode = 'MB002';
  end if;
  if not exists (select 1 from public.ledger_accounts a
                 where a.tenant_id = v_tenant and a.id = p_account and a.is_bank
                   and a.archived_at is null) then
    raise exception 'Choose a bank account' using errcode = 'MB002';
  end if;
  return app.ledger_insert_entry(
    v_tenant, v_actor, p_date, 'payslip_payment',
    'Net pay to ' || v_payslip.employee_name, null, v_payslip.employee_name, false,
    'payslip', p_payslip, 'paid', true, null,
    jsonb_build_array(
      jsonb_build_object('account_id', app.ledger_system_account(v_tenant, 'wages_payable'),
                         'debit', v_payslip.net, 'description', 'Net pay'),
      jsonb_build_object('account_id', p_account, 'credit', v_payslip.net,
                         'description', 'Net pay')),
    app.has_permission(v_tenant, 'books.manage'));
end;
$$;
revoke all on function app.ledger_pay_payslip(uuid, uuid, date) from public;
grant execute on function app.ledger_pay_payslip(uuid, uuid, date) to authenticated;

-- After setting up, brings in invoices and released payslips from the start date on, in date
-- order, so the books begin complete. Safe to run again: nothing is posted twice.
create function app.ledger_catch_up() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_start date;
  v_before integer;
  v_after integer;
  v_row record;
begin
  select c.tenant, c.actor into v_tenant, v_actor from app.ledger_caller() c;
  if not app.has_permission(v_tenant, 'books.manage') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  select s.start_date into v_start from public.ledger_settings s where s.tenant_id = v_tenant;
  if v_start is null then
    raise exception 'The books are not set up yet' using errcode = 'MB003';
  end if;
  select count(*) into v_before from public.ledger_entries e where e.tenant_id = v_tenant;
  if app.feature_enabled(v_tenant, 'invoices') then
    for v_row in
      select i.id, i.status from public.invoices i
      where i.tenant_id = v_tenant and i.status in ('sent', 'paid')
      order by i.issue_date, i.number
    loop
      perform app.ledger_invoice_event(v_tenant, v_actor, v_row.id, 'issued', true);
      if v_row.status = 'paid' then
        perform app.ledger_invoice_event(v_tenant, v_actor, v_row.id, 'paid', true);
      end if;
    end loop;
  end if;
  if app.feature_enabled(v_tenant, 'payroll') then
    for v_row in
      select p.id from public.payslips p
      where p.tenant_id = v_tenant and p.status = 'released'
      order by p.payment_date, p.id
    loop
      perform app.ledger_payslip_released(v_tenant, v_actor, v_row.id, true);
    end loop;
  end if;
  -- Entries already in the books are found, not posted again, so count what is new.
  select count(*) into v_after from public.ledger_entries e where e.tenant_id = v_tenant;
  return v_after - v_before;
end;
$$;
revoke all on function app.ledger_catch_up() from public;
grant execute on function app.ledger_catch_up() to authenticated;

--> statement-breakpoint

alter table "ledger_tax_codes" enable row level security;
alter table "ledger_accounts" enable row level security;
alter table "ledger_settings" enable row level security;
alter table "ledger_entries" enable row level security;
alter table "ledger_lines" enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ledger_tax_codes', 'ledger_accounts', 'ledger_settings'] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
         and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_read', t, 'books.view');
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
         and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_insert', t, 'books.manage');
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (
           tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
           and (select app.has_permission((select app.active_tenant_id()), %L)))
         with check (
           tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
           and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_update', t, 'books.manage', 'books.manage');
  end loop;
end;
$$;

-- Entries and lines are read only. Pay is visible only to those allowed to see it.
create policy ledger_entries_read on "ledger_entries" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'books.view'))
    and (not payroll
         or (select app.has_permission((select app.active_tenant_id()), 'books.view_payroll')))
  );
create policy ledger_lines_read on "ledger_lines" for select to authenticated
  using (
    tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
    and (select app.has_permission((select app.active_tenant_id()), 'books.view'))
    and (not payroll
         or (select app.has_permission((select app.active_tenant_id()), 'books.view_payroll')))
  );

-- Owned by one feature: hidden entirely while it is switched off (ADR-038).
do $$
declare t text;
begin
  foreach t in array array['ledger_tax_codes', 'ledger_accounts', 'ledger_settings',
    'ledger_entries', 'ledger_lines']
  loop
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'books', 'books'
    );
  end loop;
end;
$$;

grant select, insert, update on "ledger_tax_codes" to authenticated;
grant select, insert, update on "ledger_accounts" to authenticated;
grant select, insert, update on "ledger_settings" to authenticated;
grant select on "ledger_entries" to authenticated;
grant select on "ledger_lines" to authenticated;

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
    when 'books' then 'books'
    else null
  end;
$$;

--> statement-breakpoint

-- Existing businesses' Admin role gets the same grants a new business's does. The books stay off
-- until the platform owner switches the feature on for a business (ADR-029).
insert into public.role_permissions (tenant_id, role_id, permission, scope)
select r.tenant_id, r.id, p.permission, null
from public.roles r
cross join (values ('books.view'), ('books.view_payroll'), ('books.record'), ('books.journal'),
                   ('books.export'), ('books.manage')) as p(permission)
where r.key = 'owner'
on conflict (role_id, permission) do nothing;
