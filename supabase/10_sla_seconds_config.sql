-- =====================================================================
-- 10. SLA configuration in seconds
-- =====================================================================
-- Previously `issue_categories.response_sla_minutes` / `resolution_sla_minutes`
-- only allowed whole-minute SLAs. This renames both columns to their
-- `_seconds` equivalents (converting existing values from minutes to
-- seconds) so SLAs can be configured with second-level precision, while
-- still supporting minutes/hours in the UI (the admin panel just converts
-- whichever unit is picked into seconds before saving).
--
-- Run this after 1..9 have already been applied. On a brand-new database,
-- run the files in numeric order — file 2's seed insert still uses the old
-- (minutes) column name and runs *before* this rename, so it remains valid.

alter table issue_categories rename column response_sla_minutes to response_sla_seconds;
alter table issue_categories rename column resolution_sla_minutes to resolution_sla_seconds;

update issue_categories set response_sla_seconds = response_sla_seconds * 60;
update issue_categories set resolution_sla_seconds = resolution_sla_seconds * 60;

alter table issue_categories drop constraint if exists issue_categories_response_sla_minutes_check;
alter table issue_categories drop constraint if exists issue_categories_resolution_sla_minutes_check;

alter table issue_categories add constraint issue_categories_response_sla_seconds_check check (response_sla_seconds > 0);
alter table issue_categories add constraint issue_categories_resolution_sla_seconds_check check (resolution_sla_seconds > 0);
