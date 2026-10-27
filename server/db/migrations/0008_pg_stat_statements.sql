-- Query statistics (calls, mean and total time per query), so slow queries show up as the data grows.
-- Read them with: select query, calls, mean_exec_time from pg_stat_statements order by total_exec_time desc limit 20
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
