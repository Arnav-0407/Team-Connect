-- Create users in Authentication > Users and confirm their email addresses.
-- Replace any email below that differs from the one shown in Authentication.
with expected (id, email, name, role) as (
  values
    ('user-arnav', 'admin@gmail.com', 'Admin', 'Workspace Admin'),
    ('employee-arnav', 'arnavshaw@gmail.com', 'Arnav Shaw', 'Employee'),
    ('employee-parth', 'parthsinghal@gmail.com', 'Parth Singhal', 'Employee')
),
matched as (
  select e.*, u.id as auth_id, u.email_confirmed_at
  from expected e
  left join auth.users u on lower(u.email) = lower(e.email)
),
linked as (
  insert into team_connect.accounts (id, auth_id, name, role)
  select id, auth_id, name, role
  from matched
  where email_confirmed_at is not null
  on conflict (id) do update set name = excluded.name, role = excluded.role
    where team_connect.accounts.auth_id = excluded.auth_id
  returning id
)
select m.name, m.email,
  case
    when m.auth_id is null then 'User not found'
    when m.email_confirmed_at is null then 'Email not confirmed'
    when l.id is null then 'Already linked to a different Auth user'
    else 'Linked'
  end as status
from matched m
left join linked l using (id)
order by (m.role = 'Workspace Admin') desc, m.name;
