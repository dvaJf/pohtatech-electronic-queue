ALTER TABLE branches
 DROP CONSTRAINT branch_coordinate_pair,
 DROP CONSTRAINT branch_latitude_range,
 DROP CONSTRAINT branch_longitude_range,
 DROP COLUMN latitude,
 DROP COLUMN longitude,
 DROP COLUMN is_demo;
