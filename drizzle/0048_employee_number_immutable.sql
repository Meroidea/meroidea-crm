-- The Employee ID from 0047 is assigned once and never changes (ADR-042). The column is an
-- identity the database always generates, so nobody can choose a value; this trigger also stops
-- it being re-drawn or altered afterwards, for every role including the privileged one.

create function app.keep_employee_number() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.employee_number is distinct from old.employee_number then
    raise exception 'An Employee ID cannot be changed once it has been assigned.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger keep_employee_number before update on "employees"
  for each row execute function app.keep_employee_number();
