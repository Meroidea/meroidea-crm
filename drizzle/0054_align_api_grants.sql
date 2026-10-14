-- What the API roles may do is set by each migration's own grants (ADR-007, docs/database.md).
-- A hosted project can instead be created with default privileges that hand every new table in
-- `public` to anon and authenticated in full ("auto-expose"). There RLS still filters rows, but
-- the narrower grants this schema relies on are lost: soft-deleted records could be removed for
-- good, and columns that only the server may write (a question's subject, an agreement's link
-- hash) become writable or readable. This resets every table to exactly the grants the migrations
-- give, and stops new tables being exposed by default. Re-running it changes nothing.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
--> statement-breakpoint
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
--> statement-breakpoint
revoke all on all tables in schema public from anon, authenticated;
--> statement-breakpoint
revoke all on all sequences in schema public from anon, authenticated;
--> statement-breakpoint

grant select, insert, update on activities to authenticated;
grant select, insert on applicant_notes to authenticated;
grant select, insert on audit_logs to authenticated;
grant select, insert on concern_messages to authenticated;
grant select, insert on concerns to authenticated;
grant update (status, resolved_at, resolved_by) on concerns to authenticated;
grant select, insert, delete on contact_organizations to authenticated;
grant select, insert, update on contacts to authenticated;
grant select, update on customer_reviews to authenticated;
grant select, insert, update on departments to authenticated;
grant select on employee_payroll_details to authenticated;
grant select, insert, update on employees to authenticated;
grant select, insert, update on employment_contracts to authenticated;
grant select, insert, update on expense_claims to authenticated;
grant select, insert, update on helpdesk_forms to authenticated;
grant select, insert on inventory_categories to authenticated;
grant select, insert, update on inventory_items to authenticated;
grant select, insert on inventory_movements to authenticated;
grant select, insert, delete on invoice_lines to authenticated;
grant select, insert, update on invoices to authenticated;
grant select, insert, update on job_applicants to authenticated;
grant select, insert, update on job_openings to authenticated;
grant select, insert, update, delete on lead_sources to authenticated;
grant select, insert, update on leave_requests to authenticated;
grant select, insert, update on leave_types to authenticated;
grant select, insert on library_document_versions to authenticated;
grant select, insert, update on library_documents to authenticated;
grant select, insert, update, delete on lost_reasons to authenticated;
grant select, insert, update on opportunities to authenticated;
grant select, insert, update on organizations to authenticated;
grant select, insert, update on partners to authenticated;
grant select, insert, update on payslips to authenticated;
grant select, insert, update, delete on pipeline_stages to authenticated;
grant select, insert, update, delete on pipelines to authenticated;
grant select, insert, update on project_tasks to authenticated;
grant select, insert, update on projects to authenticated;
grant select, insert, delete on public_holidays to authenticated;
grant select, insert on purchase_order_lines to authenticated;
grant select, insert, update on purchase_orders to authenticated;
grant select, insert, update on review_links to authenticated;
grant select, insert, update, delete on role_permissions to authenticated;
grant select, insert, update, delete on roles to authenticated;
grant select, insert, update on roster_shifts to authenticated;
grant select, insert, delete on roster_team_members to authenticated;
grant select, insert, update on roster_teams to authenticated;
grant select, insert, update on rosters to authenticated;
grant select on service_agreements to authenticated;
grant select, insert, update on stage_history to authenticated;
grant select, insert, update on supplier_items to authenticated;
grant select, insert, update on suppliers to authenticated;
grant select, insert, update, delete on task_time_logs to authenticated;
grant select, insert, update on tasks to authenticated;
grant select, insert, update, delete on teams to authenticated;
grant select (id, tenant_id, agreement_id, recipient_name, recipient_email, sent_at, accepted_at, accepted_name) on tenant_agreements to authenticated;
grant select, insert, update, delete on tenant_memberships to authenticated;
grant select on tenant_subscriptions to authenticated;
grant select on tenants to authenticated;
grant select, insert on ticket_messages to authenticated;
grant select, insert, update on tickets to authenticated;
grant select, insert, update on time_entries to authenticated;
grant select, insert, delete on training_assignments to authenticated;
grant select on training_completions to authenticated;
grant select, insert, update, delete on training_courses to authenticated;
grant select, insert, update, delete on training_modules to authenticated;
grant select, insert, update, delete on training_question_keys to authenticated;
grant select, insert, update, delete on training_questions to authenticated;
grant select, update on users to authenticated;
grant select, insert, update on workforce_settings to authenticated;

-- Rows that number themselves (staff numbers, audit entries) draw from these sequences.
grant update on sequence employees_employee_number_seq to authenticated;
grant update on sequence audit_logs_id_seq to authenticated;
