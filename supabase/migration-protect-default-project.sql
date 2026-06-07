-- Protect the built-in project from old app versions that can still upload active = 0.

create or replace function public.protect_default_project()
returns trigger
language plpgsql
as $$
begin
  if new.local_project_id = 'project_gold_field_default' then
    new.active := 1;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_default_project_trigger on public.projects;
create trigger protect_default_project_trigger
before insert or update on public.projects
for each row execute function public.protect_default_project();

update public.projects
set active = 1,
    updated_at_local = now()::text
where local_project_id = 'project_gold_field_default';

update public.project_users
set active = 1
where local_project_id = 'project_gold_field_default';
