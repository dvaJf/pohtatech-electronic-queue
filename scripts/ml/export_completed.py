#!/usr/bin/env python3
"""Export completed service rows using the same Moscow-local SQL semantics as backend."""
import argparse, csv, os
import psycopg

SQL = """
WITH history AS (
 SELECT t.id, t.service_id::text service_id, t.branch_id::text branch_id, t.source,
        t.service_started_at, t.completed_at,
        extract(epoch from (t.completed_at-t.service_started_at))::float8 target,
        count(*) over (partition by t.service_id,t.branch_id order by t.completed_at rows between 20 preceding and 1 preceding) prior_count,
        avg(extract(epoch from (t.completed_at-t.service_started_at))) over
          (partition by t.service_id,t.branch_id order by t.completed_at rows between 20 preceding and 1 preceding) prior_avg
 FROM tickets t
 WHERE t.status='COMPLETED' AND t.service_started_at IS NOT NULL AND t.completed_at IS NOT NULL
   AND t.completed_at>t.service_started_at
   AND extract(epoch from (t.completed_at-t.service_started_at)) <= 7200
)
SELECT service_id,branch_id,source,service_started_at,completed_at,target,
       count(*) FILTER (WHERE h2.completed_at IS NOT NULL) AS served_count,
       COALESCE(CASE WHEN prior_count < 3 THEN 300 ELSE prior_avg END,300) rolling_avg_seconds
FROM history h
LEFT JOIN history h2 ON h2.branch_id=h.branch_id
 AND (h2.completed_at AT TIME ZONE 'Europe/Moscow')::date=(h.service_started_at AT TIME ZONE 'Europe/Moscow')::date
 AND h2.completed_at < h.service_started_at
GROUP BY service_id,branch_id,source,service_started_at,completed_at,target,prior_count,prior_avg
ORDER BY completed_at
"""
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--dsn',default=os.getenv('TEST_POSTGRES_DSN') or os.getenv('DATABASE_URL'),required=False); ap.add_argument('--output',default='ml-data/completed.csv'); a=ap.parse_args()
    if not a.dsn: raise SystemExit('DATABASE_URL or --dsn is required')
    with psycopg.connect(a.dsn) as conn, conn.cursor() as cur:
        cur.execute(SQL); rows=cur.fetchall(); cols=[d.name for d in cur.description]
    os.makedirs(os.path.dirname(a.output) or '.',exist_ok=True)
    with open(a.output,'w',newline='') as f:
        w=csv.writer(f); w.writerow(cols); w.writerows(rows)
    print(f'exported {len(rows)} rows to {a.output}')
if __name__=='__main__': main()
