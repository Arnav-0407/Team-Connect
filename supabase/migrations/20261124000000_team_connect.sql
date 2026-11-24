begin;

create schema if not exists team_connect;
revoke all on schema team_connect from public, anon, authenticated;

create table team_connect.accounts (
  id text primary key, auth_id uuid unique not null references auth.users(id) on delete cascade,
  name text not null, role text not null check (role in ('Workspace Admin', 'Employee'))
);

create table team_connect.records (
  kind text not null check (kind in ('server','channel','message','draft','profile','help','event')),
  id text not null check (char_length(id) between 1 and 300),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  primary key (kind, id)
);
create index team_connect_server_records on team_connect.records (kind, (data->>'serverId'));
create index team_connect_channel_records on team_connect.records (kind, (data->>'channelId'));

create table public.team_connect_sync (
  user_id uuid primary key references team_connect.accounts(auth_id) on delete cascade,
  revision bigint not null default 0
);
alter table public.team_connect_sync enable row level security;
revoke all on public.team_connect_sync from public, anon, authenticated;
grant select on public.team_connect_sync to authenticated;
create policy "Read own Team Connect revision" on public.team_connect_sync
  for select to authenticated using (user_id = (select auth.uid()));
alter publication supabase_realtime add table public.team_connect_sync;

create function team_connect.init_revision() returns trigger language plpgsql set search_path = '' as $$
begin
  insert into public.team_connect_sync (user_id) values (new.auth_id);
  return new;
end;
$$;
create trigger team_connect_account_revision after insert on team_connect.accounts
  for each row execute function team_connect.init_revision();

create function team_connect.members(server_id text) returns jsonb language sql stable set search_path = '' as $$
  select coalesce((select data->'memberIds' from team_connect.records
    where kind = 'server' and id = server_id), '[]'::jsonb);
$$;

create function public.team_connect_snapshot() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  person team_connect.accounts;
  admin boolean;
begin
  select * into person from team_connect.accounts where auth_id = auth.uid();
  if not found then raise exception 'This account does not have Team Connect access.' using errcode = '42501'; end if;
  admin := person.role = 'Workspace Admin';

  return jsonb_build_object(
    'account', person.id,
    'authId', person.auth_id,
    'revision', (select revision from public.team_connect_sync where user_id = person.auth_id),
    'accounts', (select jsonb_object_agg(a.id, jsonb_build_object(
      'name', a.name, 'role', a.role, 'email', case when admin or a.id = person.id then u.email else '' end))
      from team_connect.accounts a join auth.users u on u.id = a.auth_id),
    'records', coalesce((select jsonb_agg(jsonb_build_object(
      'kind', r.kind, 'id', r.id, 'data', case when r.kind = 'profile' and r.id <> person.id
        then r.data - 'email' - 'appearance' else r.data end) order by r.kind, r.id)
      from team_connect.records r where case r.kind
        when 'server' then r.data->'memberIds' ? person.id
        when 'channel' then team_connect.members(r.data->>'serverId') ? person.id
        when 'message' then team_connect.members(r.data->>'serverId') ? person.id
        when 'draft' then r.data->>'owner' = person.id and team_connect.members(r.data->>'serverId') ? person.id
        when 'profile' then true
        when 'help' then admin or r.data->>'authorId' = person.id
        when 'event' then admin else false end), '[]'::jsonb)
  );
end;
$$;

create function public.team_connect_commit(changes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  person team_connect.accounts;
  admin boolean;
  patch jsonb;
  record_kind text;
  record_id text;
  old_data jsonb;
  new_data jsonb;
  entity jsonb;
  channel_data jsonb;
  audience jsonb := '[]'::jsonb;
  all_accounts jsonb;
  administrators jsonb;
begin
  select * into person from team_connect.accounts where auth_id = auth.uid();
  if not found then raise exception 'This account does not have Team Connect access.' using errcode = '42501'; end if;
  if jsonb_typeof(changes) is distinct from 'array' or jsonb_array_length(changes) > 600
    or pg_column_size(changes) > 1000000 then
    raise exception 'Invalid workspace update.' using errcode = '22023';
  end if;
  admin := person.role = 'Workspace Admin';
  perform pg_advisory_xact_lock(26318, 1);
  select jsonb_agg(id), coalesce(jsonb_agg(id) filter (where role = 'Workspace Admin'), '[]'::jsonb)
    into all_accounts, administrators from team_connect.accounts;

  for patch in select value from jsonb_array_elements(changes) loop
    record_kind := patch->>'kind';
    record_id := patch->>'id';
    new_data := nullif(patch->'after', 'null'::jsonb);
    if not (patch ? 'before' and patch ? 'after') or coalesce(char_length(record_id), 0) not between 1 and 300
      or (new_data is not null and jsonb_typeof(new_data) <> 'object') then
      raise exception 'Invalid workspace record.' using errcode = '22023';
    end if;
    select data into old_data from team_connect.records where kind = record_kind and id = record_id;
    entity := coalesce(old_data, new_data, nullif(patch->'before', 'null'::jsonb));

    case record_kind
      when 'server' then
        if not admin or (old_data is not null and not (old_data->'memberIds' ? person.id)) then
          raise exception 'Server access denied.' using errcode = '42501';
        end if;
        if new_data is not null and (
          new_data - array['name','memberIds','createdAt','createdBy'] <> '{}'::jsonb
          or jsonb_typeof(new_data->'name') is distinct from 'string'
          or char_length(btrim(new_data->>'name')) not between 1 and 100
          or jsonb_typeof(new_data->'memberIds') is distinct from 'array'
          or not (new_data->'memberIds' ? person.id)
          or exists (select 1 from jsonb_array_elements(new_data->'memberIds') m
            where jsonb_typeof(m) <> 'string' or not (all_accounts ? (m #>> '{}')))
          or (select count(distinct m) from jsonb_array_elements(new_data->'memberIds') m) <> jsonb_array_length(new_data->'memberIds')
          or (new_data ? 'createdAt' and (new_data->>'createdAt')::timestamptz is null)
          or (new_data ? 'createdBy' and jsonb_typeof(new_data->'createdBy') is distinct from 'string')
        ) then raise exception 'Invalid server.' using errcode = '22023'; end if;
        audience := audience || coalesce(old_data->'memberIds','[]'::jsonb) || coalesce(new_data->'memberIds','[]'::jsonb);
      when 'channel' then
        if not admin or not (team_connect.members(entity->>'serverId') ? person.id) then
          raise exception 'Channel access denied.' using errcode = '42501';
        end if;
        if new_data is not null and (
          new_data - array['name','serverId','archived','createdAt'] <> '{}'::jsonb
          or new_data->>'serverId' is distinct from entity->>'serverId'
          or jsonb_typeof(new_data->'name') is distinct from 'string'
          or char_length(btrim(new_data->>'name')) not between 1 and 60
          or jsonb_typeof(new_data->'archived') is distinct from 'boolean'
          or (new_data ? 'createdAt' and (new_data->>'createdAt')::timestamptz is null)
          or exists (select 1 from team_connect.records r where r.kind = 'channel' and r.id <> record_id
            and r.data->>'serverId' = entity->>'serverId' and lower(r.data->>'name') = lower(new_data->>'name'))
        ) then raise exception 'Invalid or duplicate channel.' using errcode = '22023'; end if;
        audience := audience || team_connect.members(entity->>'serverId');
      when 'message', 'draft' then
        select data into channel_data from team_connect.records where kind = 'channel' and id = entity->>'channelId';
        if channel_data is null or channel_data->>'serverId' is distinct from entity->>'serverId'
          or not (team_connect.members(entity->>'serverId') ? person.id) or (channel_data->>'archived')::boolean then
          raise exception 'This channel is read-only or unavailable.' using errcode = '42501';
        end if;
        if record_kind = 'draft' then
          if entity->>'owner' is distinct from person.id or record_id is distinct from (person.id || ':' || (entity->>'channelId'))
            or (new_data is not null and (
              new_data - array['text','owner','channelId','serverId'] <> '{}'::jsonb
              or new_data - 'text' is distinct from entity - 'text'
              or jsonb_typeof(new_data->'text') is distinct from 'string' or char_length(new_data->>'text') > 2000
            )) then raise exception 'Invalid draft.' using errcode = '42501'; end if;
          audience := audience || jsonb_build_array(person.id);
        else
          if old_data is null then
            if new_data->>'authorId' is distinct from person.id or new_data ? 'removedBy' or char_length(record_id) > 250 then
              raise exception 'Invalid message author or ID.' using errcode = '42501';
            end if;
          elsif old_data ? 'removedBy' and admin and new_data = old_data then
            continue;
          elsif old_data ? 'removedBy' or (old_data->>'authorId' is distinct from person.id and
            (not admin or new_data->>'removedBy' is distinct from person.id)) then
            raise exception 'Message access denied.' using errcode = '42501';
          end if;
          if new_data is not null and (
            new_data - array['authorId','authorName','text','createdAt','editedAt','removedBy','serverId','channelId'] <> '{}'::jsonb
            or new_data - 'text' - 'editedAt' - 'removedBy' is distinct from entity - 'text' - 'editedAt' - 'removedBy'
            or jsonb_typeof(new_data->'text') is distinct from 'string'
            or jsonb_typeof(new_data->'authorName') is distinct from 'string'
            or char_length(new_data->>'authorName') not between 1 and 60
            or (new_data->>'createdAt')::timestamptz is null
            or (new_data ? 'editedAt' and (new_data->>'editedAt')::timestamptz is null)
            or (new_data ? 'removedBy' and (
              not admin or old_data is null or old_data->>'authorId' = person.id
              or new_data->>'removedBy' is distinct from person.id or new_data->>'text' is distinct from ''
            ))
            or (not (new_data ? 'removedBy') and char_length(btrim(new_data->>'text')) not between 1 and 2000)
          ) then raise exception 'Invalid message.' using errcode = '22023'; end if;
          audience := audience || team_connect.members(entity->>'serverId');
        end if;
      when 'profile' then
        if record_id is distinct from person.id or new_data is null
          or new_data - array['name','email','designation','photo','presence','appearance'] <> '{}'::jsonb
          or exists (select 1 from jsonb_each(new_data) f where f.key <> 'appearance' and jsonb_typeof(f.value) <> 'string')
          or coalesce(char_length(new_data->>'name'),0) > 60 or coalesce(char_length(new_data->>'email'),0) > 254
          or coalesce(char_length(new_data->>'designation'),0) > 80 or coalesce(char_length(new_data->>'photo'),0) > 349552
          or coalesce(new_data->>'photo','') !~ '^(data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2})?$'
          or (new_data ? 'appearance' and jsonb_typeof(new_data->'appearance') <> 'object')
          or coalesce(new_data->>'presence','active') not in ('active','away','busy','stealth')
        then raise exception 'Invalid profile update.' using errcode = '42501'; end if;
        audience := audience || case
          when coalesce(old_data,'{}'::jsonb) - 'email' - 'appearance' = new_data - 'email' - 'appearance'
            then jsonb_build_array(person.id) else all_accounts end;
      when 'help' then
        if new_data is null or (old_data is null and (
          admin or new_data->>'authorId' is distinct from person.id or new_data->>'status' is distinct from 'Pending'
          or new_data - array['message','authorId','status','createdAt'] <> '{}'::jsonb
          or jsonb_typeof(new_data->'message') is distinct from 'string'
          or char_length(btrim(new_data->>'message')) not between 1 and 1000 or (new_data->>'createdAt')::timestamptz is null
        )) or (old_data is not null and (
          not admin or old_data->>'status' <> 'Pending' or coalesce(new_data->>'status','') not in ('Resolved','Rejected')
          or new_data - 'status' - 'reply' is distinct from old_data - 'status' - 'reply'
          or (new_data ? 'reply' and jsonb_typeof(new_data->'reply') <> 'string')
          or coalesce(char_length(new_data->>'reply'),0) > 1000
        )) then raise exception 'Invalid help request change.' using errcode = '42501'; end if;
        audience := audience || administrators || jsonb_build_array(entity->>'authorId');
      when 'event' then
        if not admin or new_data is null or (new_data->>'time')::timestamptz is null
          or jsonb_typeof(new_data->'read') is distinct from 'boolean'
          or exists (select 1 from unnest(array['actor','server','serverId','action','category']) field
            where jsonb_typeof(new_data->field) is distinct from 'string')
        then raise exception 'Invalid activity update.' using errcode = '42501'; end if;
        audience := audience || administrators;
      else raise exception 'Unknown workspace record.' using errcode = '22023';
    end case;

    if old_data is distinct from nullif(patch->'before', 'null'::jsonb) then
      if old_data is not distinct from new_data or (record_kind = 'draft' and new_data is null) then continue; end if;
      if record_kind <> 'draft' then raise exception 'This item changed elsewhere. Try again.' using errcode = '40001'; end if;
    end if;
    if new_data is null then
      delete from team_connect.records where kind = record_kind and id = record_id;
      if record_kind = 'server' then
        delete from team_connect.records where kind in ('channel','message','draft') and data->>'serverId' = record_id;
      elsif record_kind = 'channel' then
        delete from team_connect.records where kind in ('message','draft') and data->>'channelId' = record_id;
      end if;
    else
      insert into team_connect.records values (record_kind, record_id, new_data)
        on conflict (kind,id) do update set data = excluded.data;
      if record_kind = 'message' and old_data is null and not admin
        and new_data->>'text' ~* '(^|[[:space:]])@admin([^[:alnum:]_]|$)' then
        insert into team_connect.records
          select 'event', 'mention:' || record_id, jsonb_build_object(
            'time', new_data->>'createdAt', 'actor', new_data->>'authorName', 'serverId', s.id,
            'server', s.data->>'name', 'category', 'Mentions', 'action', 'Mentioned @Admin in #' || (channel_data->>'name'), 'read', false)
          from team_connect.records s where s.kind = 'server' and s.id = new_data->>'serverId'
          on conflict (kind,id) do nothing;
        audience := audience || administrators;
      end if;
    end if;
  end loop;

  delete from team_connect.records where kind = 'event' and id in (
    select id from team_connect.records where kind = 'event' order by (data->>'time')::timestamptz desc,id offset 500
  );
  update public.team_connect_sync s set revision = revision + 1
    from team_connect.accounts a where a.auth_id = s.user_id and audience ? a.id;
end;
$$;

revoke all on function public.team_connect_snapshot() from public, anon, authenticated;
revoke all on function public.team_connect_commit(jsonb) from public, anon, authenticated;
grant execute on function public.team_connect_snapshot() to authenticated;
grant execute on function public.team_connect_commit(jsonb) to authenticated;

commit;
