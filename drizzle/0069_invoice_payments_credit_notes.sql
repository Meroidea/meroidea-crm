CREATE TABLE "invoice_credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"invoice_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "invoice_credit_notes_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_credit_notes_number_key" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
CREATE TABLE "invoice_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "invoice_payment_allocations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_payment_allocations_pair_key" UNIQUE("tenant_id","payment_id","invoice_id")
);
--> statement-breakpoint
CREATE TABLE "invoice_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"payer_name" text,
	"reference" text,
	"account_id" uuid,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "invoice_payments_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
ALTER TABLE "invoice_credit_notes" ADD CONSTRAINT "invoice_credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_credit_notes" ADD CONSTRAINT "invoice_credit_notes_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_allocations" ADD CONSTRAINT "invoice_payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_allocations" ADD CONSTRAINT "invoice_payment_allocations_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."invoice_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payment_allocations" ADD CONSTRAINT "invoice_payment_allocations_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_payments" ADD CONSTRAINT "invoice_payments_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_credit_notes_invoice_idx" ON "invoice_credit_notes" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payment_allocations_invoice_idx" ON "invoice_payment_allocations" USING btree ("tenant_id","invoice_id");--> statement-breakpoint
CREATE INDEX "invoice_payments_date_idx" ON "invoice_payments" USING btree ("tenant_id","date");--> statement-breakpoint
-- Invoice payments and credit notes (ADR-061): rules, who may read and write, posting to the
-- books, and a payment on record for every invoice already marked paid. docs/database.md §7e.
alter table "invoice_payments" add constraint invoice_payments_amount_positive check (amount > 0);
alter table "invoice_payments" add constraint invoice_payments_currency_format
  check (currency ~ '^[A-Z]{3}$');
alter table "invoice_payments" add constraint invoice_payments_text_length
  check ((payer_name is null or char_length(payer_name) <= 160)
     and (reference is null or char_length(reference) <= 100));
alter table "invoice_payment_allocations" add constraint invoice_payment_allocations_positive
  check (amount > 0);
alter table "invoice_credit_notes" add constraint invoice_credit_notes_amounts
  check (subtotal >= 0 and tax_total >= 0 and total > 0 and total = subtotal + tax_total);
alter table "invoice_credit_notes" add constraint invoice_credit_notes_reason_length
  check (char_length(reason) between 2 and 300);
alter table "invoice_credit_notes" add constraint invoice_credit_notes_number_positive
  check (number > 0);
alter table "invoice_credit_notes" add constraint invoice_credit_notes_currency_format
  check (currency ~ '^[A-Z]{3}$');

--> statement-breakpoint

-- What is still owed on an invoice: its total less live payments and live credit notes.
create function app.invoice_balance(p_tenant uuid, p_invoice uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select i.total
    - coalesce((select sum(a.amount) from public.invoice_payment_allocations a
                join public.invoice_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
                where a.tenant_id = i.tenant_id and a.invoice_id = i.id and p.voided_at is null), 0)
    - coalesce((select sum(c.total) from public.invoice_credit_notes c
                where c.tenant_id = i.tenant_id and c.invoice_id = i.id and c.voided_at is null), 0)
  from public.invoices i where i.tenant_id = p_tenant and i.id = p_invoice;
$$;
revoke all on function app.invoice_balance(uuid, uuid) from public;
grant execute on function app.invoice_balance(uuid, uuid) to authenticated;

-- Checked when the transaction commits: nothing is paid or credited on a draft or void invoice,
-- no invoice is paid or credited beyond its total, and a payment is split exactly across its
-- invoices. Whoever writes, the money always adds up.
create function app.invoice_money_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(new);
  v_tenant uuid := (v_row ->> 'tenant_id')::uuid;
  v_invoice uuid := (v_row ->> 'invoice_id')::uuid;
  v_payment uuid := case when tg_table_name = 'invoice_payments' then (v_row ->> 'id')::uuid
                         else (v_row ->> 'payment_id')::uuid end;
  v_status text;
  v_allocated numeric;
  v_amount numeric;
begin
  if v_invoice is not null then
    select i.status::text into v_status from public.invoices i
    where i.tenant_id = v_tenant and i.id = v_invoice;
    if v_status not in ('sent', 'paid') then
      raise exception 'Only a sent invoice can be paid or credited' using errcode = 'MB002';
    end if;
    if app.invoice_balance(v_tenant, v_invoice) < 0 then
      raise exception 'That is more than is owed on the invoice' using errcode = 'MB002';
    end if;
  end if;
  if v_payment is not null then
    select p.amount into v_amount from public.invoice_payments p
    where p.tenant_id = v_tenant and p.id = v_payment;
    select coalesce(sum(a.amount), 0) into v_allocated from public.invoice_payment_allocations a
    where a.tenant_id = v_tenant and a.payment_id = v_payment;
    if v_amount is distinct from v_allocated then
      raise exception 'A payment must be split exactly across its invoices' using errcode = 'MB002';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function app.invoice_money_check() from public;
create constraint trigger invoice_payments_add_up after insert on "invoice_payments"
  deferrable initially deferred for each row execute function app.invoice_money_check();
create constraint trigger invoice_payment_allocations_add_up after insert on "invoice_payment_allocations"
  deferrable initially deferred for each row execute function app.invoice_money_check();
create constraint trigger invoice_credit_notes_add_up after insert on "invoice_credit_notes"
  deferrable initially deferred for each row execute function app.invoice_money_check();

-- A payment or credit note is voided once and never un-voided; nothing else about it changes.
create function app.invoice_money_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.voided_at is null and new.voided_at is not null
     and (to_jsonb(new) - 'voided_at' - 'voided_by') = (to_jsonb(old) - 'voided_at' - 'voided_by') then
    return new;
  end if;
  raise exception 'A recorded payment or credit note cannot be changed; void it instead'
    using errcode = 'MB002';
end;
$$;
create trigger invoice_payments_immutable before update on "invoice_payments"
  for each row execute function app.invoice_money_immutable();
create trigger invoice_credit_notes_immutable before update on "invoice_credit_notes"
  for each row execute function app.invoice_money_immutable();

--> statement-breakpoint

alter table "invoice_payments" enable row level security;
alter table "invoice_payment_allocations" enable row level security;
alter table "invoice_credit_notes" enable row level security;

do $$
declare t text;
begin
  foreach t in array array['invoice_payments', 'invoice_payment_allocations', 'invoice_credit_notes']
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (
           tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
           and (select app.has_permission((select app.active_tenant_id()), %L)))
         with check (
           tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
           and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_manage', t, 'invoices.manage', 'invoices.manage');
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'invoices', 'invoices');
  end loop;
end;
$$;

grant select, insert on "invoice_payments" to authenticated;
grant update (voided_at, voided_by) on "invoice_payments" to authenticated;
grant select, insert on "invoice_payment_allocations" to authenticated;
grant select, insert on "invoice_credit_notes" to authenticated;
grant update (voided_at, voided_by) on "invoice_credit_notes" to authenticated;

--> statement-breakpoint

alter table "ledger_entries" drop constraint ledger_entries_source_complete;
alter table "ledger_entries" add constraint ledger_entries_source_complete
  check (
    (source_type is null and source_id is null and source_event is null)
    or (source_type in ('invoice', 'invoice_payment', 'credit_note', 'payslip')
        and source_id is not null and source_event is not null)
  );
alter table "ledger_entries" drop constraint ledger_entries_kind_known;
alter table "ledger_entries" add constraint ledger_entries_kind_known
  check (kind in ('money_in', 'money_out', 'transfer', 'journal', 'opening_balance', 'invoice',
                  'invoice_payment', 'credit_note', 'payslip', 'payslip_payment', 'reversal'));

-- An invoice now posts only its issue and, when voided, the issue's reversal. Payments and credit
-- notes post themselves. Voiding is refused while a live payment or credit note is on it.
create or replace function app.ledger_invoice_event(
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

  if p_event = 'voided' then
    if exists (select 1 from public.invoice_payment_allocations a
               join public.invoice_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
               where a.tenant_id = p_tenant and a.invoice_id = p_invoice and p.voided_at is null)
       or exists (select 1 from public.invoice_credit_notes c
                  where c.tenant_id = p_tenant and c.invoice_id = p_invoice and c.voided_at is null) then
      raise exception 'Void the payments and credit notes on this invoice first'
        using errcode = 'MB002';
    end if;
    select e.id into v_issued from public.ledger_entries e
    where e.tenant_id = p_tenant and e.source_type = 'invoice' and e.source_id = p_invoice
      and e.source_event = 'issued' and e.reversed_by_entry_id is null;
    if v_issued is null then return null; end if;
    return app.ledger_reverse_internal(
      p_tenant, p_actor, v_issued, 'Invoice ' || v_reference || ' voided', 'voided',
      p_may_pass_lock);
  end if;

  -- "paid" is now a payment of its own (app.ledger_payment_event).
  if p_event = 'paid' then return null; end if;
  raise exception 'Unknown invoice event' using errcode = 'MB002';
end;
$$;

-- A customer payment: the bank up, receivables down. Before the books began it is part of the
-- opening balances. The invoices it pays are brought in first if they are not in the books yet.
create function app.ledger_payment_event(
  p_tenant uuid, p_actor uuid, p_payment uuid, p_event text, p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.ledger_settings;
  v_payment public.invoice_payments;
  v_existing uuid;
  v_account uuid;
  v_invoice uuid;
  v_label text;
begin
  select * into v_settings from public.ledger_settings s where s.tenant_id = p_tenant;
  if not found then return null; end if;
  select * into v_payment from public.invoice_payments p
  where p.tenant_id = p_tenant and p.id = p_payment;
  if not found then
    raise exception 'That payment was not found' using errcode = 'P0002';
  end if;
  select e.id into v_existing from public.ledger_entries e
  where e.tenant_id = p_tenant and e.source_type = 'invoice_payment' and e.source_id = p_payment
    and e.source_event = p_event;
  if v_existing is not null then return v_existing; end if;

  if p_event = 'received' then
    if v_payment.voided_at is not null or v_payment.date < v_settings.start_date then
      return null;
    end if;
    for v_invoice in
      select a.invoice_id from public.invoice_payment_allocations a
      where a.tenant_id = p_tenant and a.payment_id = p_payment
    loop
      perform app.ledger_invoice_event(p_tenant, p_actor, v_invoice, 'issued', p_may_pass_lock);
    end loop;
    v_account := coalesce(v_payment.account_id, v_settings.receipts_account_id);
    if not exists (select 1 from public.ledger_accounts a
                   where a.tenant_id = p_tenant and a.id = v_account and a.is_bank) then
      raise exception 'Payments go into a bank account' using errcode = 'MB002';
    end if;
    select string_agg('INV-' || lpad(i.number::text, 4, '0'), ', ' order by i.number)
    into v_label
    from public.invoice_payment_allocations a
    join public.invoices i on i.tenant_id = a.tenant_id and i.id = a.invoice_id
    where a.tenant_id = p_tenant and a.payment_id = p_payment;
    return app.ledger_insert_entry(
      p_tenant, p_actor, v_payment.date, 'invoice_payment', 'Payment for ' || v_label,
      v_payment.reference, v_payment.payer_name, false, 'invoice_payment', p_payment, 'received',
      false, null,
      jsonb_build_array(
        jsonb_build_object('account_id', v_account, 'debit', v_payment.amount,
                           'description', 'Payment received'),
        jsonb_build_object('account_id', app.ledger_system_account(p_tenant, 'accounts_receivable'),
                           'credit', v_payment.amount, 'description', 'Paid: ' || v_label)),
      p_may_pass_lock);
  end if;

  if p_event = 'voided' then
    select e.id into v_existing from public.ledger_entries e
    where e.tenant_id = p_tenant and e.source_type = 'invoice_payment' and e.source_id = p_payment
      and e.source_event = 'received' and e.reversed_by_entry_id is null;
    if v_existing is null then return null; end if;
    return app.ledger_reverse_internal(
      p_tenant, p_actor, v_existing, 'Payment voided', 'voided', p_may_pass_lock);
  end if;
  raise exception 'Unknown payment event' using errcode = 'MB002';
end;
$$;
revoke all on function app.ledger_payment_event(uuid, uuid, uuid, text, boolean) from public;

-- A credit note: income and GST back down, and the customer owes that much less.
create function app.ledger_credit_note_event(
  p_tenant uuid, p_actor uuid, p_credit uuid, p_event text, p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.ledger_settings;
  v_credit public.invoice_credit_notes;
  v_rate numeric;
  v_existing uuid;
  v_reference text;
  v_lines jsonb;
begin
  select * into v_settings from public.ledger_settings s where s.tenant_id = p_tenant;
  if not found then return null; end if;
  select * into v_credit from public.invoice_credit_notes c
  where c.tenant_id = p_tenant and c.id = p_credit;
  if not found then
    raise exception 'That credit note was not found' using errcode = 'P0002';
  end if;
  select e.id into v_existing from public.ledger_entries e
  where e.tenant_id = p_tenant and e.source_type = 'credit_note' and e.source_id = p_credit
    and e.source_event = p_event;
  if v_existing is not null then return v_existing; end if;
  v_reference := 'CN-' || lpad(v_credit.number::text, 4, '0');

  if p_event = 'issued' then
    if v_credit.voided_at is not null or v_credit.date < v_settings.start_date then
      return null;
    end if;
    perform app.ledger_invoice_event(p_tenant, p_actor, v_credit.invoice_id, 'issued',
                                     p_may_pass_lock);
    select i.tax_rate into v_rate from public.invoices i
    where i.tenant_id = p_tenant and i.id = v_credit.invoice_id;
    v_lines := jsonb_build_array(
      jsonb_build_object(
        'account_id', v_settings.invoice_income_account_id, 'debit', v_credit.subtotal,
        'description', 'Credit: ' || v_credit.reason,
        'tax_code_id', app.ledger_system_tax_code(
          p_tenant, case when v_rate > 0 then 'gst_on_income' else 'gst_free_income' end),
        'tax_amount', v_credit.tax_total));
    if v_credit.tax_total > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', app.ledger_system_account(p_tenant, 'gst'),
        'debit', v_credit.tax_total, 'description', 'GST credited'));
    end if;
    -- A credit of only GST-free nothing still moves receivables, so the income line may be zero.
    v_lines := (select coalesce(jsonb_agg(l), '[]'::jsonb) from jsonb_array_elements(v_lines) l
                where (l ->> 'debit')::numeric > 0);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', app.ledger_system_account(p_tenant, 'accounts_receivable'),
      'credit', v_credit.total, 'description', 'Credit to the customer'));
    return app.ledger_insert_entry(
      p_tenant, p_actor, v_credit.date, 'credit_note', 'Credit note ' || v_reference,
      v_reference, null, false, 'credit_note', p_credit, 'issued', false, null, v_lines,
      p_may_pass_lock);
  end if;

  if p_event = 'voided' then
    select e.id into v_existing from public.ledger_entries e
    where e.tenant_id = p_tenant and e.source_type = 'credit_note' and e.source_id = p_credit
      and e.source_event = 'issued' and e.reversed_by_entry_id is null;
    if v_existing is null then return null; end if;
    return app.ledger_reverse_internal(
      p_tenant, p_actor, v_existing, 'Credit note ' || v_reference || ' voided', 'voided',
      p_may_pass_lock);
  end if;
  raise exception 'Unknown credit note event' using errcode = 'MB002';
end;
$$;
revoke all on function app.ledger_credit_note_event(uuid, uuid, uuid, text, boolean) from public;

create function app.ledger_post_invoice_payment(p_payment uuid, p_event text) returns uuid
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
  return app.ledger_payment_event(
    v_tenant, v_actor, p_payment, p_event, app.has_permission(v_tenant, 'books.manage'));
end;
$$;
revoke all on function app.ledger_post_invoice_payment(uuid, text) from public;
grant execute on function app.ledger_post_invoice_payment(uuid, text) to authenticated;

create function app.ledger_post_credit_note(p_credit uuid, p_event text) returns uuid
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
  return app.ledger_credit_note_event(
    v_tenant, v_actor, p_credit, p_event, app.has_permission(v_tenant, 'books.manage'));
end;
$$;
revoke all on function app.ledger_post_credit_note(uuid, text) from public;
grant execute on function app.ledger_post_credit_note(uuid, text) to authenticated;

-- Catching up now brings in invoices, then their payments and credit notes, then payslips.
create or replace function app.ledger_catch_up() returns integer
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
      select i.id from public.invoices i
      where i.tenant_id = v_tenant and i.status in ('sent', 'paid')
      order by i.issue_date, i.number
    loop
      perform app.ledger_invoice_event(v_tenant, v_actor, v_row.id, 'issued', true);
    end loop;
    for v_row in
      select p.id from public.invoice_payments p
      where p.tenant_id = v_tenant and p.voided_at is null order by p.date, p.created_at
    loop
      perform app.ledger_payment_event(v_tenant, v_actor, v_row.id, 'received', true);
    end loop;
    for v_row in
      select c.id from public.invoice_credit_notes c
      where c.tenant_id = v_tenant and c.voided_at is null order by c.date, c.number
    loop
      perform app.ledger_credit_note_event(v_tenant, v_actor, v_row.id, 'issued', true);
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
  select count(*) into v_after from public.ledger_entries e where e.tenant_id = v_tenant;
  return v_after - v_before;
end;
$$;

--> statement-breakpoint

-- Every invoice already marked paid gets the payment it stood for, dated the day it was marked,
-- so what is owed stays the same after this change.
do $$
declare
  v_invoice record;
  v_payment uuid;
begin
  for v_invoice in
    select i.tenant_id, i.id, i.total, i.currency, i.customer_name,
           coalesce(i.paid_at, i.updated_at) as paid_at, coalesce(t.timezone, 'UTC') as zone
    from public.invoices i
    join public.tenants t on t.id = i.tenant_id
    where i.status = 'paid' and i.total > 0
      and not exists (select 1 from public.invoice_payment_allocations a
                      where a.tenant_id = i.tenant_id and a.invoice_id = i.id)
  loop
    insert into public.invoice_payments
      (tenant_id, date, amount, currency, payer_name, created_at)
    values
      (v_invoice.tenant_id, (v_invoice.paid_at at time zone v_invoice.zone)::date,
       v_invoice.total, v_invoice.currency, v_invoice.customer_name, v_invoice.paid_at)
    returning id into v_payment;
    insert into public.invoice_payment_allocations (tenant_id, payment_id, invoice_id, amount)
    values (v_invoice.tenant_id, v_payment, v_invoice.id, v_invoice.total);
  end loop;
end;
$$;
