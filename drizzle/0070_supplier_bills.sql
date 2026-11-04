CREATE TABLE "ledger_bill_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"date" date NOT NULL,
	"reason" text NOT NULL,
	"supplier_reference" text,
	"account_id" uuid NOT NULL,
	"tax_code_id" uuid,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ledger_bill_credits_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ledger_bill_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"description" text,
	"amount" numeric(14, 2) NOT NULL,
	"tax_code_id" uuid,
	"tax_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ledger_bill_lines_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ledger_bill_payment_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	CONSTRAINT "ledger_bill_payment_allocations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_bill_payment_allocations_pair_key" UNIQUE("tenant_id","payment_id","bill_id")
);
--> statement-breakpoint
CREATE TABLE "ledger_bill_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"account_id" uuid NOT NULL,
	"payee_name" text,
	"reference" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ledger_bill_payments_tenant_id_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "ledger_bills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"supplier_name" text NOT NULL,
	"supplier_reference" text,
	"date" date NOT NULL,
	"due_date" date NOT NULL,
	"amounts_are" text NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"notes" text,
	"voided_at" timestamp with time zone,
	"voided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "ledger_bills_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "ledger_bills_number_key" UNIQUE("tenant_id","number")
);
--> statement-breakpoint
ALTER TABLE "ledger_bill_credits" ADD CONSTRAINT "ledger_bill_credits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_credits" ADD CONSTRAINT "ledger_bill_credits_bill_fk" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."ledger_bills"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_credits" ADD CONSTRAINT "ledger_bill_credits_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_credits" ADD CONSTRAINT "ledger_bill_credits_tax_code_fk" FOREIGN KEY ("tenant_id","tax_code_id") REFERENCES "public"."ledger_tax_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_lines" ADD CONSTRAINT "ledger_bill_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_lines" ADD CONSTRAINT "ledger_bill_lines_bill_fk" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."ledger_bills"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_lines" ADD CONSTRAINT "ledger_bill_lines_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_lines" ADD CONSTRAINT "ledger_bill_lines_tax_code_fk" FOREIGN KEY ("tenant_id","tax_code_id") REFERENCES "public"."ledger_tax_codes"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_payment_allocations" ADD CONSTRAINT "ledger_bill_payment_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_payment_allocations" ADD CONSTRAINT "ledger_bill_payment_allocations_payment_fk" FOREIGN KEY ("tenant_id","payment_id") REFERENCES "public"."ledger_bill_payments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_payment_allocations" ADD CONSTRAINT "ledger_bill_payment_allocations_bill_fk" FOREIGN KEY ("tenant_id","bill_id") REFERENCES "public"."ledger_bills"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_payments" ADD CONSTRAINT "ledger_bill_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bill_payments" ADD CONSTRAINT "ledger_bill_payments_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."ledger_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_bills" ADD CONSTRAINT "ledger_bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_bill_credits_bill_idx" ON "ledger_bill_credits" USING btree ("tenant_id","bill_id");--> statement-breakpoint
CREATE INDEX "ledger_bill_lines_bill_idx" ON "ledger_bill_lines" USING btree ("tenant_id","bill_id");--> statement-breakpoint
CREATE INDEX "ledger_bill_payment_allocations_bill_idx" ON "ledger_bill_payment_allocations" USING btree ("tenant_id","bill_id");--> statement-breakpoint
CREATE INDEX "ledger_bills_due_idx" ON "ledger_bills" USING btree ("tenant_id","due_date");--> statement-breakpoint
CREATE INDEX "ledger_bills_supplier_idx" ON "ledger_bills" USING btree ("tenant_id","supplier_name");--> statement-breakpoint
-- Supplier bills (ADR-062): rules, who may read and write, and posting to the books.
-- docs/database.md §7p.
alter table "ledger_bills" add constraint ledger_bills_amounts_known
  check (amounts_are in ('inclusive', 'exclusive', 'no_tax'));
alter table "ledger_bills" add constraint ledger_bills_totals
  check (subtotal >= 0 and tax_total >= 0 and total > 0 and total = subtotal + tax_total);
alter table "ledger_bills" add constraint ledger_bills_dates check (due_date >= date);
alter table "ledger_bills" add constraint ledger_bills_number_positive check (number > 0);
alter table "ledger_bills" add constraint ledger_bills_currency_format check (currency ~ '^[A-Z]{3}$');
alter table "ledger_bills" add constraint ledger_bills_text_length
  check (char_length(supplier_name) between 1 and 160
     and (supplier_reference is null or char_length(supplier_reference) <= 100)
     and (notes is null or char_length(notes) <= 1000));
alter table "ledger_bill_lines" add constraint ledger_bill_lines_amounts
  check (amount > 0 and tax_amount >= 0);
alter table "ledger_bill_lines" add constraint ledger_bill_lines_description_length
  check (description is null or char_length(description) <= 300);
alter table "ledger_bill_payments" add constraint ledger_bill_payments_amount_positive
  check (amount > 0);
alter table "ledger_bill_payments" add constraint ledger_bill_payments_currency_format
  check (currency ~ '^[A-Z]{3}$');
alter table "ledger_bill_payments" add constraint ledger_bill_payments_text_length
  check ((payee_name is null or char_length(payee_name) <= 160)
     and (reference is null or char_length(reference) <= 100));
alter table "ledger_bill_payment_allocations" add constraint ledger_bill_payment_allocations_positive
  check (amount > 0);
alter table "ledger_bill_credits" add constraint ledger_bill_credits_totals
  check (subtotal >= 0 and tax_total >= 0 and total > 0 and total = subtotal + tax_total);
alter table "ledger_bill_credits" add constraint ledger_bill_credits_text_length
  check (char_length(reason) between 2 and 300
     and (supplier_reference is null or char_length(supplier_reference) <= 100));
alter table "ledger_bill_credits" add constraint ledger_bill_credits_currency_format
  check (currency ~ '^[A-Z]{3}$');

--> statement-breakpoint

-- What is still owed on a bill: its total less live payments and live supplier credits.
create function app.bill_balance(p_tenant uuid, p_bill uuid) returns numeric
language sql stable security definer set search_path = '' as $$
  select b.total
    - coalesce((select sum(a.amount) from public.ledger_bill_payment_allocations a
                join public.ledger_bill_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
                where a.tenant_id = b.tenant_id and a.bill_id = b.id and p.voided_at is null), 0)
    - coalesce((select sum(c.total) from public.ledger_bill_credits c
                where c.tenant_id = b.tenant_id and c.bill_id = b.id and c.voided_at is null), 0)
  from public.ledger_bills b where b.tenant_id = p_tenant and b.id = p_bill;
$$;
revoke all on function app.bill_balance(uuid, uuid) from public;
grant execute on function app.bill_balance(uuid, uuid) to authenticated;

-- Checked at commit: a bill's totals are the sum of its lines; nothing is paid or credited on a
-- void bill or beyond what it owes; a payment is split exactly and comes from a bank account.
create function app.bill_money_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row jsonb := to_jsonb(new);
  v_tenant uuid := (v_row ->> 'tenant_id')::uuid;
  v_bill uuid := case when tg_table_name = 'ledger_bills' then (v_row ->> 'id')::uuid
                      else (v_row ->> 'bill_id')::uuid end;
  v_payment uuid := case when tg_table_name = 'ledger_bill_payments' then (v_row ->> 'id')::uuid
                         else (v_row ->> 'payment_id')::uuid end;
  v_bills public.ledger_bills;
  v_subtotal numeric;
  v_tax numeric;
  v_amount numeric;
  v_allocated numeric;
begin
  if v_bill is not null then
    select * into v_bills from public.ledger_bills b where b.tenant_id = v_tenant and b.id = v_bill;
    select coalesce(sum(l.amount), 0), coalesce(sum(l.tax_amount), 0) into v_subtotal, v_tax
    from public.ledger_bill_lines l where l.tenant_id = v_tenant and l.bill_id = v_bill;
    if v_subtotal <> v_bills.subtotal or v_tax <> v_bills.tax_total then
      raise exception 'A bill''s totals must be the sum of its lines' using errcode = 'MB002';
    end if;
    if tg_table_name in ('ledger_bill_payment_allocations', 'ledger_bill_credits') then
      if v_bills.voided_at is not null then
        raise exception 'A void bill cannot be paid or credited' using errcode = 'MB002';
      end if;
      if app.bill_balance(v_tenant, v_bill) < 0 then
        raise exception 'That is more than is owed on the bill' using errcode = 'MB002';
      end if;
    end if;
  end if;
  if v_payment is not null then
    select p.amount into v_amount from public.ledger_bill_payments p
    where p.tenant_id = v_tenant and p.id = v_payment;
    select coalesce(sum(a.amount), 0) into v_allocated from public.ledger_bill_payment_allocations a
    where a.tenant_id = v_tenant and a.payment_id = v_payment;
    if v_amount is distinct from v_allocated then
      raise exception 'A payment must be split exactly across its bills' using errcode = 'MB002';
    end if;
    if not exists (select 1 from public.ledger_bill_payments p
                   join public.ledger_accounts a on a.tenant_id = p.tenant_id and a.id = p.account_id
                   where p.tenant_id = v_tenant and p.id = v_payment and a.is_bank) then
      raise exception 'Bills are paid from a bank, cash or card account' using errcode = 'MB002';
    end if;
  end if;
  return null;
end;
$$;
revoke all on function app.bill_money_check() from public;
create constraint trigger ledger_bills_add_up after insert on "ledger_bills"
  deferrable initially deferred for each row execute function app.bill_money_check();
create constraint trigger ledger_bill_lines_add_up after insert on "ledger_bill_lines"
  deferrable initially deferred for each row execute function app.bill_money_check();
create constraint trigger ledger_bill_payments_add_up after insert on "ledger_bill_payments"
  deferrable initially deferred for each row execute function app.bill_money_check();
create constraint trigger ledger_bill_payment_allocations_add_up after insert on "ledger_bill_payment_allocations"
  deferrable initially deferred for each row execute function app.bill_money_check();
create constraint trigger ledger_bill_credits_add_up after insert on "ledger_bill_credits"
  deferrable initially deferred for each row execute function app.bill_money_check();

-- Bills, payments and credits are voided once and never changed otherwise. A bill cannot be
-- voided while a live payment or credit is on it.
create function app.bill_money_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.voided_at is null and new.voided_at is not null
     and (to_jsonb(new) - 'voided_at' - 'voided_by') = (to_jsonb(old) - 'voided_at' - 'voided_by') then
    if tg_table_name = 'ledger_bills' and (
      exists (select 1 from public.ledger_bill_payment_allocations a
              join public.ledger_bill_payments p on p.tenant_id = a.tenant_id and p.id = a.payment_id
              where a.tenant_id = old.tenant_id and a.bill_id = old.id and p.voided_at is null)
      or exists (select 1 from public.ledger_bill_credits c
                 where c.tenant_id = old.tenant_id and c.bill_id = old.id and c.voided_at is null)
    ) then
      raise exception 'Void the payments and credits on this bill first' using errcode = 'MB002';
    end if;
    return new;
  end if;
  raise exception 'A recorded bill, payment or credit cannot be changed; void it instead'
    using errcode = 'MB002';
end;
$$;
create trigger ledger_bills_immutable before update on "ledger_bills"
  for each row execute function app.bill_money_immutable();
create trigger ledger_bill_payments_immutable before update on "ledger_bill_payments"
  for each row execute function app.bill_money_immutable();
create trigger ledger_bill_credits_immutable before update on "ledger_bill_credits"
  for each row execute function app.bill_money_immutable();

--> statement-breakpoint

alter table "ledger_bills" enable row level security;
alter table "ledger_bill_lines" enable row level security;
alter table "ledger_bill_payments" enable row level security;
alter table "ledger_bill_payment_allocations" enable row level security;
alter table "ledger_bill_credits" enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ledger_bills', 'ledger_bill_lines', 'ledger_bill_payments',
    'ledger_bill_payment_allocations', 'ledger_bill_credits']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (
         tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
         and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_read', t, 'books.view');
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (
         tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
         and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_insert', t, 'books.record');
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (
           tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
           and (select app.has_permission((select app.active_tenant_id()), %L)))
         with check (
           tenant_id = (select app.active_tenant_id()) and tenant_id in (select app.tenant_ids())
           and (select app.has_permission((select app.active_tenant_id()), %L)))',
      t || '_update', t, 'books.record', 'books.record');
    execute format(
      'create policy feature_switch on public.%I as restrictive for all to authenticated
         using ((select app.feature_enabled((select app.active_tenant_id()), %L)))
         with check ((select app.feature_enabled((select app.active_tenant_id()), %L)))',
      t, 'books', 'books');
  end loop;
end;
$$;

grant select, insert on "ledger_bills" to authenticated;
grant update (voided_at, voided_by) on "ledger_bills" to authenticated;
grant select, insert on "ledger_bill_lines" to authenticated;
grant select, insert on "ledger_bill_payments" to authenticated;
grant update (voided_at, voided_by) on "ledger_bill_payments" to authenticated;
grant select, insert on "ledger_bill_payment_allocations" to authenticated;
grant select, insert on "ledger_bill_credits" to authenticated;
grant update (voided_at, voided_by) on "ledger_bill_credits" to authenticated;

--> statement-breakpoint

alter table "ledger_entries" drop constraint ledger_entries_source_complete;
alter table "ledger_entries" add constraint ledger_entries_source_complete
  check (
    (source_type is null and source_id is null and source_event is null)
    or (source_type in ('invoice', 'invoice_payment', 'credit_note', 'payslip', 'bill',
                        'bill_payment', 'bill_credit')
        and source_id is not null and source_event is not null)
  );
alter table "ledger_entries" drop constraint ledger_entries_kind_known;
alter table "ledger_entries" add constraint ledger_entries_kind_known
  check (kind in ('money_in', 'money_out', 'transfer', 'journal', 'opening_balance', 'invoice',
                  'invoice_payment', 'credit_note', 'payslip', 'payslip_payment', 'bill',
                  'bill_payment', 'bill_credit', 'reversal'));

-- A bill: each line's account and the GST paid, against accounts payable. A bill dated before
-- the books began is what was already owed then: it posts against opening balances on the
-- start date instead, because its expense and GST belong to periods before these books.
create function app.ledger_bill_event(
  p_tenant uuid, p_actor uuid, p_bill uuid, p_event text, p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.ledger_settings;
  v_bill public.ledger_bills;
  v_existing uuid;
  v_reference text;
  v_lines jsonb;
  v_payable uuid;
begin
  select * into v_settings from public.ledger_settings s where s.tenant_id = p_tenant;
  if not found then
    raise exception 'The books are not set up yet' using errcode = 'MB003';
  end if;
  select * into v_bill from public.ledger_bills b where b.tenant_id = p_tenant and b.id = p_bill;
  if not found then
    raise exception 'That bill was not found' using errcode = 'P0002';
  end if;
  select e.id into v_existing from public.ledger_entries e
  where e.tenant_id = p_tenant and e.source_type = 'bill' and e.source_id = p_bill
    and e.source_event = p_event;
  if v_existing is not null then return v_existing; end if;
  v_reference := 'BILL-' || lpad(v_bill.number::text, 4, '0');
  v_payable := app.ledger_system_account(p_tenant, 'accounts_payable');

  if p_event = 'entered' then
    if v_bill.date < v_settings.start_date then
      return app.ledger_insert_entry(
        p_tenant, p_actor, v_settings.start_date, 'bill',
        'Opening balance: ' || v_reference || ' from ' || v_bill.supplier_name,
        coalesce(v_bill.supplier_reference, v_reference), v_bill.supplier_name, false,
        'bill', p_bill, 'entered', false, null,
        jsonb_build_array(
          jsonb_build_object('account_id', app.ledger_system_account(p_tenant, 'opening_balances'),
                             'debit', v_bill.total, 'description', 'Owed before the books began'),
          jsonb_build_object('account_id', v_payable, 'credit', v_bill.total,
                             'description', 'Owed to ' || v_bill.supplier_name)),
        p_may_pass_lock);
    end if;
    select jsonb_agg(jsonb_build_object(
             'account_id', l.account_id, 'debit', l.amount, 'description', l.description,
             'tax_code_id', l.tax_code_id, 'tax_amount', l.tax_amount) order by l.position)
    into v_lines
    from public.ledger_bill_lines l where l.tenant_id = p_tenant and l.bill_id = p_bill;
    if v_bill.tax_total > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', app.ledger_system_account(p_tenant, 'gst'),
        'debit', v_bill.tax_total, 'description', 'GST paid'));
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'account_id', v_payable, 'credit', v_bill.total,
      'description', 'Owed to ' || v_bill.supplier_name));
    return app.ledger_insert_entry(
      p_tenant, p_actor, v_bill.date, 'bill', v_reference || ' from ' || v_bill.supplier_name,
      coalesce(v_bill.supplier_reference, v_reference), v_bill.supplier_name, false,
      'bill', p_bill, 'entered', false, null, v_lines, p_may_pass_lock);
  end if;

  if p_event = 'voided' then
    select e.id into v_existing from public.ledger_entries e
    where e.tenant_id = p_tenant and e.source_type = 'bill' and e.source_id = p_bill
      and e.source_event = 'entered' and e.reversed_by_entry_id is null;
    if v_existing is null then return null; end if;
    return app.ledger_reverse_internal(
      p_tenant, p_actor, v_existing, v_reference || ' voided', 'voided', p_may_pass_lock);
  end if;
  raise exception 'Unknown bill event' using errcode = 'MB002';
end;
$$;
revoke all on function app.ledger_bill_event(uuid, uuid, uuid, text, boolean) from public;

-- A bill payment: accounts payable down, the bank down.
create function app.ledger_bill_payment_event(
  p_tenant uuid, p_actor uuid, p_payment uuid, p_event text, p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_payment public.ledger_bill_payments;
  v_existing uuid;
  v_label text;
begin
  select * into v_payment from public.ledger_bill_payments p
  where p.tenant_id = p_tenant and p.id = p_payment;
  if not found then
    raise exception 'That payment was not found' using errcode = 'P0002';
  end if;
  select e.id into v_existing from public.ledger_entries e
  where e.tenant_id = p_tenant and e.source_type = 'bill_payment' and e.source_id = p_payment
    and e.source_event = p_event;
  if v_existing is not null then return v_existing; end if;

  if p_event = 'paid' then
    select string_agg('BILL-' || lpad(b.number::text, 4, '0'), ', ' order by b.number)
    into v_label
    from public.ledger_bill_payment_allocations a
    join public.ledger_bills b on b.tenant_id = a.tenant_id and b.id = a.bill_id
    where a.tenant_id = p_tenant and a.payment_id = p_payment;
    return app.ledger_insert_entry(
      p_tenant, p_actor, v_payment.date, 'bill_payment', 'Paid ' || v_label,
      v_payment.reference, v_payment.payee_name, false, 'bill_payment', p_payment, 'paid',
      false, null,
      jsonb_build_array(
        jsonb_build_object('account_id', app.ledger_system_account(p_tenant, 'accounts_payable'),
                           'debit', v_payment.amount, 'description', 'Paid: ' || v_label),
        jsonb_build_object('account_id', v_payment.account_id, 'credit', v_payment.amount,
                           'description', 'Bill payment')),
      p_may_pass_lock);
  end if;

  if p_event = 'voided' then
    select e.id into v_existing from public.ledger_entries e
    where e.tenant_id = p_tenant and e.source_type = 'bill_payment' and e.source_id = p_payment
      and e.source_event = 'paid' and e.reversed_by_entry_id is null;
    if v_existing is null then return null; end if;
    return app.ledger_reverse_internal(
      p_tenant, p_actor, v_existing, 'Bill payment voided', 'voided', p_may_pass_lock);
  end if;
  raise exception 'Unknown bill payment event' using errcode = 'MB002';
end;
$$;
revoke all on function app.ledger_bill_payment_event(uuid, uuid, uuid, text, boolean) from public;

-- A supplier credit: the expense and GST back down, and the supplier is owed that much less.
create function app.ledger_bill_credit_event(
  p_tenant uuid, p_actor uuid, p_credit uuid, p_event text, p_may_pass_lock boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_credit public.ledger_bill_credits;
  v_number integer;
  v_supplier text;
  v_existing uuid;
  v_lines jsonb;
begin
  select * into v_credit from public.ledger_bill_credits c
  where c.tenant_id = p_tenant and c.id = p_credit;
  if not found then
    raise exception 'That credit was not found' using errcode = 'P0002';
  end if;
  select e.id into v_existing from public.ledger_entries e
  where e.tenant_id = p_tenant and e.source_type = 'bill_credit' and e.source_id = p_credit
    and e.source_event = p_event;
  if v_existing is not null then return v_existing; end if;
  select b.number, b.supplier_name into v_number, v_supplier from public.ledger_bills b
  where b.tenant_id = p_tenant and b.id = v_credit.bill_id;

  if p_event = 'issued' then
    v_lines := jsonb_build_array(jsonb_build_object(
      'account_id', app.ledger_system_account(p_tenant, 'accounts_payable'),
      'debit', v_credit.total, 'description', 'Credit from ' || v_supplier));
    if v_credit.subtotal > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', v_credit.account_id, 'credit', v_credit.subtotal,
        'description', 'Credit: ' || v_credit.reason, 'tax_code_id', v_credit.tax_code_id,
        'tax_amount', v_credit.tax_total));
    end if;
    if v_credit.tax_total > 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'account_id', app.ledger_system_account(p_tenant, 'gst'),
        'credit', v_credit.tax_total, 'description', 'GST credited'));
    end if;
    return app.ledger_insert_entry(
      p_tenant, p_actor, v_credit.date, 'bill_credit',
      'Credit on BILL-' || lpad(v_number::text, 4, '0') || ' from ' || v_supplier,
      v_credit.supplier_reference, v_supplier, false, 'bill_credit', p_credit, 'issued', false,
      null, v_lines, p_may_pass_lock);
  end if;

  if p_event = 'voided' then
    select e.id into v_existing from public.ledger_entries e
    where e.tenant_id = p_tenant and e.source_type = 'bill_credit' and e.source_id = p_credit
      and e.source_event = 'issued' and e.reversed_by_entry_id is null;
    if v_existing is null then return null; end if;
    return app.ledger_reverse_internal(
      p_tenant, p_actor, v_existing, 'Supplier credit voided', 'voided', p_may_pass_lock);
  end if;
  raise exception 'Unknown supplier credit event' using errcode = 'MB002';
end;
$$;
revoke all on function app.ledger_bill_credit_event(uuid, uuid, uuid, text, boolean) from public;

-- One door for all three, called by the bills service in the same transaction as the change.
create function app.ledger_post_bill_document(p_kind text, p_id uuid, p_event text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid;
  v_actor uuid;
  v_pass boolean;
begin
  select c.tenant, c.actor into v_tenant, v_actor from app.ledger_caller() c;
  if not app.has_permission(v_tenant, 'books.record') then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  v_pass := app.has_permission(v_tenant, 'books.manage');
  if p_kind = 'bill' then
    return app.ledger_bill_event(v_tenant, v_actor, p_id, p_event, v_pass);
  elsif p_kind = 'bill_payment' then
    return app.ledger_bill_payment_event(v_tenant, v_actor, p_id, p_event, v_pass);
  elsif p_kind = 'bill_credit' then
    return app.ledger_bill_credit_event(v_tenant, v_actor, p_id, p_event, v_pass);
  end if;
  raise exception 'Unknown bill document' using errcode = 'MB002';
end;
$$;
revoke all on function app.ledger_post_bill_document(text, uuid, text) from public;
grant execute on function app.ledger_post_bill_document(text, uuid, text) to authenticated;
