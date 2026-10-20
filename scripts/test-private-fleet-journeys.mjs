// Local PostgreSQL only. Install @electric-sql/pglite in a temporary directory,
// then run with PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node this-file.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite')
const db = new PGlite()
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create table fleet_trackers(id uuid primary key,name text);
create table staff_users(id uuid primary key,user_id uuid);
create table ops_service_addresses(id uuid primary key,street_1 text,city text,latitude float8,longitude float8,geocoded_at timestamptz,geocode_source text);
create table ops_appointments(id uuid primary key,appointment_date date,start_time time,assigned_staff_user_id uuid,service_address_id uuid,gps_lat numeric,gps_lng numeric,status text,parked_at timestamptz);
create table fleet_tracker_points(id bigint generated always as identity primary key,tracker_id uuid,recorded_at timestamptz,latitude float8,longitude float8,speed_mps float8,satellites int,seq int unique);
`)
await db.exec(await readFile(new URL('../supabase/migrations/20261020041954_add_private_vehicle_job_journeys.sql',import.meta.url),'utf8'))
await db.exec(await readFile(new URL('../supabase/migrations/20261020042239_preserve_private_trip_gap_markers.sql',import.meta.url),'utf8'))
const tracker=randomUUID(),staff=randomUUID(),auth=randomUUID(),other=randomUUID(),a=randomUUID(),b=randomUUID(),c=randomUUID()
await db.query('insert into fleet_trackers values($1,$2)',[tracker,'Local test truck'])
await db.query('insert into staff_users values($1,$2)',[staff,auth])
for(const [id,lat,assigned] of [[a,39.02,staff],[b,39.04,auth],[c,39.06,other]]) {
  await db.query(`insert into ops_service_addresses values($1,'Test site','Test town',$2,-104.8,now(),'colorado-state-address-point')`,[id,lat])
  await db.query(`insert into ops_appointments values($1,'2026-10-20','08:00',$2,$1,null,null,'booked',null)`,[id,assigned])
}
await db.query(`insert into fleet_dispatch_tracking values($1,$2,'Test base',39,-104.8,'2026-10-20T13:00Z')`,[tracker,staff])
let seq=0
async function point(time,lat,speed=0) {
  await db.query('insert into fleet_tracker_points(tracker_id,recorded_at,latitude,longitude,speed_mps,seq) values($1,$2,$3,-104.8,$4,$5)',[tracker,`2026-10-20T${time}Z`,lat,speed,seq++])
}
// First fix is not an arrival. Sixty seconds establishes a stop.
await point('14:00:00',39); await point('14:01:00',39)
await point('14:02:00',39.003,5); await point('14:02:30',39.005,5)
await point('14:04:00',39.02); await point('14:05:00',39.02)
await point('14:12:00',39.023,5); await point('14:12:30',39.025,5)
await point('14:14:00',39.04); await point('14:15:00',39.04)
await point('14:20:00',39.043,5); await point('14:20:30',39.045,5)
await point('14:22:00',39); await point('14:23:00',39)
let trips=(await db.query('select * from fleet_job_trips order by departed_at')).rows
let visits=(await db.query('select * from fleet_job_visits order by arrived_at')).rows
assert.equal(trips.length,3)
assert.equal(visits.length,2)
assert.equal(trips[0].origin_label,'Test base')
assert.equal(trips[0].destination_appointment_id,a)
assert.equal(trips[1].origin_appointment_id,a)
assert.equal(trips[1].destination_appointment_id,b)
assert.equal(trips[2].destination_label,'Test base')
assert.equal(new Date(trips[0].departed_at).toISOString(),'2026-10-20T14:02:00.000Z')
assert.equal(new Date(visits[0].arrived_at).toISOString(),'2026-10-20T14:04:00.000Z')
assert.equal(new Date(visits[0].departed_at).toISOString(),'2026-10-20T14:12:00.000Z')
assert.ok(trips.every(t=>t.confirmed&&t.status==='arrived'&&t.route.length>=2))
assert.ok(trips[0].observed_distance_m>1700 && trips[0].observed_distance_m<2100)
assert.ok(trips[1].signal_gaps>0) // Seven-minute upload gap is disclosed.
// Boundary jitter shorter than 30 seconds is not a departure.
await point('14:23:10',39.003,5); await point('14:23:25',39)
assert.equal((await db.query('select count(*)::int n from fleet_job_trips')).rows[0].n,3)
// Passing a job for less than a minute never creates a visit.
await point('14:24:00',39.003,5); await point('14:24:30',39.005,5)
await point('14:26:00',39.02); await point('14:26:30',39.023,5)
assert.equal((await db.query('select count(*)::int n from fleet_job_visits')).rows[0].n,2)
await db.query('update fleet_dispatch_tracking set base_label=$2 where tracker_id=$1',[tracker,'Updated test base'])
assert.equal((await db.query('select count(*)::int n from fleet_dispatch_state')).rows[0].n,0)
assert.equal((await db.query("select count(*)::int n from fleet_job_trips where status='incomplete'")).rows[0].n,1)
// A different technician's job is not attached to this truck.
await point('14:28:00',39.06); await point('14:29:00',39.06)
assert.equal((await db.query('select count(*)::int n from fleet_job_visits')).rows[0].n,2)
// Old uploads and retransmissions cannot duplicate or rewrite the ledger.
await point('14:04:30',39.02)
await db.exec(`insert into fleet_tracker_points(tracker_id,recorded_at,latitude,longitude,speed_mps,seq) select tracker_id,recorded_at,latitude,longitude,speed_mps,seq from fleet_tracker_points on conflict do nothing`)
assert.equal((await db.query('select count(*)::int n from fleet_job_visits')).rows[0].n,2)
const tracker2=randomUUID()
await db.query('insert into fleet_trackers values($1,$2)',[tracker2,'Offline batch test'])
await db.query(`insert into fleet_dispatch_tracking values($1,$2,'Test base',39,-104.8,'2026-10-20T13:00Z')`,[tracker2,staff])
await db.query(`insert into fleet_tracker_points(tracker_id,recorded_at,latitude,longitude,speed_mps,seq) values ($1,'2026-10-20T14:01Z',39,-104.8,0,10001),($1,'2026-10-20T14:00Z',39,-104.8,0,10000)`,[tracker2])
assert.equal((await db.query('select stable_stop from fleet_dispatch_state where tracker_id=$1',[tracker2])).rows[0].stable_stop.kind,'base')
await db.query(`insert into fleet_tracker_points(tracker_id,recorded_at,latitude,longitude,speed_mps,satellites,seq) values ($1,'2026-10-20T14:02Z',39.02,-104.8,0,0,10002),($1,'2026-10-20T14:03Z',39.02,-104.8,0,0,10003)`,[tracker2])
assert.equal((await db.query('select count(*)::int n from fleet_job_visits where tracker_id=$1',[tracker2])).rows[0].n,0)
const tracker3=randomUUID()
await db.query('insert into fleet_trackers values($1,$2)',[tracker3,'GPS jump test'])
await db.query(`insert into fleet_dispatch_tracking values($1,$2,'Test base',39,-104.8,'2026-10-20T13:00Z')`,[tracker3,staff])
await db.query(`insert into fleet_tracker_points(tracker_id,recorded_at,latitude,longitude,speed_mps,seq) values ($1,'2026-10-20T14:00Z',39.001,-104.8,5,11000),($1,'2026-10-20T14:00:10Z',39.02,-104.8,0,11001),($1,'2026-10-20T14:01:10Z',39.02,-104.8,0,11002)`,[tracker3])
const jumpTrip=(await db.query('select * from fleet_job_trips where tracker_id=$1',[tracker3])).rows[0]
assert.equal(jumpTrip.route.at(-1).gap,true)
assert.ok(jumpTrip.signal_gaps>0)
await db.exec('set role authenticated')
for(const table of ['fleet_job_trips','fleet_job_visits','fleet_dispatch_tracking','fleet_dispatch_state']) {
  await assert.rejects(db.query(`select * from ${table}`),e=>e.code==='42501')
}
await db.exec('reset role')
await db.close()
console.log('PASS: base → first job → second job → base, dwell, jitter, drive-by, assignment, gaps, late/duplicate points, and private-table access')
